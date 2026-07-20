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
	snoozed_until: text("snoozed_until"),
	scheduled_at: text("scheduled_at"),
});

export const labels = sqliteTable("labels", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	color: text("color").notNull().default("#8eaa92"),
});

export const emailLabels = sqliteTable("email_labels", {
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	label_id: text("label_id")
		.notNull()
		.references(() => labels.id, { onDelete: "cascade" }),
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
	enabled: integer("enabled").notNull().default(1),
	field: text("field").notNull(),
	pattern: text("pattern").notNull(),
	action: text("action").notNull(),
	action_value: text("action_value"),
	position: integer("position").notNull().default(0),
});

export const contacts = sqliteTable("contacts", {
	email: text("email").primaryKey(),
	name: text("name"),
	last_seen: text("last_seen"),
	times_seen: integer("times_seen").notNull().default(1),
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
