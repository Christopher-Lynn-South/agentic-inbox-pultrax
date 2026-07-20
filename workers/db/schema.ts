// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
	// Snooze: when set (and email is in the snoozed folder), the DO alarm
	// returns the email to `return_folder` at this ISO timestamp.
	snoozed_until: text("snoozed_until"),
	// Folder the email came from before snoozing (defaults to inbox).
	return_folder: text("return_folder"),
	// Scheduled send: when set (and email is in the scheduled folder), the
	// DO alarm sends the email at this ISO timestamp.
	send_at: text("send_at"),
});

export const templates = sqliteTable("templates", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	subject: text("subject"),
	body: text("body").notNull(),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

export const rules = sqliteTable("rules", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	// Field to match against: 'sender' | 'subject' | 'body'
	match_field: text("match_field").notNull(),
	// Case-insensitive substring the field must contain
	match_value: text("match_value").notNull(),
	// Action to apply: 'move' | 'star' | 'mark_read' | 'trash' | 'spam'
	action: text("action").notNull(),
	// Target folder when action = 'move'
	action_folder_id: text("action_folder_id"),
	enabled: integer("enabled").notNull().default(1),
	created_at: text("created_at").notNull(),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});
