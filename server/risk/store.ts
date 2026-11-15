import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pluginDataDir } from "../core/plugindata";
import { backoffMs, type RiskPolicy } from "./engine";

/**
 * The recorded half of the risk engine: consecutive failures per account and the cooldown they
 * bought. Kept in the plugin's own data directory so a reload, a daemon restart, or a switch back
 * to a broken account cannot launder a fresh start.
 */
export interface RiskRecord {
  failures: number;
  cooldownUntil: number | null;
  /** Free text for the row: what the failure was. */
  reason: string | null;
  updatedAt: number;
}

export type RiskStore = Record<string, RiskRecord>;

function storePath(): string {
  return pluginDataDir("risk.json");
}

export async function readRiskStore(): Promise<RiskStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(storePath(), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: RiskStore = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      store[id] = {
        failures: typeof record["failures"] === "number" ? record["failures"] : 0,
        cooldownUntil: typeof record["cooldownUntil"] === "number" ? record["cooldownUntil"] : null,
        reason: typeof record["reason"] === "string" ? record["reason"] : null,
        updatedAt: typeof record["updatedAt"] === "number" ? record["updatedAt"] : 0,
      };
    }
    return store;
  } catch {
    return {};
  }
}

/** Records one failure for an account and returns the record, with its new cooldown. */
export async function recordFailure(
  accountId: string,
  policy: RiskPolicy,
  reason: string,
  now = Date.now(),
): Promise<RiskRecord> {
  const store = await readRiskStore();
  const previous = store[accountId];
  const failures = (previous?.failures ?? 0) + 1;
  const record: RiskRecord = {
    failures,
    cooldownUntil: failures >= policy.failureThreshold ? now + backoffMs(failures, policy) : null,
    reason,
    updatedAt: now,
  };
  store[accountId] = record;
  await writeStore(store);
  return record;
}

/** Forgets an account's record: a successful turn is proof the cooldown is over. */
export async function clearRecord(accountId: string): Promise<void> {
  const store = await readRiskStore();
  if (!(accountId in store)) return;
  delete store[accountId];
  await writeStore(store);
}

async function writeStore(store: RiskStore): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`);
}
