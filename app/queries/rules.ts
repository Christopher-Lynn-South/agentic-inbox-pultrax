// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Rule } from "~/types";
import { queryKeys } from "./keys";

export function useRules(mailboxId: string | undefined) {
	return useQuery<Rule[]>({
		queryKey: mailboxId
			? queryKeys.rules.list(mailboxId)
			: ["rules", "_disabled"],
		queryFn: () => api.listRules(mailboxId!),
		enabled: !!mailboxId,
	});
}

function useInvalidateRules() {
	const qc = useQueryClient();
	return (mailboxId: string) =>
		qc.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId) });
}

export function useCreateRule() {
	const invalidate = useInvalidateRules();
	return useMutation({
		mutationFn: ({
			mailboxId,
			rule,
		}: {
			mailboxId: string;
			rule: Omit<Rule, "id" | "created_at">;
		}) => api.createRule(mailboxId, rule),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateRule() {
	const invalidate = useInvalidateRules();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			rule,
		}: {
			mailboxId: string;
			id: string;
			rule: Partial<Omit<Rule, "id" | "created_at">>;
		}) => api.updateRule(mailboxId, id, rule),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useDeleteRule() {
	const invalidate = useInvalidateRules();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
			api.deleteRule(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
