import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Interop with Antigravity Tools (`~/.antigravity_tools` and its local HTTP admin API).
 * Written from scratch using documented file/HTTP schemas so there is no license coupling.
 */

export interface ManagerWindow {
  id: string;
  label: string;
  shortLabel?: string;
  pool?: "gemini" | "gemini 4 argon" | "claude";
  period?: "5h" | "7d" | "other";
  remainingPct: number | null;
  resetsAt: string | null;
}

export interface ManagerAccount {
  id: string;
  label: string;
  email: string | null;
  priority: number | null;
  disabled: boolean;
  disabledReason: string | null;
  needsSignIn: boolean;
  forbidden: boolean;
  forbiddenReason: string | null;
  plan: string | null;
  windows: ManagerWindow[];
  lastUsedAt: number | null;
  readAt: string | null;
  limitedModels: string[];
  cooldownUntilMs: number | null;
  isCurrent: boolean;
}

export interface ManagerConfigInfo {
  port: number;
  apiKey: string | null;
}

export interface ManagerState {
  present: boolean;
  running: boolean;
  version: string | null;
  port: number;
  accounts: ManagerAccount[];
  currentAccountId: string | null;
  currentAgyAccountId: string | null;
  error: string | null;
}

export function managerHome(override?: string): string {
  const value = override?.trim();
  return value === undefined || value.length === 0 ? join(homedir(), ".antigravity_tools") : value;
}

export async function readManagerConfig(options: { home?: string; port?: number } = {}): Promise<ManagerConfigInfo> {
  const root = managerHome(options.home);
  const fallbackPort = options.port ?? 8045;
  try {
    const raw = asRecord(JSON.parse(await readFile(join(root, "gui_config.json"), "utf8")));
    const proxy = asRecord(raw?.["proxy"]);
    const port = typeof proxy?.["port"] === "number" && proxy["port"] > 0 ? proxy["port"] : fallbackPort;
    const apiKey = typeof proxy?.["api_key"] === "string" && proxy["api_key"].length > 0 ? proxy["api_key"] : null;
    return { port, apiKey };
  } catch {
    return { port: fallbackPort, apiKey: null };
  }
}

export async function probeManagerHealth(
  port: number,
): Promise<{ running: boolean; version: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return { running: false, version: null };
    const body = asRecord(await response.json());
    const version = body?.["version"];
    return { running: body?.["status"] === "ok", version: typeof version === "string" ? version : null };
  } catch {
    return { running: false, version: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads Antigravity Tools state: prefers the live HTTP admin API (`/api/accounts`) when running so
 * `live_limited_models`, `protected_models`, and `is_current` are live; falls back to disk JSON
 * when the app/gateway is offline.
 */
export async function readManagerState(options: {
  home?: string;
  port?: number;
  limit?: number;
} = {}): Promise<ManagerState> {
  const root = managerHome(options.home);
  const cfg = await readManagerConfig(options);
  const empty: ManagerState = {
    present: false,
    running: false,
    version: null,
    port: cfg.port,
    accounts: [],
    currentAccountId: null,
    currentAgyAccountId: null,
    error: null,
  };

  let present = false;
  try {
    const info = await stat(root);
    present = info.isDirectory();
  } catch {
    present = false;
  }

  let diskCurrentAccountId: string | null = null;
  let diskCurrentAgyAccountId: string | null = null;
  let diskIds: string[] = [];
  let diskError: string | null = null;

  if (present) {
    try {
      const index = asRecord(JSON.parse(await readFile(join(root, "accounts.json"), "utf8")));
      if (typeof index?.["current_account_id"] === "string") {
        diskCurrentAccountId = index["current_account_id"];
      }
      if (typeof index?.["current_agy_account_id"] === "string") {
        diskCurrentAgyAccountId = index["current_agy_account_id"];
      }
      const listed = index?.["accounts"];
      if (Array.isArray(listed)) {
        diskIds = listed
          .map((entry) => asRecord(entry)?.["id"])
          .filter((id): id is string => typeof id === "string" && id.length > 0);
      }
    } catch (error) {
      diskError = describe(error);
    }
  }

  const health = await probeManagerHealth(cfg.port);
  if (health.running && cfg.apiKey) {
    try {
      const live = await fetchLiveManagerAccounts(cfg.port, cfg.apiKey, diskCurrentAgyAccountId);
      if (live !== null) {
        return {
          present: true,
          running: true,
          version: health.version,
          port: cfg.port,
          accounts: live.accounts,
          currentAccountId: live.currentAccountId ?? diskCurrentAccountId,
          currentAgyAccountId: diskCurrentAgyAccountId ?? live.currentAccountId,
          error: null,
        };
      }
    } catch (error) {
      diskError = describe(error);
    }
  }

  if (!present) return empty;

  if (diskIds.length === 0) {
    try {
      diskIds = (await readdir(join(root, "accounts")))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));
    } catch {
      return {
        ...empty,
        present: true,
        running: health.running,
        version: health.version,
        currentAccountId: diskCurrentAccountId,
        currentAgyAccountId: diskCurrentAgyAccountId,
        error: diskError,
      };
    }
  }

  const limit = options.limit ?? 50;
  const activeAgyId = diskCurrentAgyAccountId ?? diskCurrentAccountId;
  const accounts: ManagerAccount[] = [];
  for (const id of diskIds.slice(0, limit)) {
    try {
      const raw = asRecord(JSON.parse(await readFile(join(root, "accounts", `${id}.json`), "utf8")));
      if (raw === null) continue;
      accounts.push(normalizeAccount(id, raw, activeAgyId));
    } catch {
      // Skip mid-write or deleted account files.
    }
  }

  return {
    present: true,
    running: health.running,
    version: health.version,
    port: cfg.port,
    accounts,
    currentAccountId: diskCurrentAccountId,
    currentAgyAccountId: activeAgyId,
    error: diskError,
  };
}

async function fetchLiveManagerAccounts(
  port: number,
  apiKey: string,
  diskCurrentAgyId: string | null,
): Promise<{ accounts: ManagerAccount[]; currentAccountId: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = asRecord(await response.json());
    const rawList = body?.["accounts"];
    if (!Array.isArray(rawList)) return null;
    const currentId =
      typeof body?.["current_account_id"] === "string" ? body["current_account_id"] : null;
    const activeAgyId = diskCurrentAgyId ?? currentId;
    const accounts: ManagerAccount[] = [];
    for (const item of rawList) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = typeof rec["id"] === "string" ? rec["id"] : "";
      if (!id) continue;
      accounts.push(normalizeAccount(id, rec, activeAgyId));
    }
    return { accounts, currentAccountId: currentId };
  } finally {
    clearTimeout(timer);
  }
}

export async function switchManagerAgyAccount(
  accountId: string,
  options: { home?: string; port?: number } = {},
): Promise<{ ok: boolean; message?: string }> {
  const cfg = await readManagerConfig(options);
  if (!cfg.apiKey) {
    return { ok: false, message: "未找到 Antigravity Tools 网关密钥 (gui_config.json)" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`http://127.0.0.1:${cfg.port}/api/accounts/switch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ account_id: accountId, target_ide: "agy" }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, message: text || `切换失败 (HTTP ${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `无法连接 Antigravity Tools: ${describe(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshManagerQuotas(
  options: { home?: string; port?: number } = {},
): Promise<{ ok: boolean; message?: string }> {
  const cfg = await readManagerConfig(options);
  if (!cfg.apiKey) {
    return { ok: false, message: "未找到 Antigravity Tools 网关密钥" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`http://127.0.0.1:${cfg.port}/api/accounts/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, message: `刷新失败 (HTTP ${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `无法连接 Antigravity Tools: ${describe(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function releaseManagerAccountQos(
  accountId: string,
  options: { home?: string; port?: number } = {},
): Promise<{ ok: boolean }> {
  const cfg = await readManagerConfig(options);
  if (!cfg.apiKey) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(
      `http://127.0.0.1:${cfg.port}/api/accounts/${encodeURIComponent(accountId)}/release-qos`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: controller.signal,
      },
    );
    return { ok: response.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAccount(
  id: string,
  raw: Record<string, unknown>,
  activeAgyId: string | null,
): ManagerAccount {
  const token = asRecord(raw["token"]);
  const quota = asRecord(raw["quota"]) ?? {};
  const rawEmail =
    typeof raw["email"] === "string"
      ? raw["email"]
      : typeof token?.["email"] === "string"
        ? token["email"]
        : null;
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  const forbiddenReason = quota["forbidden_reason"];
  const disabledReason =
    typeof raw["disabled_reason"] === "string"
      ? raw["disabled_reason"]
      : typeof raw["proxy_disabled_reason"] === "string"
        ? raw["proxy_disabled_reason"]
        : null;

  const limitedModels = new Set<string>();
  const protectedModels = raw["protected_models"];
  if (Array.isArray(protectedModels)) {
    for (const m of protectedModels) {
      if (typeof m === "string" && m.length > 0) limitedModels.add(m);
    }
  }
  let maxCooldownMs: number | null = null;
  const liveLimited = asRecord(raw["live_limited_models"]);
  if (liveLimited) {
    const now = Date.now();
    for (const [model, untilVal] of Object.entries(liveLimited)) {
      const ts = parseTimestampMs(untilVal);
      if (ts === null || ts > now) {
        limitedModels.add(model);
        if (ts !== null && (maxCooldownMs === null || ts > maxCooldownMs)) {
          maxCooldownMs = ts;
        }
      }
    }
  }
  const blockedUntil = parseTimestampMs(raw["validation_blocked_until"]);
  if (blockedUntil !== null && blockedUntil > Date.now()) {
    maxCooldownMs = maxCooldownMs === null ? blockedUntil : Math.max(maxCooldownMs, blockedUntil);
  }

  const lastUpdatedMs = parseTimestampMs(quota["last_updated"]);

  return {
    id,
    label: name.length > 0 ? name : rawEmail ?? id.slice(0, 8),
    email: rawEmail,
    priority: typeof raw["priority"] === "number" ? raw["priority"] : null,
    disabled: raw["disabled"] === true || raw["proxy_disabled"] === true,
    disabledReason,
    needsSignIn: raw["validation_blocked"] === true,
    forbidden: quota["is_forbidden"] === true,
    forbiddenReason: typeof forbiddenReason === "string" ? forbiddenReason : null,
    plan: typeof quota["subscription_tier"] === "string" ? quota["subscription_tier"] : null,
    windows: readWindows(quota),
    lastUsedAt: typeof raw["last_used"] === "number" ? raw["last_used"] : null,
    readAt: lastUpdatedMs !== null ? new Date(lastUpdatedMs).toISOString() : null,
    limitedModels: [...limitedModels],
    cooldownUntilMs: maxCooldownMs,
    isCurrent: activeAgyId !== null ? id === activeAgyId : raw["is_current"] === true,
  };
}

function detectPool(groupName: string, label: string): ManagerWindow["pool"] {
  const s = `${groupName} ${label}`.toLowerCase();
  if (/argon/.test(s)) return "gemini 4 argon";
  if (/claude|gpt/.test(s)) return "claude";
  if (/gemini/.test(s)) return "gemini";
  return undefined;
}

function detectPeriod(windowName: string, label: string): ManagerWindow["period"] {
  const s = `${windowName} ${label}`.toLowerCase();
  if (/5\s*h|5\s*hour/.test(s)) return "5h";
  if (/week|7\s*d|7\s*day/.test(s)) return "7d";
  return "other";
}

function readWindows(quota: Record<string, unknown>): ManagerWindow[] {
  const windows: ManagerWindow[] = [];

  const groups = quota["quota_groups"];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const record = asRecord(group);
      const buckets = record?.["buckets"];
      if (!record || !Array.isArray(buckets)) continue;
      const groupName = typeof record["display_name"] === "string" ? record["display_name"] : "";
      for (const bucket of buckets) {
        const entry = asRecord(bucket);
        if (!entry) continue;
        const fraction = entry["remaining_fraction"];
        const remainingPct =
          typeof fraction === "number" && Number.isFinite(fraction)
            ? Math.round(Math.min(1, Math.max(0, fraction)) * 100)
            : null;
        const bucketId = typeof entry["bucket_id"] === "string" ? entry["bucket_id"] : null;
        const window = typeof entry["window"] === "string" ? entry["window"] : "";
        const bucketLabel =
          typeof entry["display_name"] === "string" && entry["display_name"].length > 0
            ? entry["display_name"]
            : window.length > 0
              ? window
              : "quota";
        const label =
          groupName.length > 0 && groupName !== bucketLabel
            ? `${groupName} · ${bucketLabel}`
            : bucketLabel;
        if (bucketId === null) continue;
        windows.push({
          id: bucketId,
          label,
          ...(window.length > 0 ? { shortLabel: window } : {}),
          pool: detectPool(groupName, label),
          period: detectPeriod(window, label),
          remainingPct,
          resetsAt: isoOrNull(entry["reset_time"]),
        });
      }
    }
  }

  if (windows.length > 0) return windows;

  const models = quota["models"];
  if (!Array.isArray(models)) return windows;
  for (const model of models) {
    const entry = asRecord(model);
    if (!entry) continue;
    const modelId = entry["model"] ?? entry["name"];
    if (typeof modelId !== "string") continue;
    const percentage = entry["percentage"];
    const remaining =
      typeof percentage === "number" && Number.isFinite(percentage)
        ? Math.round(Math.min(100, Math.max(0, percentage)))
        : null;
    const label = typeof entry["display_name"] === "string" ? entry["display_name"] : modelId;
    windows.push({
      id: modelId,
      label,
      pool: detectPool("", label),
      period: "other",
      remainingPct: remaining,
      resetsAt: isoOrNull(entry["reset_time"]),
    });
  }
  return windows;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
