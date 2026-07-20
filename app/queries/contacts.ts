// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { Contact } from "~/types";
import { queryKeys } from "./keys";

/**
 * Contacts auto-collected from mail traffic, used for composer
 * autocomplete. Cached for a minute — the list changes slowly.
 */
export function useContacts(mailboxId: string | undefined, query = "") {
	return useQuery<Contact[]>({
		queryKey: mailboxId
			? queryKeys.contacts.list(mailboxId, query)
			: ["contacts", "_disabled"],
		queryFn: () => api.listContacts(mailboxId!, query || undefined),
		enabled: !!mailboxId,
		staleTime: 60_000,
	});
}
