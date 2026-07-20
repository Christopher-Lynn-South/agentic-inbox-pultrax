// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	snoozed_until?: string | null;
	scheduled_at?: string | null;
	labels?: Label[];
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Label {
	id: string;
	name: string;
	color: string;
	email_count?: number;
}

export interface Template {
	id: string;
	name: string;
	subject?: string | null;
	body: string;
	created_at?: string;
	updated_at?: string;
}

export type RuleField = "sender" | "recipient" | "subject" | "body" | "any";
export type RuleAction = "move" | "label" | "star" | "mark_read";

export interface Rule {
	id: string;
	name: string;
	enabled: number | boolean;
	field: RuleField;
	pattern: string;
	action: RuleAction;
	action_value?: string | null;
	position: number;
}

export interface Contact {
	email: string;
	name?: string | null;
	last_seen?: string | null;
	times_seen: number;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}
