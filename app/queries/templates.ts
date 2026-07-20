// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Template } from "~/types";
import { queryKeys } from "./keys";

export function useTemplates(mailboxId: string | undefined) {
	return useQuery<Template[]>({
		queryKey: mailboxId
			? queryKeys.templates.list(mailboxId)
			: ["templates", "_disabled"],
		queryFn: () => api.listTemplates(mailboxId!),
		enabled: !!mailboxId,
	});
}

function useInvalidateTemplates() {
	const qc = useQueryClient();
	return (mailboxId: string) =>
		qc.invalidateQueries({ queryKey: queryKeys.templates.list(mailboxId) });
}

export function useCreateTemplate() {
	const invalidate = useInvalidateTemplates();
	return useMutation({
		mutationFn: ({
			mailboxId,
			template,
		}: {
			mailboxId: string;
			template: { name: string; subject?: string; body: string };
		}) => api.createTemplate(mailboxId, template),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateTemplate() {
	const invalidate = useInvalidateTemplates();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			template,
		}: {
			mailboxId: string;
			id: string;
			template: { name?: string; subject?: string; body?: string };
		}) => api.updateTemplate(mailboxId, id, template),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useDeleteTemplate() {
	const invalidate = useInvalidateTemplates();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteTemplate(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
