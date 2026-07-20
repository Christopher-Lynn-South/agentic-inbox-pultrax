// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Checkbox, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { RobotIcon, ArrowCounterClockwiseIcon, ArrowBendUpRightIcon, ChatCenteredTextIcon, PenNibIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [signatureEnabled, setSignatureEnabled] = useState(false);
	const [signatureText, setSignatureText] = useState("");
	const [forwardingEnabled, setForwardingEnabled] = useState(false);
	const [forwardingEmail, setForwardingEmail] = useState("");
	const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
	const [autoReplySubject, setAutoReplySubject] = useState("");
	const [autoReplyMessage, setAutoReplyMessage] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
			setSignatureEnabled(mailbox.settings?.signature?.enabled ?? false);
			setSignatureText(mailbox.settings?.signature?.text || "");
			setForwardingEnabled(mailbox.settings?.forwarding?.enabled ?? false);
			setForwardingEmail(mailbox.settings?.forwarding?.email || "");
			setAutoReplyEnabled(mailbox.settings?.autoReply?.enabled ?? false);
			setAutoReplySubject(mailbox.settings?.autoReply?.subject || "");
			setAutoReplyMessage(mailbox.settings?.autoReply?.message || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
			signature: { enabled: signatureEnabled, text: signatureText },
			forwarding: { enabled: forwardingEnabled, email: forwardingEmail.trim() },
			autoReply: {
				enabled: autoReplyEnabled,
				subject: autoReplySubject.trim(),
				message: autoReplyMessage,
			},
		};
		try {
			await updateMailboxMutation.mutateAsync({ mailboxId, settings });
			toastManager.add({ title: "Settings saved!" });
		} catch {
			toastManager.add({
				title: "Failed to save settings",
				variant: "error",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => {
		setAgentPrompt("");
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;

	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

			<div className="space-y-6">
				{/* Account */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Account
					</div>
					<div className="space-y-3">
						<Input
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<Input label="Email" type="email" value={mailbox.email} disabled />
					</div>
				</div>

				{/* Signature */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center gap-2 mb-4">
						<PenNibIcon size={16} weight="duotone" className="text-kumo-subtle" />
						<span className="text-sm font-medium text-kumo-default">Signature</span>
					</div>
					<div className="space-y-3">
						<Checkbox
							label="Append a signature to new emails and replies"
							checked={signatureEnabled}
							onCheckedChange={setSignatureEnabled}
						/>
						{signatureEnabled && (
							<textarea
								value={signatureText}
								onChange={(e) => setSignatureText(e.target.value)}
								placeholder={"Best regards,\nYour name"}
								rows={3}
								className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
							/>
						)}
					</div>
				</div>

				{/* Forwarding */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center gap-2 mb-4">
						<ArrowBendUpRightIcon size={16} weight="duotone" className="text-kumo-subtle" />
						<span className="text-sm font-medium text-kumo-default">Forwarding</span>
					</div>
					<div className="space-y-3">
						<Checkbox
							label="Forward incoming emails to another address"
							checked={forwardingEnabled}
							onCheckedChange={setForwardingEnabled}
						/>
						{forwardingEnabled && (
							<Input
								label="Forward to"
								type="email"
								placeholder="someone@example.com"
								value={forwardingEmail}
								onChange={(e) => setForwardingEmail(e.target.value)}
							/>
						)}
					</div>
				</div>

				{/* Auto-reply */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center gap-2 mb-4">
						<ChatCenteredTextIcon size={16} weight="duotone" className="text-kumo-subtle" />
						<span className="text-sm font-medium text-kumo-default">Auto-reply</span>
					</div>
					<div className="space-y-3">
						<Checkbox
							label="Send an automatic reply to incoming emails"
							checked={autoReplyEnabled}
							onCheckedChange={setAutoReplyEnabled}
						/>
						{autoReplyEnabled && (
							<>
								<Input
									label="Subject (optional — defaults to Re: original subject)"
									placeholder="Out of office"
									value={autoReplySubject}
									onChange={(e) => setAutoReplySubject(e.target.value)}
								/>
								<textarea
									value={autoReplyMessage}
									onChange={(e) => setAutoReplyMessage(e.target.value)}
									placeholder="I'm away right now and will get back to you soon."
									rows={4}
									className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
								/>
								<p className="text-xs text-kumo-subtle">
									Each sender receives at most one auto-reply per 24 hours.
									Mailing lists and automated senders are skipped.
								</p>
							</>
						)}
					</div>
				</div>

				{/* Agent System Prompt */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								AI Agent Prompt
							</span>
							{isCustomPrompt ? (
								<Badge variant="primary">Custom</Badge>
							) : (
								<Badge variant="secondary">Default</Badge>
							)}
						</div>
						{isCustomPrompt && (
							<Button
								variant="ghost"
								size="xs"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetPrompt}
							>
								Reset to default
							</Button>
						)}
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Customize how the AI agent behaves for this mailbox.
						Leave empty to use the built-in default prompt.
					</p>
					<textarea
						value={agentPrompt}
						onChange={(e) => setAgentPrompt(e.target.value)}
						placeholder={PROMPT_PLACEHOLDER}
						rows={12}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
					/>
					<p className="text-xs text-kumo-subtle mt-2">
						The prompt is sent as the system message to the AI model.
						It controls the agent's personality, writing style, and behavior rules.
					</p>
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save Changes
					</Button>
				</div>
			</div>
		</div>
	);
}
