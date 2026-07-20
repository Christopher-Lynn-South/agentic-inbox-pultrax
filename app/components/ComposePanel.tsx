// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input, Tooltip } from "@cloudflare/kumo";
import { CaretDownIcon, ClockIcon, FileTextIcon, FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useComposeForm } from "~/hooks/useComposeForm";
import { useContacts, useTemplates } from "~/queries/organizer";
import type { Template } from "~/types";
import RichTextEditor from "./RichTextEditor";

function TemplatePicker({
	templates,
	onSelect,
}: { templates: Template[]; onSelect: (t: Template) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	if (templates.length === 0) return null;

	return (
		<div ref={ref} className="relative">
			<Tooltip content="Insert template" side="bottom" asChild>
				<Button
					variant="ghost"
					size="sm"
					icon={<FileTextIcon size={16} />}
					onClick={() => setOpen((o) => !o)}
				>
					Templates
					<CaretDownIcon size={12} />
				</Button>
			</Tooltip>
			{open && (
				<div className="absolute top-full right-0 z-50 mt-1 min-w-[220px] max-h-64 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					{templates.map((t) => (
						<button
							key={t.id}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => { onSelect(t); setOpen(false); }}
						>
							<div className="font-medium truncate">{t.name}</div>
							{t.subject && <div className="text-xs text-kumo-subtle truncate">{t.subject}</div>}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ScheduleSendMenu({
	disabled,
	onSchedule,
}: { disabled: boolean; onSchedule: (sendAt: string) => void }) {
	const [open, setOpen] = useState(false);
	const [customValue, setCustomValue] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const presets = () => {
		const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(8, 0, 0, 0);
		const monday = new Date();
		monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7 || 7));
		monday.setHours(8, 0, 0, 0);
		return [
			{ label: "In 1 hour", date: inOneHour },
			{ label: "Tomorrow 8:00 AM", date: tomorrow },
			{ label: "Monday 8:00 AM", date: monday },
		];
	};

	return (
		<div ref={ref} className="relative">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={disabled}
				icon={<ClockIcon size={14} />}
				onClick={() => setOpen((o) => !o)}
			>
				Send Later
			</Button>
			{open && (
				<div className="absolute bottom-full right-0 z-50 mb-1 min-w-[230px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Send at</div>
					<div className="h-px bg-kumo-line my-1" />
					{presets().map((preset) => (
						<button
							key={preset.label}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => { onSchedule(preset.date.toISOString()); setOpen(false); }}
						>
							{preset.label}
						</button>
					))}
					<div className="h-px bg-kumo-line my-1" />
					<div className="px-3 py-1.5 flex items-center gap-2">
						<input
							type="datetime-local"
							value={customValue}
							onChange={(e) => setCustomValue(e.target.value)}
							className="flex-1 text-xs rounded border border-kumo-line bg-kumo-recessed px-1.5 py-1 text-kumo-default"
						/>
						<Button
							variant="secondary"
							size="xs"
							disabled={!customValue || new Date(customValue).getTime() <= Date.now()}
							onClick={() => {
								onSchedule(new Date(customValue).toISOString());
								setOpen(false);
								setCustomValue("");
							}}
						>
							Set
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export default function ComposePanel() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		handleScheduleSend,
		applyTemplate,
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId, folder);

	const { data: templates = [] } = useTemplates(mailboxId);
	const { data: contacts = [] } = useContacts(mailboxId, "");

	return (
		<div className="flex flex-col h-full bg-kumo-base">
			<div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
				<h2 className="text-base font-semibold text-kumo-default">
					{formTitle}
				</h2>
				<div className="flex items-center gap-1">
					<TemplatePicker templates={templates} onSelect={applyTemplate} />
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={closeCompose}
						disabled={isSending}
						aria-label="Close compose"
					/>
				</div>
			</div>

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex flex-col flex-1 min-h-0 overflow-y-auto"
			>
				<div className="p-4 md:p-6 space-y-4">
					{error && <Banner variant="error" text={error} />}

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								To
							</label>
							<div className="flex-1 flex items-center gap-2 min-w-0">
								<Input
									type="text"
									placeholder="recipient@example.com"
									size="sm"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									required
									list="compose-contact-suggestions"
								/>
								<datalist id="compose-contact-suggestions">
									{contacts.map((contact) => (
										<option key={contact.email} value={contact.email}>
											{contact.name || undefined}
										</option>
									))}
								</datalist>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
									>
										CC / BCC
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									CC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={cc}
										onChange={(e) => setCc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									BCC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={bcc}
										onChange={(e) => setBcc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								Subject
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="Email subject"
									size="sm"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					<div className="border border-kumo-line rounded-md overflow-hidden bg-kumo-base">
						<RichTextEditor
							value={body}
							onChange={setBody}
						/>
					</div>
				</div>

				{/* Footer actions */}
				<div className="mt-auto px-4 py-3 border-t border-kumo-line bg-kumo-fill/30 shrink-0 md:px-6">
					<div className="flex items-center justify-between">
						<Button type="button" variant="ghost" size="sm" onClick={closeCompose} disabled={isSending}>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<ScheduleSendMenu
								disabled={isSavingDraft || isSending}
								onSchedule={(sendAt) => handleScheduleSend(sendAt, closePanel)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
