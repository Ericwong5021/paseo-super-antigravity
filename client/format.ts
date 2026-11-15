/** Formatting helpers for quota reset countdowns, stale timestamps, and cooldown windows. */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STALE_AFTER_MS = 10 * MINUTE;

function parseEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function formatCountdown(resetsAt: string | null | undefined, now = Date.now()): string | null {
  const target = parseEpoch(resetsAt);
  if (target === null) return null;
  const diff = target - now;
  if (diff <= 0) return "即将重置";
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const minutes = Math.floor((diff % HOUR) / MINUTE);
  if (days >= 1) return `${days}天${hours}时后`;
  if (hours >= 1) return `${hours}时${minutes}分后`;
  return `${Math.max(1, minutes)}分后`;
}

export function formatUntilShort(untilIso: string | null | undefined, now = Date.now()): string | null {
  const target = parseEpoch(untilIso);
  if (target === null) return null;
  const diff = target - now;
  if (diff <= 0) return null;
  const hours = Math.floor(diff / HOUR);
  const minutes = Math.floor((diff % HOUR) / MINUTE);
  if (hours >= 1) return `${hours}h${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export function formatAge(readAt: string | null | undefined, now = Date.now()): string | null {
  const readMs = parseEpoch(readAt);
  if (readMs === null) return null;
  const diff = Math.max(0, now - readMs);
  if (diff < MINUTE) return "刚刚";
  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(diff / HOUR);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(diff / DAY)}天前`;
}

export function isReadingStale(readAt: string | null | undefined, now = Date.now()): boolean {
  const readMs = parseEpoch(readAt);
  if (readMs === null) return false;
  return now - readMs > STALE_AFTER_MS;
}

export function clampPct(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
