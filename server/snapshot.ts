import type { SuperAccount, SuperSnapshot, UsageWindowView } from "../shared/super";
import { REAL_HOME_ACCOUNT_ID, resolveLiveAgyOwner } from "../shared/account-truth";
import { listAccounts, readAccounts } from "./core/accounts";
import { readAccountQuota, type QuotaResult } from "./core/quota";
import { readRealAgyIdentity } from "./core/signin-identity";
import { readManagerState } from "./manager/store";
import { assess, pickBest } from "./risk/engine";
import {
  agyQuotaWindows,
  managerPrimaryWindows,
  managerRiskKey,
  readRuntimeSettings,
  toRiskPolicy,
} from "./risk/runtime";
import { readRiskStore } from "./risk/store";

function agyDisplayWindows(quota: QuotaResult): UsageWindowView[] {
  if (quota.state !== "ok") return [];
  return quota.groups.flatMap((group) =>
    group.buckets.map((bucket) => {
      const label =
        bucket.name.length > 0 ? bucket.name : `${group.name} ${bucket.window}`.trim();
      const s = `${group.name} ${label}`.toLowerCase();
      const pool = /argon/.test(s)
        ? "gemini 4 argon"
        : /claude|gpt/.test(s)
          ? "claude"
          : /gemini/.test(s)
            ? "gemini"
            : undefined;
      const wLower = `${bucket.window} ${label}`.toLowerCase();
      const period = /5\s*h|5\s*hour/.test(wLower)
        ? ("5h" as const)
        : /week|7\s*d|7\s*day/.test(wLower)
          ? ("7d" as const)
          : ("other" as const);
      const remainingPct = Math.round(
        Math.min(1, Math.max(0, bucket.remainingFraction)) * 100,
      );
      return {
        id: bucket.id,
        label: group.name ? `${group.name} · ${label}` : label,
        shortLabel: bucket.window || undefined,
        pool,
        period,
        usedPct: 100 - remainingPct,
        remainingPct,
        resetsAt: bucket.resetTime.length > 0 ? bucket.resetTime : null,
      };
    }),
  );
}

export async function buildSuperSnapshot(
  options: { refresh?: boolean } = {},
): Promise<SuperSnapshot> {
  const settings = await readRuntimeSettings();
  const policy = toRiskPolicy(settings);
  const now = Date.now();
  const riskStore = await readRiskStore();

  const agyAccounts = listAccounts();
  const agyActive = readAccounts().active;
  // The CLI's own sign-in report beats the Tools pointer: the pointer can name an account the
  // Keychain is not actually signed in as (see shared/account-truth.ts).
  const realAgyEmail = readRealAgyIdentity()?.email ?? null;

  const managerEnabled = settings.manager.enabled && settings.manager.readState;
  const manager = managerEnabled
    ? await readManagerState({ home: settings.manager.home, port: settings.manager.port })
    : {
        present: false,
        running: false,
        version: null,
        port: settings.manager.port,
        accounts: [],
        currentAccountId: null,
        currentAgyAccountId: null,
        error: null,
      };
  const owner = resolveLiveAgyOwner({
    realEmail: realAgyEmail,
    agyActive,
    managerAccounts: manager.accounts,
  });

  const accounts: SuperAccount[] = [];
  const candidates: Array<{
    id: string;
    source: "agy" | "manager";
    label: string;
    priority: number | null;
    assessment: ReturnType<typeof assess>;
  }> = [];

  for (const account of manager.accounts) {
    const rec = riskStore[managerRiskKey(account.id)];
    const combinedCooldown =
      account.cooldownUntilMs !== null && rec?.cooldownUntil != null
        ? Math.max(account.cooldownUntilMs, rec.cooldownUntil)
        : (account.cooldownUntilMs ?? rec?.cooldownUntil ?? null);

    const assessment = assess(
      {
        disabled: account.disabled,
        disabledReason: account.disabledReason,
        forbidden: account.forbidden,
        forbiddenReason: account.forbiddenReason,
        needsSignIn: account.needsSignIn,
        windows: managerPrimaryWindows(account),
        failures: rec?.failures ?? 0,
        cooldownUntil: combinedCooldown,
        limitedModels: account.limitedModels,
      },
      policy,
      now,
    );

    const activeOnAgy =
      agyActive === REAL_HOME_ACCOUNT_ID && owner.ownerId === account.id;
    candidates.push({
      id: account.id,
      source: "manager",
      label: account.label,
      priority: account.priority,
      assessment,
    });

    accounts.push({
      id: account.id,
      source: "manager",
      label: account.label,
      email: account.email,
      plan: account.plan,
      active: activeOnAgy,
      health: assessment.health,
      healthDetail: assessment.detail,
      cooldownUntil: assessment.cooldownUntil,
      windows: account.windows.map((w) => ({
        id: w.id,
        label: w.label,
        ...(w.shortLabel ? { shortLabel: w.shortLabel } : {}),
        ...(w.pool ? { pool: w.pool } : {}),
        ...(w.period ? { period: w.period } : {}),
        usedPct: w.remainingPct === null ? null : 100 - w.remainingPct,
        remainingPct: w.remainingPct,
        resetsAt: w.resetsAt,
      })),
      priority: account.priority,
      launchable: manager.running,
      disabled: account.disabled,
      readAt: account.readAt,
      limitedModels: account.limitedModels,
    });
  }

  for (const account of agyAccounts) {
    const quota = await readAccountQuota(account.id, {
      refresh: options.refresh === true,
    });
    const rec = riskStore[account.id];
    const assessment = assess(
      {
        disabled: false,
        forbidden: false,
        needsSignIn: quota.state === "signed-out",
        windows: agyQuotaWindows(quota),
        failures: rec?.failures ?? 0,
        cooldownUntil: rec?.cooldownUntil ?? null,
      },
      policy,
      now,
    );

    if (manager.accounts.length === 0 || account.id !== "default") {
      candidates.push({
        id: account.id,
        source: "agy",
        label: account.name,
        priority: null,
        assessment,
      });
    }

    accounts.push({
      id: account.id,
      source: "agy",
      label: account.name,
      // The real home is signed in as whatever the CLI reported; a shadow account has no email
      // the plugin can read without spawning it.
      email: account.id === REAL_HOME_ACCOUNT_ID ? realAgyEmail : null,
      plan: null,
      active: account.id === agyActive,
      health: assessment.health,
      healthDetail:
        quota.state === "error" || quota.state === "unavailable"
          ? quota.message
          : assessment.detail,
      cooldownUntil: assessment.cooldownUntil,
      windows: agyDisplayWindows(quota),
      priority: null,
      launchable: true,
      disabled: false,
      readAt: quota.state === "ok" ? new Date(quota.fetchedAt).toISOString() : null,
      limitedModels: [],
    });
  }

  const bestId = pickBest(candidates);
  const bestCandidate = bestId ? (candidates.find((c) => c.id === bestId) ?? null) : null;

  return {
    accounts,
    manager: {
      present: manager.present,
      running: manager.running,
      version: manager.version,
      port: manager.port,
      accountCount: manager.accounts.length,
      currentAgyAccountId: manager.currentAgyAccountId,
      error: manager.error,
    },
    agyActiveId: agyActive,
    realAgyEmail,
    pointerMismatch: owner.pointerMismatch,
    suggested: bestCandidate
      ? { id: bestCandidate.id, source: bestCandidate.source, label: bestCandidate.label }
      : null,
    fetchedAt: now,
  };
}
