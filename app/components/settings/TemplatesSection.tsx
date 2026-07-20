// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { FileTextIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
	useCreateTemplate,
	useDeleteTemplate,
	useTemplates,
	useUpdateTemplate,
} from "~/queries/templates";
import type { Template } from "~/types";

interface TemplateFormState {
	name: string;
	subject: string;
	body: string;
}

const EMPTY_FORM: TemplateFormState = { name: "", subject: "", body: "" };

export default function TemplatesSection({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const { data: templates = [] } = useTemplates(mailboxId);
	const createMutation = useCreateTemplate();
	const updateMutation = useUpdateTemplate();
	const deleteMutation = useDeleteTemplate();

	// null = closed, "new" = creating, otherwise the template id being edited
	const [editorTarget, setEditorTarget] = useState<string | null>(null);
	const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);

	const openNew = () => {
		setForm(EMPTY_FORM);
		setEditorTarget("new");
	};

	const openEdit = (template: Template) => {
		setForm({
			name: template.name,
			subject: template.subject || "",
			body: template.body,
		});
		setEditorTarget(template.id);
	};

	const handleSave = async () => {
		if (!form.name.trim() || !form.body.trim()) return;
		try {
			if (editorTarget === "new") {
				await createMutation.mutateAsync({
					mailboxId,
					template: {
						name: form.name.trim(),
						subject: form.subject.trim() || undefined,
						body: form.body,
					},
				});
				toastManager.add({ title: "Template created" });
			} else if (editorTarget) {
				await updateMutation.mutateAsync({
					mailboxId,
					id: editorTarget,
					template: {
						name: form.name.trim(),
						subject: form.subject.trim(),
						body: form.body,
					},
				});
				toastManager.add({ title: "Template updated" });
			}
			setEditorTarget(null);
		} catch {
			toastManager.add({ title: "Failed to save template", variant: "error" });
		}
	};

	const handleDelete = (template: Template) => {
		if (!window.confirm(`Delete template "${template.name}"?`)) return;
		deleteMutation.mutate(
			{ mailboxId, id: template.id },
			{
				onSuccess: () => toastManager.add({ title: "Template deleted" }),
				onError: () =>
					toastManager.add({ title: "Failed to delete template", variant: "error" }),
			},
		);
	};

	const isSaving = createMutation.isPending || updateMutation.isPending;

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<FileTextIcon size={16} weight="duotone" className="text-kumo-subtle" />
					<span className="text-sm font-medium text-kumo-default">Email Templates</span>
					{templates.length > 0 && <Badge variant="secondary">{templates.length}</Badge>}
				</div>
				{editorTarget === null && (
					<Button variant="secondary" size="xs" icon={<PlusIcon size={14} />} onClick={openNew}>
						New template
					</Button>
				)}
			</div>
			<p className="text-xs text-kumo-subtle mb-3">
				Canned responses you can insert in the composer. The AI agent can also use them
				when drafting replies.
			</p>

			{templates.length === 0 && editorTarget === null && (
				<div className="text-sm text-kumo-subtle py-3 text-center border border-dashed border-kumo-line rounded-lg">
					No templates yet
				</div>
			)}

			{templates.length > 0 && (
				<div className="space-y-1.5 mb-3">
					{templates.map((template) => (
						<div
							key={template.id}
							className="flex items-center gap-2 rounded-lg border border-kumo-line px-3 py-2"
						>
							<div className="flex-1 min-w-0">
								<div className="text-sm text-kumo-default truncate">{template.name}</div>
								<div className="text-xs text-kumo-subtle truncate">
									{template.subject || template.body.slice(0, 80)}
								</div>
							</div>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<PencilSimpleIcon size={14} />}
								onClick={() => openEdit(template)}
								aria-label={`Edit template ${template.name}`}
							/>
							<Button
								variant="ghost"
								shape="square"
								size="xs"
								icon={<TrashIcon size={14} />}
								onClick={() => handleDelete(template)}
								aria-label={`Delete template ${template.name}`}
							/>
						</div>
					))}
				</div>
			)}

			{editorTarget !== null && (
				<div className="rounded-lg border border-kumo-line bg-kumo-recessed p-4 space-y-3">
					<div className="flex items-center justify-between">
						<span className="text-xs font-semibold text-kumo-default uppercase tracking-wider">
							{editorTarget === "new" ? "New template" : "Edit template"}
						</span>
						<Button
							variant="ghost"
							shape="square"
							size="xs"
							icon={<XIcon size={14} />}
							onClick={() => setEditorTarget(null)}
							aria-label="Close template editor"
						/>
					</div>
					<Input
						label="Name"
						size="sm"
						placeholder="e.g. Appointment confirmation"
						value={form.name}
						onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
					/>
					<Input
						label="Subject (optional)"
						size="sm"
						placeholder="Used when composing a new email"
						value={form.subject}
						onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
					/>
					<div>
						<span className="text-xs font-medium text-kumo-default block mb-1.5">Body</span>
						<textarea
							value={form.body}
							onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
							rows={6}
							placeholder={"Hi,\n\nThanks for reaching out..."}
							className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring leading-relaxed"
						/>
					</div>
					<div className="flex justify-end">
						<Button
							variant="primary"
							size="sm"
							loading={isSaving}
							disabled={!form.name.trim() || !form.body.trim()}
							onClick={handleSave}
						>
							{editorTarget === "new" ? "Create template" : "Save template"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
