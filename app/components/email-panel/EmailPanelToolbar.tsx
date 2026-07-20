// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import {
	AlarmIcon,
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	CalendarSlashIcon,
	ChatCircleIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSnoozedFolder?: boolean;
	isScheduledFolder?: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onToggleStar: () => void;
	onToggleRead: () => void;
	onMove: (folderId: string) => void;
	onSnooze?: (until: string) => void;
	onUnsnooze?: () => void;
	onCancelSchedule?: () => void;
	onViewSource: () => void;
	onDelete: () => void;
}

export default function EmailPanelToolbar({
	email,
	mailboxId,
	isDraftFolder,
	isSnoozedFolder,
	isScheduledFolder,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onReply,
	onReplyAll,
	onForward,
	onToggleStar,
	onToggleRead,
	onMove,
	onSnooze,
	onUnsnooze,
	onCancelSchedule,
	onViewSource,
	onDelete,
}: EmailPanelToolbarProps) {
	return (
		<div className="flex items-center gap-1 px-3 py-2 border-b border-kumo-line shrink-0 md:px-4">
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={<ArrowLeftIcon size={18} />}
				onClick={onBack}
				aria-label="Back to list"
				className="md:hidden shrink-0"
			/>

			{isDraftFolder ? (
				<>
					<Button
						variant="primary"
						size="sm"
						icon={<PaperPlaneTiltIcon size={16} />}
						onClick={onSendDraft}
						loading={isSending}
					>
						{isSending ? "Sending..." : "Send"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<PencilSimpleIcon size={16} />}
						onClick={onEditDraft}
					>
						Edit
					</Button>
				</>
			) : (
				<>
					<Tooltip content="Reply" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowBendUpLeftIcon size={18} />}
							onClick={onReply}
							aria-label="Reply"
						/>
					</Tooltip>
					<Tooltip content="Reply All" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ChatCircleIcon size={18} />}
							onClick={onReplyAll}
							aria-label="Reply All"
						/>
					</Tooltip>
					<Tooltip content="Forward" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowBendUpRightIcon size={18} />}
							onClick={onForward}
							aria-label="Forward"
						/>
					</Tooltip>
				</>
			)}

			<div className="h-5 w-px bg-kumo-fill mx-0.5" />

			<Tooltip content={email.starred ? "Unstar" : "Star"} side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={
						<StarIcon
							size={18}
							weight={email.starred ? "fill" : "regular"}
							className={email.starred ? "text-kumo-warning" : ""}
						/>
					}
					onClick={onToggleStar}
					aria-label={email.starred ? "Unstar" : "Star"}
				/>
			</Tooltip>

			<Tooltip content={email.read ? "Mark as unread" : "Mark as read"} side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={email.read ? <EnvelopeSimpleIcon size={18} /> : <EnvelopeOpenIcon size={18} />}
					onClick={onToggleRead}
					aria-label={email.read ? "Mark as unread" : "Mark as read"}
				/>
			</Tooltip>

			<MoveToFolderMenu folders={moveToFolders} onMove={onMove} />

			{!isDraftFolder && !isScheduledFolder && !isSnoozedFolder && onSnooze && (
				<SnoozeMenu onSnooze={onSnooze} />
			)}

			{isSnoozedFolder && onUnsnooze && (
				<Tooltip content="Unsnooze — return to inbox now" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<AlarmIcon size={18} className="text-kumo-warning" />}
						onClick={onUnsnooze}
						aria-label="Unsnooze"
					/>
				</Tooltip>
			)}

			{isScheduledFolder && onCancelSchedule && (
				<Tooltip content="Cancel scheduled send — move to drafts" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<CalendarSlashIcon size={18} />}
						onClick={onCancelSchedule}
						aria-label="Cancel scheduled send"
					/>
				</Tooltip>
			)}

			<div className="ml-auto flex items-center gap-0.5">
				<Tooltip content="View source" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<CodeIcon size={18} />}
						onClick={onViewSource}
						aria-label="View source"
					/>
				</Tooltip>
				<Tooltip content="Delete" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TrashIcon size={18} />}
						onClick={onDelete}
						aria-label="Delete"
					/>
				</Tooltip>
				<Tooltip content="Close" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={onBack}
						aria-label="Close"
						className="hidden md:inline-flex"
					/>
				</Tooltip>
			</div>
		</div>
	);
}

function getSnoozePresets(): { label: string; hint: string; until: Date }[] {
	const now = new Date();

	const laterToday = new Date(now.getTime() + 4 * 60 * 60 * 1000);

	const tomorrowMorning = new Date(now);
	tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
	tomorrowMorning.setHours(8, 0, 0, 0);

	const nextWeek = new Date(now);
	// Next Monday at 8:00
	const daysUntilMonday = ((8 - nextWeek.getDay()) % 7) || 7;
	nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
	nextWeek.setHours(8, 0, 0, 0);

	const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
	const dayFmt: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };

	return [
		{ label: "Later today", hint: laterToday.toLocaleTimeString(undefined, timeFmt), until: laterToday },
		{ label: "Tomorrow", hint: tomorrowMorning.toLocaleString(undefined, dayFmt), until: tomorrowMorning },
		{ label: "Next week", hint: nextWeek.toLocaleString(undefined, dayFmt), until: nextWeek },
	];
}

function SnoozeMenu({ onSnooze }: { onSnooze: (until: string) => void }) {
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

	const pick = (until: Date) => {
		onSnooze(until.toISOString());
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
			<Tooltip content="Snooze" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<AlarmIcon size={18} />}
					onClick={() => setOpen((o) => !o)}
					aria-label="Snooze"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[220px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Snooze until</div>
					<div className="h-px bg-kumo-line my-1" />
					{getSnoozePresets().map((preset) => (
						<button
							key={preset.label}
							type="button"
							className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => pick(preset.until)}
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
							aria-label="Custom snooze time"
						/>
						<Button variant="secondary" size="xs" onClick={handleCustom} disabled={!customValue} className="w-full">
							Snooze until date
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function MoveToFolderMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
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

	return (
		<div ref={ref} className="relative">
			<Tooltip content="Move to folder" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<FolderSimpleIcon size={18} />}
					onClick={() => setOpen((o) => !o)}
					aria-label="Move to folder"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Move to</div>
					<div className="h-px bg-kumo-line my-1" />
					{folders.map((f) => (
						<button
							key={f.id}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => { onMove(f.id); setOpen(false); }}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
