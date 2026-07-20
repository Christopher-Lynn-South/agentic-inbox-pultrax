// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArrowCounterClockwiseIcon,
	ChatCircleTextIcon,
	FileTextIcon,
	FunnelIcon,
	PenNibIcon,
	PlusIcon,
	RobotIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { useFolders } from "~/queries/folders";
import {
	useCreateRule,
	useCreateTemplate,
	useDeleteRule,
	useDeleteTemplate,
	useLabels,
	useRules,
	useTemplates,
	useUpdateRule,
	useUpdateTemplate,
} from "~/queries/organizer";
import type { Rule, RuleAction, RuleField, Template } from "~/types";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

const RULE_FIELDS: { value: RuleField; label: string }[] = [
	{ value: "sender", label: "Sender" },
	{ value: "recipient", label: "Recipient" },
	{ value: "subject", label: "Subject" },
	{ value: "body", label: "Body" },
	{ value: "any", label: "Anywhere" },
];

const RULE_ACTIONS: { value: RuleAction; label: string }[] = [
	{ value: "move", label: "Move to folder" },
	{ value: "label", label: "Apply label" },
	{ value: "star", label: "Star" },
	{ value: "mark_read", label: "Mark as read" },
];

const selectClass =
	"rounded-lg border border-kumo-line bg-kumo-recessed px-2 py-1.5 text-sm text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-ring";

function TemplatesSection({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const { data: templates = [] } = useTemplates(mailboxId);
	const createTemplate = useCreateTemplate();
	const updateTemplate = useUpdateTemplate();
	const deleteTemplate = useDeleteTemplate();

	const [editingId, setEditingId] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");

	const resetForm = () => {
		setEditingId(null);
		setShowForm(false);
		setName("");
		setSubject("");
		setBody("");
	};

	const startEdit = (t: Template) => {
		setEditingId(t.id);
		setShowForm(true);
		setName(t.name);
		setSubject(t.subject || "");
		setBody(t.body);
	};

	const handleSave = async () => {
		if (!name.trim() || !body.trim()) return;
		try {
			if (editingId) {
				await updateTemplate.mutateAsync({ mailboxId, id: editingId, data: { name, subject, body } });
			} else {
				await createTemplate.mutateAsync({ mailboxId, data: { name, subject: subject || undefined, body } });
			}
			toastManager.add({ title: editingId ? "Template updated" : "Template created" });
			resetForm();
		} catch {
			toastManager.add({ title: "Failed to save template", variant: "error" });
		}
	};

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<FileTextIcon size={16} weight="duotone" className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">Email Templates</span>
					{templates.length > 0 && <Badge variant="secondary">{templates.length}</Badge>}
				</div>
				{!showForm && (
					<Button variant="ghost" size="xs" icon={<PlusIcon size={14} />} onClick={() => setShowForm(true)}>
						New template
					</Button>
				)}
			</div>
			<p className="text-xs text-kumo-subtle mb-3">
				Canned responses you can insert when composing. The AI agent can also use them as the basis for drafts.
			</p>

			{templates.length > 0 && (
				<div className="space-y-1.5 mb-3">
					{templates.map((t) => (
						<div key={t.id} className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2">
							<button type="button" onClick={() => startEdit(t)} className="flex-1 min-w-0 text-left cursor-pointer">
								<div className="text-sm font-medium text-kumo-default truncate">{t.name}</div>
								{t.subject && <div className="text-xs text-kumo-subtle truncate">{t.subject}</div>}
							</button>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<TrashIcon size={14} />}
								aria-label={`Delete template ${t.name}`}
								onClick={() => deleteTemplate.mutate({ mailboxId, id: t.id })}
							/>
						</div>
					))}
				</div>
			)}

			{showForm && (
				<div className="space-y-3 rounded-md border border-kumo-line bg-kumo-recessed p-3">
					<Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. On our way" />
					<Input label="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your technician is on the way" />
					<div>
						<div className="text-sm font-medium text-kumo-default mb-1">Body</div>
						<textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={5}
							placeholder="Hi, just letting you know your job is scheduled..."
							className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
						/>
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={resetForm}>Cancel</Button>
						<Button variant="primary" size="sm" disabled={!name.trim() || !body.trim()} onClick={handleSave}>
							{editingId ? "Update" : "Create"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function RulesSection({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const { data: rules = [] } = useRules(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: labels = [] } = useLabels(mailboxId);
	const createRule = useCreateRule();
	const updateRule = useUpdateRule();
	const deleteRule = useDeleteRule();

	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [field, setField] = useState<RuleField>("sender");
	const [pattern, setPattern] = useState("");
	const [action, setAction] = useState<RuleAction>("move");
	const [actionValue, setActionValue] = useState("");

	const needsValue = action === "move" || action === "label";

	const resetForm = () => {
		setShowForm(false);
		setName("");
		setField("sender");
		setPattern("");
		setAction("move");
		setActionValue("");
	};

	const handleCreate = async () => {
		if (!name.trim() || !pattern.trim() || (needsValue && !actionValue)) return;
		try {
			await createRule.mutateAsync({
				mailboxId,
				data: { name, field, pattern, action, action_value: needsValue ? actionValue : undefined, enabled: true },
			});
			toastManager.add({ title: "Rule created" });
			resetForm();
		} catch {
			toastManager.add({ title: "Failed to create rule", variant: "error" });
		}
	};

	const describeRule = (r: Rule) => {
		const fieldLabel = RULE_FIELDS.find((f) => f.value === r.field)?.label || r.field;
		const actionLabel = RULE_ACTIONS.find((a) => a.value === r.action)?.label || r.action;
		let target = "";
		if (r.action === "move") {
			target = ` "${folders.find((f) => f.id === r.action_value)?.name || r.action_value}"`;
		} else if (r.action === "label") {
			target = ` "${labels.find((l) => l.id === r.action_value)?.name || r.action_value}"`;
		}
		return `If ${fieldLabel.toLowerCase()} contains "${r.pattern}" → ${actionLabel.toLowerCase()}${target}`;
	};

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<FunnelIcon size={16} weight="duotone" className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">Inbox Rules</span>
					{rules.length > 0 && <Badge variant="secondary">{rules.length}</Badge>}
				</div>
				{!showForm && (
					<Button variant="ghost" size="xs" icon={<PlusIcon size={14} />} onClick={() => setShowForm(true)}>
						New rule
					</Button>
				)}
			</div>
			<p className="text-xs text-kumo-subtle mb-3">
				Automatically file, label, star, or mark incoming email. Rules run in order when a message arrives.
			</p>

			{rules.length > 0 && (
				<div className="space-y-1.5 mb-3">
					{rules.map((r) => (
						<div key={r.id} className="flex items-center gap-3 rounded-md border border-kumo-line px-3 py-2">
							<div className="flex-1 min-w-0">
								<div className="text-sm font-medium text-kumo-default truncate">{r.name}</div>
								<div className="text-xs text-kumo-subtle truncate">{describeRule(r)}</div>
							</div>
							<Switch
								checked={!!r.enabled}
								onChange={() =>
									updateRule.mutate({ mailboxId, id: r.id, data: { enabled: !r.enabled } })
								}
								aria-label={`Enable rule ${r.name}`}
							/>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<TrashIcon size={14} />}
								aria-label={`Delete rule ${r.name}`}
								onClick={() => deleteRule.mutate({ mailboxId, id: r.id })}
							/>
						</div>
					))}
				</div>
			)}

			{showForm && (
				<div className="space-y-3 rounded-md border border-kumo-line bg-kumo-recessed p-3">
					<Input label="Rule name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. File invoices" />
					<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
						<span>If</span>
						<select value={field} onChange={(e) => setField(e.target.value as RuleField)} className={selectClass}>
							{RULE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
						</select>
						<span>contains</span>
						<input
							value={pattern}
							onChange={(e) => setPattern(e.target.value)}
							placeholder="text to match"
							className="flex-1 min-w-[120px] rounded-lg border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
						<span>then</span>
						<select
							value={action}
							onChange={(e) => { setAction(e.target.value as RuleAction); setActionValue(""); }}
							className={selectClass}
						>
							{RULE_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
						</select>
						{action === "move" && (
							<select value={actionValue} onChange={(e) => setActionValue(e.target.value)} className={selectClass}>
								<option value="">Choose folder…</option>
								{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
							</select>
						)}
						{action === "label" && (
							<select value={actionValue} onChange={(e) => setActionValue(e.target.value)} className={selectClass}>
								<option value="">Choose label…</option>
								{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
							</select>
						)}
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={resetForm}>Cancel</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!name.trim() || !pattern.trim() || (needsValue && !actionValue)}
							onClick={handleCreate}
						>
							Create rule
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [signatureEnabled, setSignatureEnabled] = useState(false);
	const [signatureText, setSignatureText] = useState("");
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
			autoReply: {
				enabled: autoReplyEnabled,
				subject: autoReplySubject,
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
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<PenNibIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">Signature</span>
						</div>
						<Switch
							checked={signatureEnabled}
							onChange={() => setSignatureEnabled((v) => !v)}
							aria-label="Enable signature"
						/>
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Appended automatically when composing new emails and replies.
					</p>
					<textarea
						value={signatureText}
						onChange={(e) => setSignatureText(e.target.value)}
						placeholder={"Best regards,\nThe JobArrival team"}
						rows={3}
						disabled={!signatureEnabled}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring disabled:opacity-50"
					/>
				</div>

				{/* Auto-reply */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<ChatCircleTextIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">Auto-Reply</span>
						</div>
						<Switch
							checked={autoReplyEnabled}
							onChange={() => setAutoReplyEnabled((v) => !v)}
							aria-label="Enable auto-reply"
						/>
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Automatically reply to incoming email. Each sender receives at most one
						auto-reply per 24 hours, and automated senders (no-reply, mailer-daemon)
						are never replied to.
					</p>
					<div className="space-y-3">
						<Input
							label="Subject"
							value={autoReplySubject}
							onChange={(e) => setAutoReplySubject(e.target.value)}
							placeholder="e.g. We received your message"
							disabled={!autoReplyEnabled}
						/>
						<textarea
							value={autoReplyMessage}
							onChange={(e) => setAutoReplyMessage(e.target.value)}
							placeholder={"Thanks for reaching out! We'll get back to you within one business day."}
							rows={3}
							disabled={!autoReplyEnabled}
							className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring disabled:opacity-50"
						/>
					</div>
				</div>

				{/* Templates */}
				{mailboxId && <TemplatesSection mailboxId={mailboxId} />}

				{/* Rules */}
				{mailboxId && <RulesSection mailboxId={mailboxId} />}

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
