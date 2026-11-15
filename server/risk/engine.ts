/**
 * Pure risk/cooldown assessment policy.
 */

export type Health = "ready" | "cooling" | "banned" | "reauth" | "disabled" | "unknown";

export interface RiskWindow {
  id: string;
  label: string;
  remainingPct: number | null;
  resetsAt: string | null;
}

export interface RiskSignals {
  disabled: boolean;
  disabledReason?: string | null;
  forbidden: boolean;
  forbiddenReason?: string | null;
  needsSignIn: boolean;
  windows: readonly RiskWindow[];
  failures: number;
  cooldownUntil: number | null;
  limitedModels?: readonly string[];
}

export interface RiskPolicy {
  enabled: boolean;
  minRemainingPct: number;
  baseCooldownMinutes: number;
  maxCooldownMinutes: number;
  failureThreshold: number;
}

export interface Assessment {
  health: Health;
  detail: string | null;
  cooldownUntil: string | null;
  score: number;
}

export function assess(signals: RiskSignals, policy: RiskPolicy, now: number): Assessment {
  if (signals.disabled) {
    return verdict("disabled", signals.disabledReason ?? "已禁用", null, -1);
  }
  if (signals.needsSignIn) {
    return verdict("reauth", "需要重新验证/登录", null, -1);
  }
  if (signals.forbidden) {
    return verdict("banned", signals.forbiddenReason ?? "账号已被上游限制", null, -1);
  }

  const cooldown = activeCooldown(signals, policy, now);
  if (cooldown !== null) return cooldown;

  if (signals.limitedModels && signals.limitedModels.length > 0 && policy.enabled) {
    return {
      health: "cooling",
      detail: `受限模型: ${signals.limitedModels.slice(0, 2).join(", ")}`,
      cooldownUntil: null,
      score: -1,
    };
  }

  if (!policy.enabled) return verdict("ready", null, null, score(signals.windows));

  const floor = policy.minRemainingPct;
  const low = signals.windows
    .filter((window) => window.remainingPct !== null && window.remainingPct <= floor)
    .sort(byReset);

  if (low.length > 0) {
    const window = low[0];
    const until = window.resetsAt === null ? null : Date.parse(window.resetsAt);
    return {
      health: "cooling",
      detail: `${window.label} 剩余 ${window.remainingPct ?? 0}% (低于 ${floor}%)`,
      cooldownUntil: until === null || Number.isNaN(until) ? null : new Date(until).toISOString(),
      score: -1,
    };
  }

  return verdict("ready", null, null, score(signals.windows));
}

export function pickBest(
  entries: ReadonlyArray<{ id: string; priority: number | null; assessment: Assessment }>,
): string | null {
  const ready = entries.filter((entry) => entry.assessment.health === "ready");
  if (ready.length === 0) return null;
  return [...ready].sort((left, right) => {
    const byScore = right.assessment.score - left.assessment.score;
    if (byScore !== 0) return byScore;
    const byPriority = (right.priority ?? 0) - (left.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  })[0].id;
}

export function backoffMs(failures: number, policy: RiskPolicy): number {
  const base = policy.baseCooldownMinutes * 60_000;
  const cap = policy.maxCooldownMinutes * 60_000;
  const exponent = Math.max(0, failures - 1);
  return Math.min(cap, base * 2 ** exponent);
}

function activeCooldown(
  signals: RiskSignals,
  policy: RiskPolicy,
  now: number,
): Assessment | null {
  if (signals.cooldownUntil !== null) {
    if (signals.cooldownUntil > now) {
      const label =
        signals.failures > 0
          ? `连续失败 ${signals.failures} 次，冷却中`
          : "风控冷却中";
      return {
        health: "cooling",
        detail: label,
        cooldownUntil: new Date(signals.cooldownUntil).toISOString(),
        score: -1,
      };
    }
    return null;
  }
  if (policy.enabled && signals.failures >= policy.failureThreshold) {
    return {
      health: "cooling",
      detail: `连续失败 ${signals.failures} 次，冷却中`,
      cooldownUntil: new Date(now + backoffMs(signals.failures, policy)).toISOString(),
      score: -1,
    };
  }
  return null;
}

function score(windows: readonly RiskWindow[]): number {
  const known = windows
    .map((window) => window.remainingPct)
    .filter((value): value is number => value !== null);
  return known.length === 0 ? 0 : Math.min(...known);
}

function byReset(left: RiskWindow, right: RiskWindow): number {
  const leftAt = left.resetsAt === null ? Number.POSITIVE_INFINITY : Date.parse(left.resetsAt);
  const rightAt = right.resetsAt === null ? Number.POSITIVE_INFINITY : Date.parse(right.resetsAt);
  return leftAt - rightAt;
}

function verdict(
  health: Health,
  detail: string | null,
  cooldownUntil: string | null,
  scoreValue: number,
): Assessment {
  return { health, detail, cooldownUntil, score: scoreValue };
}
