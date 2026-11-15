import type { PluginServerContext } from "@getpaseo/plugin/server";
import { RISK_DEFAULTS, superSettings, type SuperSettings } from "../../shared/settings";
import {
  DEFAULT_ACCOUNT_ID,
  listAccounts,
  readAccounts,
  setActive,
} from "../core/accounts";
import { invalidateCatalogCache } from "../core/catalog";
import { readAccountQuota, type QuotaResult } from "../core/quota";
import {
  readManagerState,
  switchManagerAgyAccount,
  type ManagerAccount,
} from "../manager/store";
import { assess, pickBest, type RiskPolicy, type RiskWindow } from "./engine";
import { clearRecord, readRiskStore, recordFailure } from "./store";

type RegisteredSettings = ReturnType<PluginServerContext["registerSettings"]>;

let settingsHandle: RegisteredSettings | null = null;

export function bindRuntimeSettings(handle: RegisteredSettings): void {
  settingsHandle = handle;
}

export async function readRuntimeSettings(): Promise<SuperSettings> {
  if (!settingsHandle) return superSettings.schema.parse({});
  const state = await settingsHandle.read();
  return superSettings.schema.parse(state.status === "ready" ? state.values : {});
}

export function toRiskPolicy(values: SuperSettings): RiskPolicy {
  return {
    enabled: values.risk?.enabled ?? RISK_DEFAULTS.enabled,
    minRemainingPct: values.risk?.minRemainingPct ?? RISK_DEFAULTS.minRemainingPct,
    baseCooldownMinutes: values.risk?.baseCooldownMinutes ?? RISK_DEFAULTS.baseCooldownMinutes,
    maxCooldownMinutes: values.risk?.maxCooldownMinutes ?? RISK_DEFAULTS.maxCooldownMinutes,
    failureThreshold: values.risk?.failureThreshold ?? RISK_DEFAULTS.failureThreshold,
  };
}

const RISK_ERROR_PATTERN =
  /\b(429|403|503)\b|rate[\s_-]?limit|too many requests|resource[_\s-]?exhausted|quota|credits[_\s-]?exhausted|forbidden|unavailable|validation[_\s-]?blocked|sign[\s-]?in|unauthorized|401/i;

export function isRiskFailure(message: string, code?: string): boolean {
  return RISK_ERROR_PATTERN.test(`${code ?? ""} ${message}`);
}

export function managerRiskKey(id: string): string {
  return `manager:${id}`;
}

export async function recordTurnFailure(
  accountId: string,
  message: string,
  code?: string,
): Promise<void> {
  if (!isRiskFailure(message, code)) return;
  const settings = await readRuntimeSettings();
  if (!settings.risk.enabled) return;
  const policy = toRiskPolicy(settings);
  const reason = code ? `${code}: ${message.slice(0, 140)}` : message.slice(0, 160);

  await recordFailure(accountId, policy, reason);

  // When running on Default (~/.gemini), mirror the cooldown onto the active Antigravity Tools account.
  if (accountId === DEFAULT_ACCOUNT_ID && settings.manager.enabled) {
    try {
      const mgr = await readManagerState({
        home: settings.manager.home,
        port: settings.manager.port,
      });
      const currentId = mgr.currentAgyAccountId ?? mgr.currentAccountId;
      if (currentId) {
        await recordFailure(managerRiskKey(currentId), policy, reason);
      }
    } catch {
      // Best-effort mirroring.
    }
  }
}

export async function recordTurnSuccess(accountId: string): Promise<void> {
  await clearRecord(accountId);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    try {
      const settings = await readRuntimeSettings();
      if (settings.manager.enabled) {
        const mgr = await readManagerState({
          home: settings.manager.home,
          port: settings.manager.port,
        });
        const currentId = mgr.currentAgyAccountId ?? mgr.currentAccountId;
        if (currentId) await clearRecord(managerRiskKey(currentId));
      }
    } catch {
      // Best-effort clear.
    }
  }
}

export function agyQuotaWindows(quota: QuotaResult): RiskWindow[] {
  if (quota.state !== "ok") return [];
  const all = quota.groups.flatMap((group) =>
    group.buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.name.length > 0 ? bucket.name : `${group.name} ${bucket.window}`.trim(),
      remainingPct: Math.round(Math.min(1, Math.max(0, bucket.remainingFraction)) * 100),
      resetsAt: bucket.resetTime.length > 0 ? bucket.resetTime : null,
      isGemini: /gemini/i.test(`${group.name} ${bucket.name}`) && !/argon/i.test(`${group.name} ${bucket.name}`),
    })),
  );
  const geminiOnly = all.filter((w) => w.isGemini);
  return geminiOnly.length > 0 ? geminiOnly : all;
}

export function managerPrimaryWindows(account: ManagerAccount): RiskWindow[] {
  const gemini = account.windows.filter((w) => w.pool === "gemini");
  const source = gemini.length > 0 ? gemini : account.windows;
  return source.map((w) => ({
    id: w.id,
    label: w.label,
    remainingPct: w.remainingPct,
    resetsAt: w.resetsAt,
  }));
}

export interface AutoRotateResult {
  accountId: string;
  rotatedNotice?: string;
}

/**
 * Called before opening a *new* conversation: if autoRotate is enabled and the active account
 * is cooling/exhausted/blocked, rotates either to a healthy agy shadow account or switches the
 * active Antigravity Manager `agy` account before spawning `agy`.
 */
export async function resolveAccountForNewSession(): Promise<AutoRotateResult> {
  const current = readAccounts().active;
  const settings = await readRuntimeSettings();
  if (!settings.risk.enabled || !settings.risk.autoRotate) {
    return { accountId: current };
  }

  const policy = toRiskPolicy(settings);
  const riskStore = await readRiskStore();
  const now = Date.now();

  // 1. Check agy shadow accounts if multiple agy accounts exist.
  const agyAccounts = listAccounts();
  if (agyAccounts.length > 1) {
    const entries: Array<{ id: string; priority: number | null; assessment: ReturnType<typeof assess> }> = [];
    for (const acc of agyAccounts) {
      const quota = await readAccountQuota(acc.id, { refresh: false });
      const rec = riskStore[acc.id];
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
      entries.push({ id: acc.id, priority: null, assessment });
    }
    const currentEntry = entries.find((e) => e.id === current);
    if (currentEntry && currentEntry.assessment.health !== "ready") {
      const bestId = pickBest(entries);
      if (bestId && bestId !== current) {
        setActive(bestId);
        invalidateCatalogCache();
        const bestName = agyAccounts.find((a) => a.id === bestId)?.name ?? bestId;
        return {
          accountId: bestId,
          rotatedNotice: `原账号处于冷却或额度不足状态，已自动切换至账号「${bestName}」`,
        };
      }
    }
  }

  // 2. When running on Default (~/.gemini) and Manager is online, check Manager accounts.
  if (current === DEFAULT_ACCOUNT_ID && settings.manager.enabled) {
    const mgr = await readManagerState({
      home: settings.manager.home,
      port: settings.manager.port,
    });
    if (mgr.running && mgr.accounts.length > 1) {
      const entries = mgr.accounts.map((acc) => {
        const rec = riskStore[managerRiskKey(acc.id)];
        const combinedCooldown =
          acc.cooldownUntilMs !== null && rec?.cooldownUntil != null
            ? Math.max(acc.cooldownUntilMs, rec.cooldownUntil)
            : (acc.cooldownUntilMs ?? rec?.cooldownUntil ?? null);
        return {
          account: acc,
          id: acc.id,
          priority: acc.priority,
          assessment: assess(
            {
              disabled: acc.disabled,
              disabledReason: acc.disabledReason,
              forbidden: acc.forbidden,
              forbiddenReason: acc.forbiddenReason,
              needsSignIn: acc.needsSignIn,
              windows: managerPrimaryWindows(acc),
              failures: rec?.failures ?? 0,
              cooldownUntil: combinedCooldown,
              limitedModels: acc.limitedModels,
            },
            policy,
            now,
          ),
        };
      });

      const currentMgrEntry = entries.find((e) => e.account.isCurrent);
      const defaultRec = riskStore[DEFAULT_ACCOUNT_ID];
      const defaultCooling =
        defaultRec !== undefined &&
        ((defaultRec.cooldownUntil !== null && defaultRec.cooldownUntil > now) ||
          defaultRec.failures >= policy.failureThreshold);

      if (defaultCooling || (currentMgrEntry && currentMgrEntry.assessment.health !== "ready")) {
        const bestId = pickBest(entries);
        if (bestId && bestId !== currentMgrEntry?.id) {
          const switched = await switchManagerAgyAccount(bestId, {
            home: settings.manager.home,
            port: settings.manager.port,
          });
          if (switched.ok) {
            await clearRecord(DEFAULT_ACCOUNT_ID);
            invalidateCatalogCache();
            const bestLabel = entries.find((e) => e.id === bestId)?.account.label ?? bestId;
            return {
              accountId: DEFAULT_ACCOUNT_ID,
              rotatedNotice: `当前账号冷却或额度不足，已通过 Antigravity Tools 自动切换 agy 至「${bestLabel}」`,
            };
          }
        }
      }
    }
  }

  return { accountId: current };
}
