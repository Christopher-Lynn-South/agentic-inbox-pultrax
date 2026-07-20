// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Query hooks for the mailbox organizer features: labels, templates,
 * inbox rules, and auto-collected contacts.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Contact, Label, Rule, Template } from "~/types";
import { queryKeys } from "./keys";

// ---------- Labels ----------

export function useLabels(mailboxId: string | undefined) {
	return useQuery<Label[]>({
		queryKey: mailboxId
			? queryKeys.labels.list(mailboxId)
			: ["labels", "_disabled"],
		queryFn: () => api.listLabels(mailboxId!),
		enabled: !!mailboxId,
	});
}

function useInvalidateLabels() {
	const qc = useQueryClient();
	return (mailboxId: string) => {
		qc.invalidateQueries({ queryKey: queryKeys.labels.list(mailboxId) });
		// Email detail caches embed labels
		qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
	};
}

export function useCreateLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			name,
			color,
		}: { mailboxId: string; name: string; color?: string }) =>
			api.createLabel(mailboxId, name, color),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: { mailboxId: string; id: string; data: { name?: string; color?: string } }) =>
			api.updateLabel(mailboxId, id, data),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useDeleteLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteLabel(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useAddEmailLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			labelId,
		}: { mailboxId: string; emailId: string; labelId: string }) =>
			api.addEmailLabel(mailboxId, emailId, labelId),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useRemoveEmailLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			labelId,
		}: { mailboxId: string; emailId: string; labelId: string }) =>
			api.removeEmailLabel(mailboxId, emailId, labelId),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

// ---------- Templates ----------

export function useTemplates(mailboxId: string | undefined) {
	return useQuery<Template[]>({
		queryKey: mailboxId
			? queryKeys.templates.list(mailboxId)
			: ["templates", "_disabled"],
		queryFn: () => api.listTemplates(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useCreateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: { mailboxId: string; data: { name: string; subject?: string; body: string } }) =>
			api.createTemplate(mailboxId, data),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) }),
	});
}

export function useUpdateTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: { mailboxId: string; id: string; data: { name?: string; subject?: string; body?: string } }) =>
			api.updateTemplate(mailboxId, id, data),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) }),
	});
}

export function useDeleteTemplate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteTemplate(mailboxId, id),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) }),
	});
}

// ---------- Rules ----------

export function useRules(mailboxId: string | undefined) {
	return useQuery<Rule[]>({
		queryKey: mailboxId
			? queryKeys.rules.list(mailboxId)
			: ["rules", "_disabled"],
		queryFn: () => api.listRules(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useCreateRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			data,
		}: { mailboxId: string; data: Omit<Rule, "id" | "position"> }) =>
			api.createRule(mailboxId, data),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId) }),
	});
}

export function useUpdateRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: { mailboxId: string; id: string; data: Partial<Omit<Rule, "id">> }) =>
			api.updateRule(mailboxId, id, data),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId) }),
	});
}

export function useDeleteRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteRule(mailboxId, id),
		onSuccess: (_d, { mailboxId }) =>
			qc.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId) }),
	});
}

// ---------- Contacts ----------

export function useContacts(mailboxId: string | undefined, query: string) {
	return useQuery<Contact[]>({
		queryKey: mailboxId
			? queryKeys.contacts.list(mailboxId, query)
			: ["contacts", "_disabled"],
		queryFn: () => api.listContacts(mailboxId!, query || undefined, 15),
		enabled: !!mailboxId,
		staleTime: 30_000,
	});
}
