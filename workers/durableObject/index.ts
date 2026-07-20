// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { sendEmail } from "../email-sender";
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
	snoozed_until?: string | null;
	return_folder?: string | null;
	send_at?: string | null;
}

export interface TemplateData {
	id: string;
	name: string;
	subject?: string | null;
	body: string;
}

export interface RuleData {
	id: string;
	name: string;
	match_field: "sender" | "subject" | "body";
	match_value: string;
	action: "move" | "star" | "mark_read" | "trash" | "spam";
	action_folder_id?: string | null;
	enabled: boolean;
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
				send_at: schema.emails.send_at,
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
				lif.snoozed_until, lif.send_at,
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

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
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
		const { query, folder, from, to, subject, date_start, date_end, is_read, is_starred, has_attachment } = options;
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

	// ── Snooze ─────────────────────────────────────────────────────

	/**
	 * Snooze an email until the given ISO timestamp. The email is moved to
	 * the snoozed folder and returned to its original folder by the DO
	 * alarm when the time is reached.
	 */
	async snoozeEmail(id: string, until: string) {
		const email = this.db
			.select({ id: schema.emails.id, folder_id: schema.emails.folder_id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return { error: "Email not found" };
		if (
			email.folder_id === Folders.DRAFT ||
			email.folder_id === Folders.SCHEDULED ||
			email.folder_id === Folders.SENT
		) {
			return { error: "Only received emails can be snoozed" };
		}

		const returnFolder =
			email.folder_id === Folders.SNOOZED ? undefined : email.folder_id;

		this.db
			.update(schema.emails)
			.set({
				folder_id: Folders.SNOOZED,
				snoozed_until: until,
				...(returnFolder ? { return_folder: returnFolder } : {}),
			})
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { status: "snoozed", emailId: id, until };
	}

	/** Wake a snoozed email immediately, returning it to its original folder. */
	async unsnoozeEmail(id: string) {
		const email = this.db
			.select({
				id: schema.emails.id,
				folder_id: schema.emails.folder_id,
				return_folder: schema.emails.return_folder,
			})
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return { error: "Email not found" };
		if (email.folder_id !== Folders.SNOOZED) {
			return { error: "Email is not snoozed" };
		}

		this.db
			.update(schema.emails)
			.set({
				folder_id: this.#resolveReturnFolder(email.return_folder),
				snoozed_until: null,
				return_folder: null,
			})
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { status: "unsnoozed", emailId: id };
	}

	/** Resolve a stored return folder, falling back to inbox if it no longer exists. */
	#resolveReturnFolder(returnFolder: string | null | undefined): string {
		if (!returnFolder) return Folders.INBOX;
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, returnFolder))
			.get();
		return folder ? returnFolder : Folders.INBOX;
	}

	// ── Scheduled send ─────────────────────────────────────────────

	/** Cancel a scheduled send, moving the email back to Drafts for editing. */
	async cancelScheduledSend(id: string) {
		const email = this.db
			.select({ id: schema.emails.id, folder_id: schema.emails.folder_id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return { error: "Email not found" };
		if (email.folder_id !== Folders.SCHEDULED) {
			return { error: "Email is not scheduled" };
		}

		this.db
			.update(schema.emails)
			.set({ folder_id: Folders.DRAFT, send_at: null })
			.where(eq(schema.emails.id, id))
			.run();

		await this.scheduleNextAlarm();
		return { status: "cancelled", emailId: id };
	}

	// ── Alarm (snooze wake-ups + scheduled sends) ──────────────────

	/**
	 * Set the DO alarm to the earliest pending snooze wake-up or
	 * scheduled send. Clears the alarm when nothing is pending.
	 */
	async scheduleNextAlarm() {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT MIN(t) as next FROM (
					SELECT snoozed_until as t FROM emails
					WHERE folder_id = ?1 AND snoozed_until IS NOT NULL
					UNION ALL
					SELECT send_at as t FROM emails
					WHERE folder_id = ?2 AND send_at IS NOT NULL
				)`,
				Folders.SNOOZED,
				Folders.SCHEDULED,
			),
		][0] as { next: string | null } | undefined;

		const next = row?.next ? new Date(row.next).getTime() : null;
		if (next !== null && !Number.isNaN(next)) {
			// Never set an alarm in the past; fire promptly for overdue items.
			await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
		} else {
			await this.ctx.storage.deleteAlarm();
		}
	}

	async alarm() {
		const nowIso = new Date().toISOString();

		// 1. Wake due snoozed emails
		const dueSnoozes = [
			...this.ctx.storage.sql.exec(
				`SELECT id, return_folder FROM emails
				 WHERE folder_id = ?1 AND snoozed_until IS NOT NULL AND snoozed_until <= ?2`,
				Folders.SNOOZED,
				nowIso,
			),
		] as { id: string; return_folder: string | null }[];

		for (const email of dueSnoozes) {
			// Mark unread so the returned email surfaces in the unread count.
			this.db
				.update(schema.emails)
				.set({
					folder_id: this.#resolveReturnFolder(email.return_folder),
					snoozed_until: null,
					return_folder: null,
					read: 0,
				})
				.where(eq(schema.emails.id, email.id))
				.run();
		}

		// 2. Send due scheduled emails
		const dueSends = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails
				 WHERE folder_id = ?1 AND send_at IS NOT NULL AND send_at <= ?2`,
				Folders.SCHEDULED,
				nowIso,
			),
		] as any[];

		for (const email of dueSends) {
			await this.#sendScheduledEmail(email);
		}

		await this.scheduleNextAlarm();
	}

	/**
	 * Deliver a scheduled email via the Email Service binding. On success the
	 * email moves to Sent; on failure it moves back to Drafts so nothing is
	 * silently lost.
	 */
	async #sendScheduledEmail(email: any) {
		const splitList = (value: string | null | undefined): string[] =>
			(value || "")
				.split(",")
				.map((s: string) => s.trim())
				.filter(Boolean);

		// Recover the display-name "From" header stored at schedule time.
		let from: string | { email: string; name: string } = email.sender;
		try {
			const headers = JSON.parse(email.raw_headers || "[]") as {
				key: string;
				value: string;
			}[];
			const fromHeader = headers.find((h) => h.key.toLowerCase() === "from");
			if (fromHeader?.value) {
				const match = fromHeader.value.match(/^(.*)<(.+)>\s*$/);
				from = match
					? { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() }
					: fromHeader.value;
			}
		} catch {
			// Malformed raw_headers — fall back to the bare sender address
		}

		const to = splitList(email.recipient);
		const cc = splitList(email.cc);
		const bcc = splitList(email.bcc);

		let references: string[] = [];
		try {
			references = email.email_references ? JSON.parse(email.email_references) : [];
		} catch {
			// Malformed references — send without them
		}

		try {
			await sendEmail(this.env.EMAIL, {
				to,
				...(cc.length > 0 ? { cc } : {}),
				...(bcc.length > 0 ? { bcc } : {}),
				from,
				subject: email.subject || "",
				html: email.body || "",
				...(email.in_reply_to
					? {
							headers: {
								"In-Reply-To": `<${email.in_reply_to}>`,
								...(references.length > 0
									? { References: references.map((r) => `<${r}>`).join(" ") }
									: {}),
							},
						}
					: {}),
			});

			this.db
				.update(schema.emails)
				.set({
					folder_id: Folders.SENT,
					send_at: null,
					date: new Date().toISOString(),
					read: 1,
				})
				.where(eq(schema.emails.id, email.id))
				.run();
		} catch (e) {
			console.error(
				`Scheduled send failed for ${email.id}, returning to drafts:`,
				(e as Error).message,
			);
			this.db
				.update(schema.emails)
				.set({ folder_id: Folders.DRAFT, send_at: null })
				.where(eq(schema.emails.id, email.id))
				.run();
		}
	}

	// ── Templates (canned responses) ───────────────────────────────

	async listTemplates() {
		return this.db
			.select()
			.from(schema.templates)
			.orderBy(asc(schema.templates.name))
			.all();
	}

	async createTemplate(template: TemplateData) {
		const now = new Date().toISOString();
		return this.db
			.insert(schema.templates)
			.values({
				id: template.id,
				name: template.name,
				subject: template.subject ?? null,
				body: template.body,
				created_at: now,
				updated_at: now,
			})
			.returning()
			.get();
	}

	async updateTemplate(
		id: string,
		data: { name?: string; subject?: string | null; body?: string },
	) {
		const result = this.db
			.update(schema.templates)
			.set({
				...(data.name !== undefined ? { name: data.name } : {}),
				...(data.subject !== undefined ? { subject: data.subject } : {}),
				...(data.body !== undefined ? { body: data.body } : {}),
				updated_at: new Date().toISOString(),
			})
			.where(eq(schema.templates.id, id))
			.returning()
			.get();
		return result ?? null;
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

	// ── Inbox rules ────────────────────────────────────────────────

	async listRules() {
		const result = this.db
			.select()
			.from(schema.rules)
			.orderBy(asc(schema.rules.created_at))
			.all();
		return result.map((rule) => ({ ...rule, enabled: !!rule.enabled }));
	}

	async createRule(rule: RuleData) {
		const created = this.db
			.insert(schema.rules)
			.values({
				id: rule.id,
				name: rule.name,
				match_field: rule.match_field,
				match_value: rule.match_value,
				action: rule.action,
				action_folder_id: rule.action_folder_id ?? null,
				enabled: rule.enabled ? 1 : 0,
				created_at: new Date().toISOString(),
			})
			.returning()
			.get();
		return { ...created, enabled: !!created.enabled };
	}

	async updateRule(
		id: string,
		data: Partial<Omit<RuleData, "id">>,
	) {
		const result = this.db
			.update(schema.rules)
			.set({
				...(data.name !== undefined ? { name: data.name } : {}),
				...(data.match_field !== undefined ? { match_field: data.match_field } : {}),
				...(data.match_value !== undefined ? { match_value: data.match_value } : {}),
				...(data.action !== undefined ? { action: data.action } : {}),
				...(data.action_folder_id !== undefined
					? { action_folder_id: data.action_folder_id }
					: {}),
				...(data.enabled !== undefined ? { enabled: data.enabled ? 1 : 0 } : {}),
			})
			.where(eq(schema.rules.id, id))
			.returning()
			.get();
		if (!result) return null;
		return { ...result, enabled: !!result.enabled };
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
	 * Evaluate enabled inbox rules against a just-received email and apply
	 * matching actions. The first matching folder action (move/trash/spam)
	 * wins; star and mark-read actions accumulate across all matches.
	 * Returns the resulting folder so the caller can decide whether to
	 * trigger downstream processing (e.g. skip auto-draft for spam).
	 */
	async applyInboundRules(emailId: string) {
		const email = this.db
			.select({
				id: schema.emails.id,
				sender: schema.emails.sender,
				subject: schema.emails.subject,
				body: schema.emails.body,
			})
			.from(schema.emails)
			.where(eq(schema.emails.id, emailId))
			.get();

		if (!email) return { folderId: Folders.INBOX, matched: [] as string[] };

		const enabledRules = this.db
			.select()
			.from(schema.rules)
			.where(eq(schema.rules.enabled, 1))
			.orderBy(asc(schema.rules.created_at))
			.all();

		let targetFolder: string | null = null;
		let star = false;
		let markRead = false;
		const matched: string[] = [];

		for (const rule of enabledRules) {
			const fieldValue = (
				rule.match_field === "sender"
					? email.sender
					: rule.match_field === "subject"
						? email.subject
						: email.body
			) ?? "";
			const needle = rule.match_value.toLowerCase().trim();
			if (!needle || !fieldValue.toLowerCase().includes(needle)) continue;

			matched.push(rule.name);
			switch (rule.action) {
				case "star":
					star = true;
					break;
				case "mark_read":
					markRead = true;
					break;
				case "trash":
					targetFolder = targetFolder ?? Folders.TRASH;
					break;
				case "spam":
					targetFolder = targetFolder ?? Folders.SPAM;
					break;
				case "move": {
					if (targetFolder || !rule.action_folder_id) break;
					const folder = this.db
						.select({ id: schema.folders.id })
						.from(schema.folders)
						.where(eq(schema.folders.id, rule.action_folder_id))
						.get();
					if (folder) targetFolder = folder.id;
					break;
				}
			}
		}

		if (matched.length > 0) {
			this.db
				.update(schema.emails)
				.set({
					...(targetFolder ? { folder_id: targetFolder } : {}),
					...(star ? { starred: 1 } : {}),
					...(markRead ? { read: 1 } : {}),
				})
				.where(eq(schema.emails.id, emailId))
				.run();
		}

		return { folderId: targetFolder ?? Folders.INBOX, matched };
	}

	// ── Contacts ───────────────────────────────────────────────────

	/**
	 * Aggregate frequent correspondents from received senders and sent
	 * recipients. Comma-separated recipient lists are split in JS since
	 * SQLite lacks a portable string-split.
	 */
	async getContacts(query?: string, limit: number = 8) {
		const cappedLimit = Math.min(Math.max(limit, 1), 50);
		const counts = new Map<string, number>();

		const senderRows = [
			...this.ctx.storage.sql.exec(
				`SELECT sender as addr, COUNT(*) as cnt FROM emails
				 WHERE folder_id NOT IN (?1, ?2, ?3) AND sender != ''
				 GROUP BY sender ORDER BY cnt DESC LIMIT 500`,
				Folders.SENT,
				Folders.DRAFT,
				Folders.SCHEDULED,
			),
		] as { addr: string; cnt: number }[];

		for (const row of senderRows) {
			const addr = row.addr.toLowerCase().trim();
			if (addr) counts.set(addr, (counts.get(addr) || 0) + row.cnt);
		}

		const recipientRows = [
			...this.ctx.storage.sql.exec(
				`SELECT recipient, cc FROM emails
				 WHERE folder_id = ?1
				 ORDER BY date DESC LIMIT 500`,
				Folders.SENT,
			),
		] as { recipient: string | null; cc: string | null }[];

		for (const row of recipientRows) {
			for (const field of [row.recipient, row.cc]) {
				for (const raw of (field || "").split(",")) {
					const addr = raw.toLowerCase().trim();
					// Weight sent-to addresses higher: people you write to matter more
					if (addr && addr.includes("@")) {
						counts.set(addr, (counts.get(addr) || 0) + 2);
					}
				}
			}
		}

		const normalizedQuery = query?.toLowerCase().trim();
		return [...counts.entries()]
			.filter(([addr]) => !normalizedQuery || addr.includes(normalizedQuery))
			.sort((a, b) => b[1] - a[1])
			.slice(0, cappedLimit)
			.map(([email, count]) => ({ email, count }));
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
				snoozed_until: email.snoozed_until ?? null,
				return_folder: email.return_folder ?? null,
				send_at: email.send_at ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}
	}
}
