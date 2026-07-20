// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	BellSimpleSlashIcon,
	ChatCircleIcon,
	CheckIcon,
	ClockIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TagIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { Folder, Email, Label } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSnoozedFolder?: boolean;
	isScheduledFolder?: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	labels?: Label[];
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
	onUnschedule?: () => void;
	onToggleLabel?: (labelId: string, active: boolean) => void;
	onViewSource: () => void;
	onDelete: () => void;
}

/** Preset snooze targets, computed at click time. */
function snoozePresets(): { label: string; date: Date }[] {
	const now = new Date();
	const laterToday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(8, 0, 0, 0);
	const weekend = new Date(now);
	weekend.setDate(weekend.getDate() + ((6 - weekend.getDay() + 7) % 7 || 7));
	weekend.setHours(8, 0, 0, 0);
	const nextWeek = new Date(now);
	nextWeek.setDate(nextWeek.getDate() + ((1 - nextWeek.getDay() + 7) % 7 || 7));
	nextWeek.setHours(8, 0, 0, 0);
	return [
		{ label: "Later today (3 hours)", date: laterToday },
		{ label: "Tomorrow morning", date: tomorrow },
		{ label: "This weekend", date: weekend },
		{ label: "Next week", date: nextWeek },
	];
}

export default function EmailPanelToolbar({
	email,
	mailboxId,
	isDraftFolder,
	isSnoozedFolder,
	isScheduledFolder,
	isSending,
	moveToFolders,
	labels = [],
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
	onUnschedule,
	onToggleLabel,
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

			{isSnoozedFolder && onUnsnooze ? (
				<Tooltip content="Unsnooze — return to inbox now" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<BellSimpleSlashIcon size={18} />}
						onClick={onUnsnooze}
						aria-label="Unsnooze"
					/>
				</Tooltip>
			) : isScheduledFolder && onUnschedule ? (
				<Tooltip content="Cancel scheduled send — back to drafts" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={onUnschedule}
						aria-label="Cancel scheduled send"
					/>
				</Tooltip>
			) : (
				!isDraftFolder && onSnooze && <SnoozeMenu onSnooze={onSnooze} />
			)}

			{onToggleLabel && (
				<LabelMenu
					labels={labels}
					emailLabels={email.labels || []}
					onToggle={onToggleLabel}
				/>
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

	const formatPreset = (d: Date) =>
		d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

	return (
		<div ref={ref} className="relative">
			<Tooltip content="Snooze" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<ClockIcon size={18} />}
					onClick={() => setOpen((o) => !o)}
					aria-label="Snooze"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[220px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Snooze until</div>
					<div className="h-px bg-kumo-line my-1" />
					{snoozePresets().map((preset) => (
						<button
							key={preset.label}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors flex justify-between gap-3"
							onClick={() => { onSnooze(preset.date.toISOString()); setOpen(false); }}
						>
							<span>{preset.label}</span>
							<span className="text-kumo-subtle text-xs self-center">{formatPreset(preset.date)}</span>
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
								onSnooze(new Date(customValue).toISOString());
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

function LabelMenu({
	labels,
	emailLabels,
	onToggle,
}: {
	labels: Label[];
	emailLabels: Label[];
	onToggle: (labelId: string, active: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const activeIds = new Set(emailLabels.map((l) => l.id));

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
			<Tooltip content="Labels" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<TagIcon size={18} />}
					onClick={() => setOpen((o) => !o)}
					aria-label="Labels"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[180px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Labels</div>
					<div className="h-px bg-kumo-line my-1" />
					{labels.length === 0 && (
						<div className="px-3 py-1.5 text-sm text-kumo-subtle">
							No labels yet — create one from the sidebar.
						</div>
					)}
					{labels.map((label) => {
						const active = activeIds.has(label.id);
						return (
							<button
								key={label.id}
								type="button"
								className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors flex items-center gap-2"
								onClick={() => onToggle(label.id, active)}
							>
								<TagIcon size={14} weight="fill" style={{ color: label.color }} />
								<span className="flex-1 truncate">{label.name}</span>
								{active && <CheckIcon size={14} className="text-kumo-subtle" />}
							</button>
						);
					})}
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
