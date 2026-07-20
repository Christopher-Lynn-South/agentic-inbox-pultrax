// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	textToHtml,
	escapeHtml,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = rawEmail.toLowerCase();
	const allowedAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
	if (allowedAddresses.length > 0 && !allowedAddresses.map((a) => a.toLowerCase()).includes(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = `mailboxes/${email}.json`;
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id, send_at } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	// Scheduled send: park the email in the Scheduled folder; the mailbox
	// DO alarm delivers it at send_at. Threading headers are rebuilt at
	// send time from in_reply_to / email_references.
	if (send_at) {
		const sendAtMs = Date.parse(send_at);
		if (Number.isNaN(sendAtMs)) return c.json({ error: "Invalid send_at timestamp" }, 400);
		if (sendAtMs <= Date.now()) return c.json({ error: "send_at must be in the future" }, 400);

		await stub.createEmail(Folders.SCHEDULED, {
			id: messageId, subject, sender: fromEmail, recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(), body: html || text || "", read: true,
			in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
			thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
			due_at: new Date(sendAtMs).toISOString(),
		}, attachmentData);

		c.executionCtx.waitUntil(
			(stub as any).upsertContacts(
				[...(Array.isArray(to) ? to : [to]), ...(cc ? (Array.isArray(cc) ? cc : [cc]) : [])].map((e) => ({ email: e })),
			).catch(() => {}),
		);
		return c.json({ id: messageId, status: "scheduled", send_at: new Date(sendAtMs).toISOString() }, 202);
	}

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}).catch((e) => console.error("Deferred email delivery failed:", (e as Error).message)),
	);
	c.executionCtx.waitUntil(
		(stub as any).upsertContacts(
			[...(Array.isArray(to) ? to : [to]), ...(cc ? (Array.isArray(cc) ? cc : [cc]) : [])].map((e) => ({ email: e })),
		).catch(() => {}),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

// -- Snooze / scheduled-send management -----------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/snooze", async (c: AppContext) => {
	const { until } = (await c.req.json()) as { until: string };
	if (!until) return c.json({ error: "Missing 'until' timestamp" }, 400);
	const result = await (c.var.mailboxStub as any).snoozeEmail(c.req.param("id")!, until);
	return "error" in result ? c.json(result, 400) : c.json(result);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/unsnooze", async (c: AppContext) => {
	const result = await (c.var.mailboxStub as any).unsnoozeEmail(c.req.param("id")!);
	return "error" in result ? c.json(result, 400) : c.json(result);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/cancel-schedule", async (c: AppContext) => {
	const result = await (c.var.mailboxStub as any).cancelScheduledSend(c.req.param("id")!);
	return "error" in result ? c.json(result, 400) : c.json(result);
});

// -- Bulk actions ---------------------------------------------------

const BulkActionBody = z.object({
	ids: z.array(z.string()).min(1).max(100),
	action: z.enum(["read", "unread", "star", "unstar", "move", "delete"]),
	folderId: z.string().optional(),
});

app.post("/api/v1/mailboxes/:mailboxId/emails/bulk", async (c: AppContext) => {
	const { ids, action, folderId } = BulkActionBody.parse(await c.req.json());
	const stub = c.var.mailboxStub as any;

	switch (action) {
		case "read":
			return c.json(await stub.bulkUpdateEmails(ids, { read: true }));
		case "unread":
			return c.json(await stub.bulkUpdateEmails(ids, { read: false }));
		case "star":
			return c.json(await stub.bulkUpdateEmails(ids, { starred: true }));
		case "unstar":
			return c.json(await stub.bulkUpdateEmails(ids, { starred: false }));
		case "move": {
			if (!folderId) return c.json({ error: "folderId is required for move" }, 400);
			const result = await stub.bulkMoveEmails(ids, folderId);
			return "error" in result ? c.json(result, 400) : c.json(result);
		}
		case "delete": {
			const attachments = await stub.bulkDeleteEmails(ids) as { id: string; email_id: string; filename: string }[];
			if (attachments.length > 0) {
				await c.env.BUCKET.delete(
					attachments.map((att) => `attachments/${att.email_id}/${att.id}/${att.filename}`),
				);
			}
			return c.json({ status: "deleted", count: ids.length });
		}
	}
});

// -- Contacts -------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/contacts", async (c: AppContext) => {
	const query = c.req.query("query") || undefined;
	const limit = intQuery(c, "limit");
	const contacts = await (c.var.mailboxStub as any).getContacts(query, limit ?? 20);
	return c.json(contacts);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(event: { raw: ReadableStream; rawSize: number }, env: Env, ctx: ExecutionContext) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	if (!parsedEmail.to?.length || !parsedEmail.to[0].address) throw new Error("received email with empty to");

	const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	const allRecipients = parsedEmail.to.map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	let mailboxId: string | undefined;
	if (allowedAddresses.length > 0) {
		mailboxId = allRecipients.find((addr) => allowedAddresses.includes(addr));
		if (!mailboxId) { console.log(`Ignoring email: no recipient matches EMAIL_ADDRESSES.`); return; }
	} else { mailboxId = allRecipients[0]; }
	if (!mailboxId) throw new Error("received email with no valid recipient address");

	const messageId = crypto.randomUUID();
	const settingsObj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!settingsObj) { console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`); return; }
	let mailboxSettings: MailboxStoredSettings = {};
	try { mailboxSettings = await settingsObj.json() as MailboxStoredSettings; } catch { /* corrupt settings — proceed with defaults */ }

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (!inReplyTo && emailReferences.length === 0) {
		const subjectThread = await (stub as any).findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(), recipient: allRecipients.join(", "),
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	}, attachmentData);

	// Record the sender as a contact for composer autocomplete.
	const senderAddress = (parsedEmail.from?.address || "").toLowerCase();
	if (senderAddress) {
		ctx.waitUntil(
			(stub as any).upsertContacts([
				{ email: senderAddress, name: parsedEmail.from?.name || null },
			]).catch(() => {}),
		);
	}

	// Honor per-mailbox forwarding + auto-reply settings.
	ctx.waitUntil(
		handleInboundAutomation(env, stub, mailboxId, mailboxSettings, parsedEmail, threadId)
			.catch((e) => console.error("Inbound automation failed:", (e as Error).message)),
	);

	const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
	ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail", {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ mailboxId, emailId: messageId, sender: (parsedEmail.from?.address || "").toLowerCase(), subject: parsedEmail.subject || "", threadId }),
	})).catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message)));
}

// -- Inbound automation: forwarding + auto-reply --------------------

interface MailboxStoredSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	autoReply?: { enabled: boolean; subject: string; message: string };
	[key: string]: unknown;
}

interface ParsedInboundEmail {
	from?: { address?: string; name?: string };
	subject?: string;
	html?: string | null;
	text?: string | null;
	messageId?: string;
	headers?: { key: string; value: string }[] | Record<string, string>;
}

function getInboundHeader(parsed: ParsedInboundEmail, name: string): string {
	const headers = parsed.headers;
	if (!headers) return "";
	if (Array.isArray(headers)) {
		const found = headers.find((h) => h.key?.toLowerCase() === name);
		return typeof found?.value === "string" ? found.value : "";
	}
	return String((headers as Record<string, string>)[name] ?? "");
}

/**
 * Detect automated senders / bulk mail we must never auto-respond to,
 * per RFC 3834 (Auto-Submitted) and common conventions.
 */
function isAutomatedMessage(parsed: ParsedInboundEmail): boolean {
	const sender = parsed.from?.address?.toLowerCase() || "";
	if (/no-?reply|mailer-daemon|postmaster|bounce/i.test(sender)) return true;

	const autoSubmitted = getInboundHeader(parsed, "auto-submitted").toLowerCase();
	if (autoSubmitted && autoSubmitted !== "no") return true;
	if (getInboundHeader(parsed, "x-auto-response-suppress")) return true;
	const precedence = getInboundHeader(parsed, "precedence").toLowerCase();
	if (["bulk", "junk", "list", "auto_reply"].includes(precedence)) return true;
	if (getInboundHeader(parsed, "list-id") || getInboundHeader(parsed, "list-unsubscribe")) return true;

	return false;
}

async function handleInboundAutomation(
	env: Env,
	stub: ReturnType<Env["MAILBOX"]["get"]>,
	mailboxId: string,
	settings: MailboxStoredSettings,
	parsed: ParsedInboundEmail,
	threadId: string,
) {
	const sender = parsed.from?.address?.toLowerCase() || "";

	// -- Forwarding --
	const forwardTarget = settings.forwarding?.enabled
		? (settings.forwarding.email || "").trim().toLowerCase()
		: "";
	if (
		forwardTarget &&
		forwardTarget.includes("@") &&
		forwardTarget !== mailboxId.toLowerCase() &&
		forwardTarget !== sender
	) {
		const safeSender = escapeHtml(parsed.from?.address || "unknown");
		const safeSubject = escapeHtml(parsed.subject || "(no subject)");
		const originalBody = parsed.html || (parsed.text ? textToHtml(parsed.text) : "");
		const forwardBody = `<div><strong>Forwarded message</strong><br><strong>From:</strong> ${safeSender}<br><strong>Subject:</strong> ${safeSubject}<br><br></div>${originalBody}`;
		try {
			await sendEmail(env.EMAIL, {
				to: forwardTarget,
				from: mailboxId,
				subject: `Fwd: ${parsed.subject || "(no subject)"}`,
				html: forwardBody,
				headers: { "Auto-Submitted": "auto-forwarded" },
			});
		} catch (e) {
			console.error("Auto-forward failed:", (e as Error).message);
		}
	}

	// -- Auto-reply --
	const autoReply = settings.autoReply;
	if (!autoReply?.enabled || !autoReply.message || !sender) return;
	if (sender === mailboxId.toLowerCase()) return;
	if (isAutomatedMessage(parsed)) return;
	if (!(await (stub as any).shouldAutoReply(sender))) return;

	const replySubject =
		autoReply.subject?.trim() ||
		(parsed.subject ? `Re: ${parsed.subject}` : "Automatic reply");
	const replyBody = textToHtml(autoReply.message);
	const originalMsgId = parsed.messageId
		? parsed.messageId.replace(/^<|>$/g, "")
		: null;
	const fromDomain = mailboxId.split("@")[1] || "";
	const { messageId: replyId, outgoingMessageId } = generateMessageId(fromDomain);

	try {
		await sendEmail(env.EMAIL, {
			to: sender,
			from: mailboxId,
			subject: replySubject,
			html: replyBody,
			headers: {
				// RFC 3834: mark as automatic so other systems don't reply back.
				"Auto-Submitted": "auto-replied",
				"X-Auto-Response-Suppress": "All",
				...(originalMsgId ? buildThreadingHeaders(originalMsgId, []) : {}),
			},
		});
	} catch (e) {
		console.error("Auto-reply send failed:", (e as Error).message);
		return;
	}

	// Record the auto-reply in Sent so the conversation stays complete.
	await stub.createEmail(Folders.SENT, {
		id: replyId,
		subject: replySubject,
		sender: mailboxId.toLowerCase(),
		recipient: sender,
		date: new Date().toISOString(),
		body: replyBody,
		in_reply_to: originalMsgId,
		email_references: null,
		thread_id: threadId,
		message_id: outgoingMessageId,
	}, []);
}

export { app, receiveEmail };
