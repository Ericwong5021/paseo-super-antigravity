import type { SuperAccount, UsageWindowView } from "./super";

export type QuotaPeriod = "5h" | "7d";
export type AntigravityPool = "gemini" | "gemini 4 argon" | "claude";

function detectPeriod(win: UsageWindowView): QuotaPeriod | null {
  if (win.period === "5h" || win.period === "7d") return win.period;
  const raw = `${win.shortLabel ?? ""} ${win.label} ${win.id}`.toLowerCase();
  if (/\b5\s*(?:hours?|h)\b/i.test(raw)) return "5h";
  if (/\b(?:7\s*(?:days?|d)|weekly)\b/i.test(raw)) return "7d";
  return null;
}

function detectPool(win: UsageWindowView): AntigravityPool | null {
  const explicit = (win.pool ?? "").trim().toLowerCase();
  if (explicit === "gemini" || explicit === "gemini 4 argon" || explicit === "claude") {
    return explicit;
  }
  const raw = `${win.label} ${win.id}`.toLowerCase();
  if (/argon/i.test(raw)) return "gemini 4 argon";
  if (/claude|gpt/i.test(raw)) return "claude";
  if (/gemini/i.test(raw)) return "gemini";
  return null;
}

export function findWindow(
  account: Pick<SuperAccount, "windows">,
  period: QuotaPeriod,
  pool: AntigravityPool = "gemini",
): UsageWindowView | null {
  for (const win of account.windows) {
    if (win.remainingPct === null || !Number.isFinite(win.remainingPct)) continue;
    if (detectPeriod(win) !== period) continue;
    if (detectPool(win) === pool) return win;
  }
  return null;
}

/**
 * Picks the canonical set of accounts to aggregate in the fleet summary so `Default` (the real
 * `~/.gemini` home) does not double-count the active Antigravity Manager account when both exist.
 */
export function selectFleetAccounts(accounts: readonly SuperAccount[]): SuperAccount[] {
  const managerAccounts = accounts.filter((a) => a.source === "manager");
  if (managerAccounts.length === 0) return [...accounts];
  const shadowAccounts = accounts.filter((a) => a.source === "agy" && a.id !== "default");
  return [...managerAccounts, ...shadowAccounts];
}

export interface AntigravityQuotaSummary {
  remaining: number | null;
  included: number;
  total: number;
  excludedLowWeekly: number;
  unknownWeekly: number;
  withoutPool: number;
  unavailable: number;
  cooling: number;
}

/**
 * Migrated from Magpie's `summarizeAntigravity`: aggregates remaining quota across fleet accounts,
 * excluding disabled/banned/reauth accounts, and excluding 5h readings when the same pool's
 * weekly quota is below 5%.
 */
export function summarizeAntigravity(
  accounts: readonly SuperAccount[],
  period: QuotaPeriod,
  pool: AntigravityPool = "gemini",
): AntigravityQuotaSummary {
  const fleet = selectFleetAccounts(accounts);
  let excludedLowWeekly = 0;
  let unknownWeekly = 0;
  let withoutPool = 0;
  let unavailable = 0;
  let cooling = 0;

  const readings: number[] = [];
  for (const account of fleet) {
    if (account.health === "cooling") cooling += 1;
    if (
      account.disabled ||
      account.health === "disabled" ||
      account.health === "banned" ||
      account.health === "reauth"
    ) {
      unavailable += 1;
      continue;
    }
    const match = findWindow(account, period, pool);
    if (!match || match.remainingPct === null) {
      withoutPool += 1;
      continue;
    }
    if (period === "5h") {
      const weekly = findWindow(account, "7d", pool);
      if (weekly && weekly.remainingPct !== null && weekly.remainingPct < 5) {
        excludedLowWeekly += 1;
        continue;
      }
      if (!weekly) unknownWeekly += 1;
    }
    readings.push(Math.max(0, Math.min(100, match.remainingPct)));
  }

  const remaining =
    readings.length > 0
      ? readings.reduce((sum, pct) => sum + pct, 0) / readings.length
      : null;

  return {
    remaining,
    included: readings.length,
    total: fleet.length,
    excludedLowWeekly,
    unknownWeekly,
    withoutPool,
    unavailable,
    cooling,
  };
}
