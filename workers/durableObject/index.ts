// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { sendEmail } from "../email-sender";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { applyMigrations, mailboxMigrations } from "./migrations";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * Map SortColumn string names to Drizzle column references for safe
 * ORDER BY construction (no string interpolation into SQL).
 */
const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, typeof schema.emails[keyof typeof schema.emails]>;

interface SearchFilterOptions {
	query: string;
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
	label?: string;
}

interface RuleData {
	id: string;
	name: string;
	enabled: number;
	field: string;
	pattern: string;
	action: string;
	action_value: string | null;
	position: number;
}

interface GetEmailsOptions {
	folder?: string;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			thread_id,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snoozed_until: schema.emails.snoozed_until,
				scheduled_at: schema.emails.scheduled_at,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
		}));
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; thread_id?: string } = {}) {
		const { folder, thread_id } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (raw SQL — too complex for Drizzle's builder) ──

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			page = 1,
			limit: rawLimit = 25,
		} = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		if (!folder) {
			// Fallback to regular getEmails if no folder specified
			return this.getEmails(options);
		}

		const offset = (page - 1) * limit;

		// Thread grouping strategy:
		// For DRAFT folder: group by in_reply_to (the email being replied to).
		//   This ensures reply-drafts to different emails stay separate, even if
		//   they share a thread_id or subject. New drafts (no in_reply_to) each
		//   get their own group via their unique id.
		// For other folders:
		//   1. Primary: group by thread_id (from email threading headers)
		//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
		//      for legacy emails that lack threading headers (thread_id IS NULL).
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const result = this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT *,
						COALESCE(in_reply_to, id) as draft_group_key
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				draft_stats AS (
					SELECT
						draft_group_key,
						COUNT(*) as thread_count,
						SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
						GROUP_CONCAT(DISTINCT sender) as participants
					FROM folder_emails
					GROUP BY draft_group_key
				),
				latest_per_group AS (
					SELECT
						fe.*,
						ROW_NUMBER() OVER (
							PARTITION BY fe.draft_group_key
							ORDER BY fe.date DESC
						) as rn
					FROM folder_emails fe
				)
				SELECT
					lp.id, lp.subject, lp.sender, lp.recipient, lp.date,
					lp.read, lp.starred, lp.thread_id, lp.folder_id,
					lp.in_reply_to, lp.email_references,
					SUBSTR(lp.body, 1, 300) as snippet,
					ds.thread_count, ds.thread_unread_count, ds.participants
				FROM latest_per_group lp
				JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
				WHERE lp.rn = 1
				ORDER BY lp.date DESC
				LIMIT ?2 OFFSET ?3`,
				folder, limit, offset
			);

			const rows = [...result];
			return rows.map((row: any) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
				thread_count: row.thread_count || 1,
				thread_unread_count: row.thread_unread_count || 0,
				participants: row.participants || row.sender,
			}));
		}

		// Non-draft folders: full threading logic
		const result = this.ctx.storage.sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN thread_to_conversation tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					GROUP_CONCAT(DISTINCT sender) as participants,
					SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) as has_draft
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN thread_to_conversation tc
					ON fe.raw_thread_id = tc.raw_thread_id
			)
			SELECT
				lif.id, lif.subject, lif.sender, lif.recipient, lif.date,
				lif.read, lif.starred, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				SUBSTR(lif.body, 1, 300) as snippet,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
					AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			ORDER BY lif.date DESC
			LIMIT ?2 OFFSET ?3`,
			folder, limit, offset
		);

		const rows = [...result];
		return rows.map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
			needs_reply: !!row.needs_reply,
			has_draft: !!row.has_draft,
		}));
	}

	/**
	 * Count threaded conversations in a folder (for pagination).
	 * Returns the number of conversation groups, not individual emails.
	 */
	async countThreadedEmails(folder: string) {
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
					 FROM emails
					 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
					folder,
				),
			][0] as { total: number } | undefined;
			return row?.total ?? 0;
		}

		const row = [
			...this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT
						COALESCE(thread_id, id) as raw_thread_id,
						thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				thread_to_conversation AS (
					SELECT
						raw_thread_id,
						CASE
							WHEN thread_id IS NOT NULL THEN raw_thread_id
							WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
							ELSE raw_thread_id
						END as conversation_id
					FROM folder_emails
					GROUP BY raw_thread_id, normalized_subject, thread_id
				)
				SELECT COUNT(DISTINCT conversation_id) as total
				FROM thread_to_conversation`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		const emailLabelRows = this.db
			.select({
				id: schema.labels.id,
				name: schema.labels.name,
				color: schema.labels.color,
			})
			.from(schema.emailLabels)
			.innerJoin(schema.labels, eq(schema.emailLabels.label_id, schema.labels.id))
			.where(eq(schema.emailLabels.email_id, id))
			.all();

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
			labels: emailLabelRows,
		};
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		] as any[];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders})`,
				...emailIds,
			),
		] as any[];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, any[]>();
		for (const att of attachmentRows) {
			const list = attachmentsByEmail.get(att.email_id) || [];
			list.push(att);
			attachmentsByEmail.set(att.email_id, list);
		}

		return emailRows.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: attachmentsByEmail.get(email.id) || [],
		}));
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		this.db
			.delete(schema.emails)
			.where(eq(schema.emails.id, id))
			.run();

		return emailAttachments;
	}

	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.get() ?? null
		);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	async createFolder(id: string, name: string, is_deletable: number = 1) {
		try {
			const result = this.db
				.insert(schema.folders)
				.values({ id, name, is_deletable })
				.returning({ id: schema.folders.id, name: schema.folders.name })
				.get();
			return { ...result, unreadCount: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		const result = this.db
			.update(schema.folders)
			.set({ name })
			.where(eq(schema.folders.id, id))
			.returning({ id: schema.folders.id, name: schema.folders.name })
			.get();
		return result;
	}

	async deleteFolder(id: string) {
		const folder = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();

		if (!folder || folder.is_deletable === 0) {
			return false;
		}

		this.db
			.delete(schema.folders)
			.where(eq(schema.folders.id, id))
			.run();

		return true;
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		return true;
	}

	// ── Search (raw SQL — dynamic condition builder) ───────────────

	/**
	 * Build WHERE conditions and params for search queries.
	 * Shared between searchEmails and countSearchResults.
	 */
	#buildSearchConditions(
		options: SearchFilterOptions,
		tableAlias = "",
	): { conditions: string[]; params: (string | number)[] } {
		const { query, folder, from, to, subject, date_start, date_end, is_read, is_starred, has_attachment, label } = options;
		const prefix = tableAlias ? `${tableAlias}.` : "";
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		let paramIdx = 0;

		const addParam = (value: string | number) => {
			paramIdx++;
			params.push(value);
			return `?${paramIdx}`;
		};

		if (query) {
			const p1 = addParam(`%${query}%`);
			const p2 = addParam(`%${query}%`);
			const p3 = addParam(`%${query}%`);
			const p4 = addParam(`%${query}%`);
			conditions.push(`(${prefix}subject LIKE ${p1} OR ${prefix}body LIKE ${p2} OR ${prefix}sender LIKE ${p3} OR ${prefix}recipient LIKE ${p4} OR ${prefix}cc LIKE ${p4} OR ${prefix}bcc LIKE ${p4})`);
		}
		if (folder) {
			const p = addParam(folder);
			conditions.push(`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${p} OR id = ${p} LIMIT 1)`);
		}
		if (from) { const p = addParam(`%${from}%`); conditions.push(`${prefix}sender LIKE ${p}`); }
		if (to) { const p = addParam(`%${to}%`); conditions.push(`(${prefix}recipient LIKE ${p} OR ${prefix}cc LIKE ${p} OR ${prefix}bcc LIKE ${p})`); }
		if (subject) { const p = addParam(`%${subject}%`); conditions.push(`${prefix}subject LIKE ${p}`); }
		if (date_start) { const p = addParam(date_start); conditions.push(`${prefix}date >= ${p}`); }
		if (date_end) { const p = addParam(date_end); conditions.push(`${prefix}date <= ${p}`); }
		if (is_read !== undefined) { const p = addParam(is_read ? 1 : 0); conditions.push(`${prefix}read = ${p}`); }
		if (is_starred !== undefined) { const p = addParam(is_starred ? 1 : 0); conditions.push(`${prefix}starred = ${p}`); }
		if (has_attachment) { conditions.push(`${prefix}id IN (SELECT DISTINCT email_id FROM attachments)`); }
		if (label) {
			const p = addParam(label);
			conditions.push(`${prefix}id IN (SELECT email_id FROM email_labels el JOIN labels l ON el.label_id = l.id WHERE l.id = ${p} OR l.name = ${p})`);
		}

		return { conditions, params };
	}

	async searchEmails(options: SearchFilterOptions & { page?: number; limit?: number }) {
		const { page = 1, limit: rawLimit = 25 } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const { conditions, params } = this.#buildSearchConditions(options, "e");

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const offset = (page - 1) * limit;

		const query = `
			SELECT e.id, e.subject, e.sender, e.recipient, e.cc, e.bcc, e.date,
				e.read, e.starred, e.in_reply_to, e.email_references,
				e.thread_id, e.folder_id,
				SUBSTR(e.body, 1, 300) as snippet,
				f.name as folder_name
			FROM emails e
			LEFT JOIN folders f ON e.folder_id = f.id
			${where}
			ORDER BY e.date DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(limit, offset);

		const result = this.ctx.storage.sql.exec(query, ...params);
		return [...result].map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
		}));
	}

	/**
	 * Count total search results matching the given filters (for pagination).
	 */
	async countSearchResults(options: SearchFilterOptions) {
		const { conditions, params } = this.#buildSearchConditions(options);

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const query = `SELECT COUNT(*) as total FROM emails ${where}`;

		const row = [...this.ctx.storage.sql.exec(query, ...params)][0] as
			| { total: number }
			| undefined;
		return row?.total ?? 0;
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		const normalized = subject
			.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
			.trim()
			.toLowerCase();

		if (!normalized) return null;

		const result = this.ctx.storage.sql.exec(
			`SELECT thread_id, subject,
			        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
			        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
			 FROM emails
			 WHERE thread_id IS NOT NULL
			   AND thread_id != id
			   AND date >= datetime('now', '-7 days')
			 GROUP BY thread_id
			 ORDER BY MAX(date) DESC
			 LIMIT 50`,
		);

		const normalizedSender = senderAddress?.toLowerCase().trim();

		for (const row of result) {
			const rowSubject = String((row as any).subject || "")
				.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
				.trim()
				.toLowerCase();
			if (rowSubject !== normalized) continue;

			if (normalizedSender) {
				const threadSenders = String((row as any).senders || "");
				const threadRecipients = String((row as any).recipients || "");
				const allParticipants = `${threadSenders},${threadRecipients}`;
				if (!allParticipants.includes(normalizedSender)) {
					continue;
				}
			}

			return String((row as any).thread_id);
		}
		return null;
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/**
	 * Check if the mailbox has exceeded the send rate limit.
	 * Limits: 20 emails per hour, 100 per day per mailbox.
	 * Returns null if under limit, or an error message string if exceeded.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 hour')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 day')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;

		// Sent emails are always read — the sender obviously knows what they wrote.
		// This prevents sent replies from inflating thread_unread_count.
		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isSent ? 1 : (email.read ? 1 : 0),
				starred: email.starred ? 1 : 0,
				body: email.body,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}

		// Auto-collect contacts: senders of received mail, recipients of sent mail.
		try {
			if (folderId === Folders.INBOX && email.sender) {
				this.recordContact(email.sender);
			} else if (folderId === Folders.SENT) {
				for (const addr of (email.recipient || "").split(",")) {
					this.recordContact(addr);
				}
			}
		} catch (e) {
			console.warn("Contact collection failed:", (e as Error).message);
		}
	}

	// ── Snooze ─────────────────────────────────────────────────────

	/**
	 * Snooze an email: hide it in the Snoozed folder until `until`,
	 * at which point the alarm moves it back to the inbox as unread.
	 */
	async snoozeEmail(id: string, until: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();
		if (!email) return null;

		if (Number.isNaN(new Date(until).getTime())) {
			throw new Error(`Invalid snooze time: ${until}`);
		}

		this.db
			.update(schema.emails)
			.set({ folder_id: Folders.SNOOZED, snoozed_until: until })
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { id, snoozed_until: until };
	}

	/** Un-snooze an email immediately, returning it to the inbox. */
	async unsnoozeEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id, folder_id: schema.emails.folder_id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();
		if (!email || email.folder_id !== Folders.SNOOZED) return null;

		this.db
			.update(schema.emails)
			.set({ folder_id: Folders.INBOX, snoozed_until: null })
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { id, status: "unsnoozed" };
	}

	// ── Scheduled send ─────────────────────────────────────────────

	/**
	 * Schedule a draft to be sent later. Moves the draft into the
	 * Scheduled folder; the alarm delivers it at `sendAt`.
	 */
	async scheduleEmail(id: string, sendAt: string) {
		const email = this.db
			.select({
				id: schema.emails.id,
				folder_id: schema.emails.folder_id,
				recipient: schema.emails.recipient,
			})
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();
		if (!email) return { error: "Email not found" };
		if (email.folder_id !== Folders.DRAFT) {
			return { error: "Only drafts can be scheduled" };
		}
		if (!email.recipient) {
			return { error: "Draft has no recipient" };
		}
		if (Number.isNaN(new Date(sendAt).getTime())) {
			return { error: `Invalid send time: ${sendAt}` };
		}

		this.db
			.update(schema.emails)
			.set({ folder_id: Folders.SCHEDULED, scheduled_at: sendAt })
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { id, scheduled_at: sendAt, status: "scheduled" };
	}

	/** Cancel a scheduled send, returning the email to Drafts. */
	async cancelScheduledEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id, folder_id: schema.emails.folder_id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();
		if (!email || email.folder_id !== Folders.SCHEDULED) return null;

		this.db
			.update(schema.emails)
			.set({ folder_id: Folders.DRAFT, scheduled_at: null })
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { id, status: "unscheduled" };
	}

	// ── Alarm: wake snoozed emails, deliver scheduled sends ────────

	/**
	 * Set the DO alarm to the earliest pending snooze wake-up or
	 * scheduled send. Public so API routes can trigger a re-scan,
	 * but primarily called internally after state changes.
	 */
	async scheduleNextAlarm() {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT MIN(t) as next FROM (
					SELECT MIN(snoozed_until) as t FROM emails
						WHERE folder_id = ?1 AND snoozed_until IS NOT NULL
					UNION ALL
					SELECT MIN(scheduled_at) as t FROM emails
						WHERE folder_id = ?2 AND scheduled_at IS NOT NULL
				) WHERE t IS NOT NULL`,
				Folders.SNOOZED,
				Folders.SCHEDULED,
			),
		][0] as { next: string | null } | undefined;

		const next = row?.next;
		if (!next) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		const ts = new Date(next).getTime();
		if (Number.isNaN(ts)) return;
		// Never schedule in the past — fire almost immediately instead.
		await this.ctx.storage.setAlarm(Math.max(ts, Date.now() + 1000));
	}

	async alarm() {
		const nowIso = new Date().toISOString();

		// 1. Wake snoozed emails whose time has come: back to inbox, unread
		//    so they surface at the top of the list.
		this.ctx.storage.sql.exec(
			`UPDATE emails SET folder_id = ?1, snoozed_until = NULL, read = 0
			 WHERE folder_id = ?2 AND snoozed_until IS NOT NULL AND snoozed_until <= ?3`,
			Folders.INBOX,
			Folders.SNOOZED,
			nowIso,
		);

		// 2. Deliver scheduled emails that are due.
		const due = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails
				 WHERE folder_id = ?1 AND scheduled_at IS NOT NULL AND scheduled_at <= ?2`,
				Folders.SCHEDULED,
				nowIso,
			),
		] as any[];

		for (const email of due) {
			try {
				const toList = String(email.recipient || "")
					.split(",")
					.map((a: string) => a.trim())
					.filter(Boolean);
				const ccList = String(email.cc || "").split(",").map((a: string) => a.trim()).filter(Boolean);
				const bccList = String(email.bcc || "").split(",").map((a: string) => a.trim()).filter(Boolean);

				// Build threading headers if this is a scheduled reply.
				let headers: Record<string, string> | undefined;
				if (email.in_reply_to) {
					const original = [
						...this.ctx.storage.sql.exec(
							`SELECT message_id FROM emails WHERE id = ?1`,
							email.in_reply_to,
						),
					][0] as { message_id: string | null } | undefined;
					if (original?.message_id) {
						headers = {
							"In-Reply-To": `<${original.message_id}>`,
							References: `<${original.message_id}>`,
						};
					}
				}

				await sendEmail(this.env.EMAIL, {
					to: toList.length === 1 ? toList[0] : toList,
					from: email.sender,
					subject: email.subject || "(no subject)",
					html: email.body || "",
					...(ccList.length > 0 ? { cc: ccList } : {}),
					...(bccList.length > 0 ? { bcc: bccList } : {}),
					...(headers ? { headers } : {}),
				});

				this.ctx.storage.sql.exec(
					`UPDATE emails SET folder_id = ?1, scheduled_at = NULL, read = 1, date = ?2
					 WHERE id = ?3`,
					Folders.SENT,
					new Date().toISOString(),
					email.id,
				);
			} catch (e) {
				console.error(
					`Scheduled send failed for ${email.id}, returning to drafts:`,
					(e as Error).message,
				);
				// Return to drafts so the email isn't stuck retrying forever.
				this.ctx.storage.sql.exec(
					`UPDATE emails SET folder_id = ?1, scheduled_at = NULL WHERE id = ?2`,
					Folders.DRAFT,
					email.id,
				);
			}
		}

		await this.scheduleNextAlarm();
	}

	// ── Labels ─────────────────────────────────────────────────────

	async getLabels() {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT l.id, l.name, l.color, COUNT(el.email_id) as email_count
				 FROM labels l
				 LEFT JOIN email_labels el ON el.label_id = l.id
				 GROUP BY l.id, l.name, l.color
				 ORDER BY l.name COLLATE NOCASE`,
			),
		];
		return rows as { id: string; name: string; color: string; email_count: number }[];
	}

	async createLabel(name: string, color?: string) {
		const trimmed = name.trim();
		if (!trimmed) return null;
		try {
			const result = this.db
				.insert(schema.labels)
				.values({
					id: crypto.randomUUID(),
					name: trimmed,
					color: color || "#8eaa92",
				})
				.returning()
				.get();
			return { ...result, email_count: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateLabel(id: string, data: { name?: string; color?: string }) {
		const set: { name?: string; color?: string } = {};
		if (data.name?.trim()) set.name = data.name.trim();
		if (data.color) set.color = data.color;
		if (Object.keys(set).length === 0) return null;
		return (
			this.db
				.update(schema.labels)
				.set(set)
				.where(eq(schema.labels.id, id))
				.returning()
				.get() ?? null
		);
	}

	async deleteLabel(id: string) {
		// email_labels rows cascade via FK
		this.ctx.storage.sql.exec(`DELETE FROM email_labels WHERE label_id = ?1`, id);
		const existing = this.db
			.select({ id: schema.labels.id })
			.from(schema.labels)
			.where(eq(schema.labels.id, id))
			.get();
		if (!existing) return false;
		this.db.delete(schema.labels).where(eq(schema.labels.id, id)).run();
		return true;
	}

	async addLabelToEmail(emailId: string, labelId: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, emailId))
			.get();
		if (!email) return { error: "Email not found" };
		const label = this.db
			.select({ id: schema.labels.id })
			.from(schema.labels)
			.where(or(eq(schema.labels.id, labelId), eq(schema.labels.name, labelId)))
			.get();
		if (!label) return { error: "Label not found" };
		this.ctx.storage.sql.exec(
			`INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?1, ?2)`,
			emailId,
			label.id,
		);
		return { status: "labeled", emailId, labelId: label.id };
	}

	async removeLabelFromEmail(emailId: string, labelId: string) {
		this.ctx.storage.sql.exec(
			`DELETE FROM email_labels WHERE email_id = ?1 AND label_id IN (SELECT id FROM labels WHERE id = ?2 OR name = ?2)`,
			emailId,
			labelId,
		);
		return { status: "unlabeled", emailId, labelId };
	}

	// ── Templates ──────────────────────────────────────────────────

	async getTemplates() {
		return this.db
			.select()
			.from(schema.templates)
			.orderBy(asc(schema.templates.name))
			.all();
	}

	async createTemplate(data: { name: string; subject?: string; body: string }) {
		const now = new Date().toISOString();
		return this.db
			.insert(schema.templates)
			.values({
				id: crypto.randomUUID(),
				name: data.name.trim(),
				subject: data.subject ?? null,
				body: data.body,
				created_at: now,
				updated_at: now,
			})
			.returning()
			.get();
	}

	async updateTemplate(
		id: string,
		data: { name?: string; subject?: string; body?: string },
	) {
		const set: Record<string, string> = { updated_at: new Date().toISOString() };
		if (data.name?.trim()) set.name = data.name.trim();
		if (data.subject !== undefined) set.subject = data.subject;
		if (data.body !== undefined) set.body = data.body;
		return (
			this.db
				.update(schema.templates)
				.set(set)
				.where(eq(schema.templates.id, id))
				.returning()
				.get() ?? null
		);
	}

	async deleteTemplate(id: string) {
		const existing = this.db
			.select({ id: schema.templates.id })
			.from(schema.templates)
			.where(eq(schema.templates.id, id))
			.get();
		if (!existing) return false;
		this.db.delete(schema.templates).where(eq(schema.templates.id, id)).run();
		return true;
	}

	// ── Rules ──────────────────────────────────────────────────────

	async getRules() {
		return this.db
			.select()
			.from(schema.rules)
			.orderBy(asc(schema.rules.position), asc(schema.rules.name))
			.all();
	}

	async createRule(data: {
		name: string;
		field: string;
		pattern: string;
		action: string;
		action_value?: string;
		enabled?: boolean;
	}) {
		const maxRow = [
			...this.ctx.storage.sql.exec(`SELECT COALESCE(MAX(position), 0) as p FROM rules`),
		][0] as { p: number } | undefined;
		return this.db
			.insert(schema.rules)
			.values({
				id: crypto.randomUUID(),
				name: data.name.trim(),
				enabled: data.enabled === false ? 0 : 1,
				field: data.field,
				pattern: data.pattern,
				action: data.action,
				action_value: data.action_value ?? null,
				position: (maxRow?.p ?? 0) + 1,
			})
			.returning()
			.get();
	}

	async updateRule(
		id: string,
		data: {
			name?: string;
			field?: string;
			pattern?: string;
			action?: string;
			action_value?: string | null;
			enabled?: boolean;
			position?: number;
		},
	) {
		const set: Record<string, string | number | null> = {};
		if (data.name?.trim()) set.name = data.name.trim();
		if (data.field) set.field = data.field;
		if (data.pattern) set.pattern = data.pattern;
		if (data.action) set.action = data.action;
		if (data.action_value !== undefined) set.action_value = data.action_value;
		if (data.enabled !== undefined) set.enabled = data.enabled ? 1 : 0;
		if (data.position !== undefined) set.position = data.position;
		if (Object.keys(set).length === 0) return null;
		return (
			this.db
				.update(schema.rules)
				.set(set)
				.where(eq(schema.rules.id, id))
				.returning()
				.get() ?? null
		);
	}

	async deleteRule(id: string) {
		const existing = this.db
			.select({ id: schema.rules.id })
			.from(schema.rules)
			.where(eq(schema.rules.id, id))
			.get();
		if (!existing) return false;
		this.db.delete(schema.rules).where(eq(schema.rules.id, id)).run();
		return true;
	}

	/**
	 * Apply enabled inbox rules to a freshly received email.
	 *
	 * Rules run in position order. Match is a case-insensitive substring
	 * check of `pattern` against the chosen field. Supported actions:
	 * move (action_value = folder id), label (action_value = label id/name),
	 * star, mark_read. All matching rules apply; the first matching `move`
	 * wins (later moves are ignored so rule order is meaningful).
	 *
	 * Returns the email's final folder_id so callers can decide whether
	 * to trigger downstream automation (e.g. skip AI auto-draft for spam).
	 */
	async applyRulesToEmail(emailId: string): Promise<string | null> {
		const email = [
			...this.ctx.storage.sql.exec(`SELECT * FROM emails WHERE id = ?1`, emailId),
		][0] as any;
		if (!email) return null;

		const allRules = (await this.getRules()) as RuleData[];
		const active = allRules.filter((r) => r.enabled);
		if (active.length === 0) return email.folder_id;

		let finalFolder: string = email.folder_id;
		let moved = false;

		const fieldValue = (field: string): string => {
			switch (field) {
				case "sender": return String(email.sender || "");
				case "recipient": return String(email.recipient || "");
				case "subject": return String(email.subject || "");
				case "body": return String(email.body || "");
				default:
					return [email.sender, email.recipient, email.subject, email.body]
						.map((v) => String(v || ""))
						.join("\n");
			}
		};

		for (const rule of active) {
			const haystack = fieldValue(rule.field).toLowerCase();
			if (!haystack.includes(rule.pattern.toLowerCase())) continue;

			switch (rule.action) {
				case "move": {
					if (moved || !rule.action_value) break;
					const folder = this.db
						.select({ id: schema.folders.id })
						.from(schema.folders)
						.where(
							or(
								eq(schema.folders.id, rule.action_value),
								eq(schema.folders.name, rule.action_value),
							),
						)
						.get();
					if (folder) {
						this.ctx.storage.sql.exec(
							`UPDATE emails SET folder_id = ?1 WHERE id = ?2`,
							folder.id,
							emailId,
						);
						finalFolder = folder.id;
						moved = true;
					}
					break;
				}
				case "label": {
					if (rule.action_value) {
						await this.addLabelToEmail(emailId, rule.action_value);
					}
					break;
				}
				case "star": {
					this.ctx.storage.sql.exec(`UPDATE emails SET starred = 1 WHERE id = ?1`, emailId);
					break;
				}
				case "mark_read": {
					this.ctx.storage.sql.exec(`UPDATE emails SET read = 1 WHERE id = ?1`, emailId);
					break;
				}
			}
		}

		return finalFolder;
	}

	// ── Contacts ───────────────────────────────────────────────────

	/** Upsert a contact, bumping its seen-count. Synchronous helper. */
	recordContact(rawEmail: string, name?: string) {
		const email = rawEmail.trim().toLowerCase();
		// Basic shape check — skip garbage and self-referential empties.
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
		this.ctx.storage.sql.exec(
			`INSERT INTO contacts (email, name, last_seen, times_seen)
			 VALUES (?1, ?2, ?3, 1)
			 ON CONFLICT(email) DO UPDATE SET
				times_seen = times_seen + 1,
				last_seen = ?3,
				name = COALESCE(excluded.name, contacts.name)`,
			email,
			name ?? null,
			new Date().toISOString(),
		);
	}

	async getContacts(options: { query?: string; limit?: number } = {}) {
		const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
		if (options.query) {
			return [
				...this.ctx.storage.sql.exec(
					`SELECT email, name, last_seen, times_seen FROM contacts
					 WHERE email LIKE ?1 OR name LIKE ?1
					 ORDER BY times_seen DESC, last_seen DESC LIMIT ?2`,
					`%${options.query}%`,
					limit,
				),
			];
		}
		return [
			...this.ctx.storage.sql.exec(
				`SELECT email, name, last_seen, times_seen FROM contacts
				 ORDER BY times_seen DESC, last_seen DESC LIMIT ?1`,
				limit,
			),
		];
	}
}
