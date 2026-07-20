// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Preset time choices shared by the snooze menu and schedule-send picker. */

export interface TimePreset {
	label: string;
	/** Human-readable hint, e.g. "Mon 9:00 AM" */
	hint: string;
	date: Date;
}

function atHour(date: Date, hour: number): Date {
	const d = new Date(date);
	d.setHours(hour, 0, 0, 0);
	return d;
}

function formatHint(date: Date): string {
	return date.toLocaleString(undefined, {
		weekday: "short",
		hour: "numeric",
		minute: "2-digit",
	});
}

function preset(label: string, date: Date): TimePreset {
	return { label, hint: formatHint(date), date };
}

/**
 * Build snooze/schedule presets relative to now:
 * later today (in ~3h or 6pm), tomorrow morning, and next Monday morning.
 */
export function getTimePresets(now = new Date()): TimePreset[] {
	const presets: TimePreset[] = [];

	// Later today: 6pm if that's still 1h+ away, otherwise 3 hours from now.
	const sixPm = atHour(now, 18);
	const laterToday =
		sixPm.getTime() - now.getTime() > 60 * 60 * 1000
			? sixPm
			: new Date(now.getTime() + 3 * 60 * 60 * 1000);
	if (laterToday.getDate() === now.getDate()) {
		presets.push(preset("Later today", laterToday));
	}

	const tomorrow = atHour(new Date(now.getTime() + 24 * 60 * 60 * 1000), 9);
	presets.push(preset("Tomorrow morning", tomorrow));

	// Next Monday 9am (always at least 2 days out, else the Monday after).
	const nextMonday = new Date(now);
	const daysUntilMonday = ((8 - nextMonday.getDay()) % 7) || 7;
	nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
	presets.push(preset("Next week", atHour(nextMonday, 9)));

	return presets;
}

/** Format a due_at timestamp for list rows, e.g. "Jul 21, 9:00 AM". */
export function formatDueDate(iso: string | null | undefined): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Convert a Date to the value format expected by datetime-local inputs. */
export function toDatetimeLocalValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
