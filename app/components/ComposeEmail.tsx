// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Dialog, Input, Text } from "@cloudflare/kumo";
import {
	CalendarBlankIcon,
	CaretDownIcon,
	FileTextIcon,
	FloppyDiskIcon,
	PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useComposeForm } from "~/hooks/useComposeForm";
import { useContacts } from "~/queries/contacts";
import { useTemplates } from "~/queries/templates";
import type { Template } from "~/types";
import RichTextEditor from "./RichTextEditor";
import { useUIStore } from "~/hooks/useUIStore";

function getSchedulePresets(): { label: string; hint: string; at: Date }[] {
	const now = new Date();

	const tomorrowMorning = new Date(now);
	tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
	tomorrowMorning.setHours(8, 0, 0, 0);

	const nextMonday = new Date(now);
	const daysUntilMonday = ((8 - nextMonday.getDay()) % 7) || 7;
	nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
	nextMonday.setHours(8, 0, 0, 0);

	const dayFmt: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };
	return [
		{ label: "Tomorrow morning", hint: tomorrowMorning.toLocaleString(undefined, dayFmt), at: tomorrowMorning },
		{ label: "Monday morning", hint: nextMonday.toLocaleString(undefined, dayFmt), at: nextMonday },
	];
}

function ScheduleSendMenu({
	disabled,
	onSchedule,
}: {
	disabled: boolean;
	onSchedule: (iso: string) => void;
}) {
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

	const pick = (at: Date) => {
		onSchedule(at.toISOString());
		setOpen(false);
	};

	const handleCustom = () => {
		if (!customValue) return;
		const date = new Date(customValue);
		if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return;
		pick(date);
	};

	return (
		<div ref={ref} className="relative">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				shape="square"
				disabled={disabled}
				icon={<CaretDownIcon size={14} />}
				onClick={() => setOpen((o) => !o)}
				aria-label="Schedule send"
			/>
			{open && (
				<div className="absolute bottom-full right-0 z-50 mb-1 min-w-[230px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-kumo-subtle">
						<CalendarBlankIcon size={14} />
						Schedule send
					</div>
					<div className="h-px bg-kumo-line my-1" />
					{getSchedulePresets().map((preset) => (
						<button
							key={preset.label}
							type="button"
							className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => pick(preset.at)}
						>
							<span>{preset.label}</span>
							<span className="text-xs text-kumo-subtle">{preset.hint}</span>
						</button>
					))}
					<div className="h-px bg-kumo-line my-1" />
					<div className="px-3 py-2 space-y-2">
						<input
							type="datetime-local"
							value={customValue}
							onChange={(e) => setCustomValue(e.target.value)}
							className="w-full rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-xs text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-ring"
							aria-label="Custom send time"
						/>
						<Button
							type="button"
							variant="secondary"
							size="xs"
							onClick={handleCustom}
							disabled={!customValue}
							className="w-full"
						>
							Schedule for date
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function TemplateMenu({
	templates,
	onSelect,
}: {
	templates: Template[];
	onSelect: (template: Template) => void;
}) {
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
			<Button
				type="button"
				variant="ghost"
				size="sm"
				icon={<FileTextIcon size={14} />}
				onClick={() => setOpen((o) => !o)}
			>
				Templates
			</Button>
			{open && (
				<div className="absolute bottom-full left-0 z-50 mb-1 min-w-[220px] max-h-64 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Insert template</div>
					<div className="h-px bg-kumo-line my-1" />
					{templates.map((template) => (
						<button
							key={template.id}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => {
								onSelect(template);
								setOpen(false);
							}}
						>
							<div className="truncate">{template.name}</div>
							{template.subject && (
								<div className="truncate text-xs text-kumo-subtle">{template.subject}</div>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export default function ComposeEmail() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const { isComposeModalOpen, closeComposeModal } = useUIStore();
	const { data: templates = [] } = useTemplates(mailboxId);
	const { data: contacts = [] } = useContacts(mailboxId);

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
		canSchedule,
		applyTemplate,
		handleSaveDraft,
		handleSend,
	} = useComposeForm(mailboxId, folder);

	const handleSchedule = (iso: string) => {
		const fakeEvent = { preventDefault: () => {} } as FormEvent;
		void handleSend(fakeEvent, closeComposeModal, iso);
	};

	return (
		<Dialog.Root
			open={isComposeModalOpen}
			onOpenChange={(open) => !open && !isSending && closeComposeModal()}
		>
			<Dialog size="lg" className="p-6 max-h-[85vh] overflow-y-auto">
				<Dialog.Title className="text-lg font-semibold mb-5">
					{formTitle}
				</Dialog.Title>
				<form onSubmit={(e) => handleSend(e, closeComposeModal)} className="space-y-4">
					{error && <Banner variant="error" text={error} />}
					{contacts.length > 0 && (
						<datalist id="compose-contact-suggestions">
							{contacts.map((contact) => (
								<option key={contact.email} value={contact.email} />
							))}
						</datalist>
					)}
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<Input
								label="To"
								type="text"
								placeholder="recipient@example.com, another@example.com"
								size="sm"
								value={to}
								onChange={(e) => setTo(e.target.value)}
								list="compose-contact-suggestions"
								required
							/>
						</div>
						{!showCcBcc && (
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium mt-5"
							>
								CC / BCC
							</button>
						)}
					</div>
					{showCcBcc && (
						<Input
							label="CC"
							type="text"
							size="sm"
							value={cc}
							onChange={(e) => setCc(e.target.value)}
							list="compose-contact-suggestions"
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					{showCcBcc && (
						<Input
							label="BCC"
							type="text"
							size="sm"
							value={bcc}
							onChange={(e) => setBcc(e.target.value)}
							list="compose-contact-suggestions"
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					<Input
						label="Subject"
						type="text"
						placeholder="Email subject"
						size="sm"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						required
					/>
					<div>
						<Text size="sm" DANGEROUS_className="font-medium mb-1.5 block">
							Message
						</Text>
						<RichTextEditor value={body} onChange={setBody} />
					</div>
					<div className="flex justify-between items-center pt-2">
						<div className="flex items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={closeComposeModal}
								disabled={isSending}
							>
								Discard
							</Button>
							<TemplateMenu templates={templates} onSelect={applyTemplate} />
						</div>
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
							<div className="flex items-center gap-0.5">
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
								{canSchedule && (
									<ScheduleSendMenu
										disabled={isSavingDraft || isSending}
										onSchedule={handleSchedule}
									/>
								)}
							</div>
						</div>
					</div>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
