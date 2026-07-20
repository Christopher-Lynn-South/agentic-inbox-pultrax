// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { getTimePresets, toDatetimeLocalValue } from "~/lib/snooze";

/**
 * "Schedule send" dropdown for compose forms: preset times plus a
 * custom datetime picker. Opens upward so it fits above footer rows.
 */
export default function ScheduleSendMenu({
	disabled,
	onSchedule,
}: {
	disabled: boolean;
	onSchedule: (date: Date) => void;
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

	const pick = (date: Date) => {
		setOpen(false);
		onSchedule(date);
	};

	return (
		<div ref={ref} className="relative">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={disabled}
				icon={<CaretDownIcon size={14} />}
				onClick={() => {
					setCustomValue(toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
					setOpen((o) => !o);
				}}
			>
				Schedule
			</Button>
			{open && (
				<div className="absolute bottom-full right-0 z-50 mb-1 min-w-[230px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Send later</div>
					<div className="h-px bg-kumo-line my-1" />
					{getTimePresets().map((p) => (
						<button
							key={p.label}
							type="button"
							className="w-full flex items-center justify-between gap-3 text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => pick(p.date)}
						>
							<span>{p.label}</span>
							<span className="text-xs text-kumo-subtle">{p.hint}</span>
						</button>
					))}
					<div className="h-px bg-kumo-line my-1" />
					<div className="px-3 py-1.5 space-y-1.5">
						<div className="text-xs font-medium text-kumo-subtle">Pick a time</div>
						<input
							type="datetime-local"
							className="w-full text-sm rounded-md border border-kumo-line bg-transparent px-2 py-1 text-kumo-default"
							value={customValue}
							onChange={(e) => setCustomValue(e.target.value)}
						/>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="w-full"
							disabled={!customValue || new Date(customValue).getTime() <= Date.now()}
							onClick={() => customValue && pick(new Date(customValue))}
						>
							Schedule send
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
