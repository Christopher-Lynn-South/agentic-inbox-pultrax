// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { SignOutIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, rewriteInlineImages } from "~/lib/utils";
import type { Email } from "~/types";

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	onPreviewImage: (url: string, filename: string) => void;
}

/**
 * Extract an unsubscribe link from the stored List-Unsubscribe header
 * (RFC 2369). Prefers an https URL over mailto. Returns null when the
 * email has no parseable unsubscribe target.
 */
export function getUnsubscribeLink(rawHeaders?: string | null): string | null {
	if (!rawHeaders) return null;
	let headers: unknown;
	try {
		headers = JSON.parse(rawHeaders);
	} catch {
		return null;
	}
	if (!Array.isArray(headers)) return null;
	const header = headers.find(
		(h) => typeof h?.key === "string" && h.key.toLowerCase() === "list-unsubscribe",
	);
	const value = typeof header?.value === "string" ? header.value : "";
	if (!value) return null;

	const targets = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
	const https = targets.find((t) => /^https?:\/\//i.test(t));
	if (https) return https;
	const mailto = targets.find((t) => /^mailto:/i.test(t));
	return mailto || null;
}

export default function SingleMessageView({
	email,
	mailboxId,
	onPreviewImage,
}: SingleMessageViewProps) {
	const unsubscribeLink = useMemo(
		() => getUnsubscribeLink(email.raw_headers),
		[email.raw_headers],
	);

	return (
		<div className="flex flex-col h-full">
			<div className="px-4 py-4 border-b border-kumo-line md:px-6">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-xs font-bold text-kumo-default">
							{email.sender.charAt(0).toUpperCase()}
						</div>
						<div className="min-w-0">
							<div className="text-sm font-medium text-kumo-default truncate">
								{email.sender}
							</div>
							<div className="text-xs text-kumo-subtle">To: {email.recipient}</div>
						</div>
					</div>
					<div className="flex items-center gap-3 shrink-0">
						{unsubscribeLink && (
							<a
								href={unsubscribeLink}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
								title="Open this sender's unsubscribe link"
							>
								<SignOutIcon size={13} />
								Unsubscribe
							</a>
						)}
						<span className="text-xs text-kumo-subtle">
							{formatDetailDate(email.date)}
						</span>
					</div>
				</div>
			</div>

			<div className="flex-1 min-h-0">
				<EmailIframe
					body={rewriteInlineImages(
						email.body || "",
						mailboxId || "",
						email.id,
						email.attachments,
					)}
				/>
			</div>

			<EmailAttachmentList
				mailboxId={mailboxId}
				emailId={email.id}
				attachments={email.attachments}
				onPreviewImage={onPreviewImage}
				className="px-4 py-3 border-t border-kumo-line shrink-0 md:px-6"
				showHeading
			/>
		</div>
	);
}
