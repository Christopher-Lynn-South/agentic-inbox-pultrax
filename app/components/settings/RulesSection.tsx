// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { FunnelIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { getFolderDisplayName } from "shared/folders";
import { useFolders } from "~/queries/folders";
import { useCreateRule, useDeleteRule, useRules, useUpdateRule } from "~/queries/rules";
import type { Rule, RuleAction, RuleField } from "~/types";

const FIELD_LABELS: Record<RuleField, string> = {
	sender: "Sender",
	subject: "Subject",
	body: "Body",
};

const ACTION_LABELS: Record<RuleAction, string> = {
	move: "Move to folder",
	star: "Star",
	mark_read: "Mark as read",
	trash: "Move to trash",
	spam: "Mark as spam",
};

function describeRule(rule: Rule): string {
	const action =
		rule.action === "move"
			? `move to ${getFolderDisplayName(rule.action_folder_id || "")}`
			: ACTION_LABELS[rule.action].toLowerCase();
	return `If ${FIELD_LABELS[rule.match_field].toLowerCase()} contains "${rule.match_value}" → ${action}`;
}

const selectClasses =
	"rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-ring";

interface RuleFormState {
	name: string;
	match_field: RuleField;
	match_value: string;
	action: RuleAction;
	action_folder_id: string;
}

const EMPTY_FORM: RuleFormState = {
	name: "",
	match_field: "sender",
	match_value: "",
	action: "move",
	action_folder_id: "",
};

export default function RulesSection({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const { data: rules = [] } = useRules(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const createMutation = useCreateRule();
	const updateMutation = useUpdateRule();
	const deleteMutation = useDeleteRule();

	const [isCreating, setIsCreating] = useState(false);
	const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);

	// Sensible move targets: everything except sent/draft/scheduled/snoozed
	const moveTargets = folders.filter(
		(f) => !["sent", "draft", "scheduled", "snoozed"].includes(f.id),
	);

	const handleCreate = async () => {
		if (!form.name.trim() || !form.match_value.trim()) return;
		if (form.action === "move" && !form.action_folder_id) return;
		try {
			await createMutation.mutateAsync({
				mailboxId,
				rule: {
					name: form.name.trim(),
					match_field: form.match_field,
					match_value: form.match_value.trim(),
					action: form.action,
					action_folder_id: form.action === "move" ? form.action_folder_id : null,
					enabled: true,
				},
			});
			toastManager.add({ title: "Rule created" });
			setForm(EMPTY_FORM);
			setIsCreating(false);
		} catch {
			toastManager.add({ title: "Failed to create rule", variant: "error" });
		}
	};

	const handleToggle = (rule: Rule) => {
		updateMutation.mutate(
			{ mailboxId, id: rule.id, rule: { enabled: !rule.enabled } },
			{
				onError: () =>
					toastManager.add({ title: "Failed to update rule", variant: "error" }),
			},
		);
	};

	const handleDelete = (rule: Rule) => {
		if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
		deleteMutation.mutate(
			{ mailboxId, id: rule.id },
			{
				onSuccess: () => toastManager.add({ title: "Rule deleted" }),
				onError: () =>
					toastManager.add({ title: "Failed to delete rule", variant: "error" }),
			},
		);
	};

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<FunnelIcon size={16} weight="duotone" className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">Inbox Rules</span>
					{rules.length > 0 && <Badge variant="secondary">{rules.length}</Badge>}
				</div>
				{!isCreating && (
					<Button
						variant="secondary"
						size="xs"
						icon={<PlusIcon size={14} />}
						onClick={() => setIsCreating(true)}
					>
						New rule
					</Button>
				)}
			</div>
			<p className="text-xs text-kumo-subtle mb-3">
				Automatically organize incoming email. Rules run in order when a new email
				arrives; the first folder action wins.
			</p>

			{rules.length === 0 && !isCreating && (
				<div className="text-sm text-kumo-subtle py-3 text-center border border-dashed border-kumo-line rounded-lg">
					No rules yet
				</div>
			)}

			{rules.length > 0 && (
				<div className="space-y-1.5 mb-3">
					{rules.map((rule) => (
						<div
							key={rule.id}
							className="flex items-center gap-2 rounded-lg border border-kumo-line px-3 py-2"
						>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-sm text-kumo-default truncate">{rule.name}</span>
									{!rule.enabled && <Badge variant="secondary">Paused</Badge>}
								</div>
								<div className="text-xs text-kumo-subtle truncate">{describeRule(rule)}</div>
							</div>
							<Button
								variant="ghost"
								size="xs"
								onClick={() => handleToggle(rule)}
							>
								{rule.enabled ? "Pause" : "Enable"}
							</Button>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<TrashIcon size={14} />}
								onClick={() => handleDelete(rule)}
								aria-label={`Delete rule ${rule.name}`}
							/>
						</div>
					))}
				</div>
			)}

			{isCreating && (
				<div className="rounded-lg border border-kumo-line bg-kumo-recessed p-4 space-y-3">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-kumo-default uppercase tracking-wider">
							New rule
						</span>
						<Button
							variant="ghost"
							shape="square"
							size="xs"
							icon={<XIcon size={14} />}
							onClick={() => setIsCreating(false)}
							aria-label="Close rule editor"
						/>
					</div>
					<Input
						label="Name"
						size="sm"
						placeholder="e.g. Newsletters to archive"
						value={form.name}
						onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
					/>
					<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
						<span className="text-kumo-subtle">If</span>
						<select
							className={selectClasses}
							value={form.match_field}
							onChange={(e) =>
								setForm((f) => ({ ...f, match_field: e.target.value as RuleField }))
							}
							aria-label="Match field"
						>
							{Object.entries(FIELD_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
						<span className="text-kumo-subtle">contains</span>
						<input
							type="text"
							className={`${selectClasses} flex-1 min-w-[140px]`}
							placeholder="e.g. newsletter@"
							value={form.match_value}
							onChange={(e) => setForm((f) => ({ ...f, match_value: e.target.value }))}
							aria-label="Match value"
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
						<span className="text-kumo-subtle">Then</span>
						<select
							className={selectClasses}
							value={form.action}
							onChange={(e) =>
								setForm((f) => ({ ...f, action: e.target.value as RuleAction }))
							}
							aria-label="Rule action"
						>
							{Object.entries(ACTION_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
						{form.action === "move" && (
							<select
								className={selectClasses}
								value={form.action_folder_id}
								onChange={(e) =>
									setForm((f) => ({ ...f, action_folder_id: e.target.value }))
								}
								aria-label="Target folder"
							>
								<option value="">Choose folder…</option>
								{moveTargets.map((folder) => (
									<option key={folder.id} value={folder.id}>
										{folder.name}
									</option>
								))}
							</select>
						)}
					</div>
					<div className="flex justify-end">
						<Button
							variant="primary"
							size="sm"
							loading={createMutation.isPending}
							disabled={
								!form.name.trim() ||
								!form.match_value.trim() ||
								(form.action === "move" && !form.action_folder_id)
							}
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
