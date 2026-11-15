import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderModel } from "@getpaseo/plugin/server/provider";
import { buildBrief } from "./server/handoff/brief";
import {
  readManagerState,
  refreshManagerQuotas,
  releaseManagerAccountQos,
  switchManagerAgyAccount,
} from "./server/manager/store";
import { verifyManagerAgySwitch } from "./server/manager/verify-switch";
import {
  bindRuntimeSettings,
  managerRiskKey,
  readRuntimeSettings,
} from "./server/risk/runtime";
import { clearRecord } from "./server/risk/store";
import { buildSuperSnapshot } from "./server/snapshot";
import { listChildren } from "./server/subagents/registry";
import { superSettings } from "./shared/settings";
import {
  DEFAULT_ACCOUNT_ID,
  addAccount,
  listAccounts,
  multiAccountSupported,
  readAccountSettings,
  readAccounts,
  removeAccount,
  setActive,
  updateAccountSettings,
} from "./server/core/accounts";
import { buildCatalog, invalidateCatalogCache } from "./server/core/catalog";
import { createProvider } from "./server/core/provider";
import { forgetAccountQuota, readAccountQuota } from "./server/core/quota";
import { launchSignIn } from "./server/core/signin";
import { createUsageSource } from "./server/core/usage";
import {
  accountsAdd,
  accountsList,
  accountsQuota,
  accountsRemove,
  accountsSetActive,
  accountsSettingsGet,
  accountsSettingsUpdate,
  accountsSignIn,
} from "./shared/core/accounts";
import {
  handoffRpc,
  modelCatalogRpc,
  refreshManagerRpc,
  releaseCooldownRpc,
  snapshotRpc,
  subagentsRpc,
  switchAccountRpc,
  useAccountRpc,
} from "./shared/super";

/**
 * The daemon half.
 *
 * `server/core` drives the forked agy provider (`antigravity-super`, ACP + NDJSON), while
 * `server/{manager,risk,handoff,subagents,snapshot}` add Antigravity Tools integration,
 * cooldown/risk protection, and automatic rotation.
 */
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(superSettings);
  bindRuntimeSettings(settings);

  server.registerProvider(createProvider());
  server.registerUsageSource(createUsageSource());

  // --- Forked account management ------------------------------------------------------------
  server.handle(accountsList, () => ({
    active: readAccounts().active,
    accounts: listAccounts(),
    multiAccount: multiAccountSupported(),
  }));

  server.handle(accountsSetActive, ({ id }) => {
    setActive(id);
    invalidateCatalogCache();
    return { active: readAccounts().active };
  });

  server.handle(accountsAdd, ({ name }) => {
    const account = addAccount(name);
    return { id: account.id, name: account.name };
  });

  server.handle(accountsRemove, ({ id }) => {
    removeAccount(id);
    forgetAccountQuota(id);
    return { removed: id, active: readAccounts().active };
  });

  server.handle(accountsQuota, ({ id, refresh }) => readAccountQuota(id, { refresh }));

  server.handle(accountsSignIn, ({ id }) => launchSignIn(id));

  server.handle(accountsSettingsGet, ({ id }) => ({
    ...readAccountSettings(id),
    editable: id !== DEFAULT_ACCOUNT_ID,
  }));

  server.handle(accountsSettingsUpdate, ({ id, toolPermission, trustedWorkspaces }) => {
    updateAccountSettings(id, { toolPermission, trustedWorkspaces });
    return { ...readAccountSettings(id), editable: id !== DEFAULT_ACCOUNT_ID };
  });

  // --- Super features -----------------------------------------------------------------------

  server.handle(snapshotRpc, async ({ refresh }) => buildSuperSnapshot({ refresh }));

  server.handle(switchAccountRpc, async ({ source, id }) => {
    if (source === "agy") {
      setActive(id);
      invalidateCatalogCache();
      return { ok: true, activeId: readAccounts().active };
    }

    const cfg = await readRuntimeSettings();
    const res = await switchManagerAgyAccount(id, {
      home: cfg.manager.home,
      port: cfg.manager.port,
    });
    if (!res.ok) {
      return {
        ok: false,
        activeId: readAccounts().active,
        message: res.message ?? "切换账号失败",
      };
    }

    if (readAccounts().active !== DEFAULT_ACCOUNT_ID) {
      setActive(DEFAULT_ACCOUNT_ID);
    }
    await clearRecord(DEFAULT_ACCOUNT_ID);
    invalidateCatalogCache();
    const verification = await verifyManagerAgySwitch({
      accountId: id,
      home: cfg.manager.home,
      port: cfg.manager.port,
    });
    return {
      ok: true,
      activeId: id,
      ...(verification.message ? { message: verification.message } : {}),
    };
  });

  /** Legacy alias kept for compatibility. */
  server.handle(useAccountRpc, ({ id }) => {
    if (!listAccounts().some((account) => account.id === id)) {
      throw new Error(`未找到本地 agy 账号 "${id}"`);
    }
    setActive(id);
    invalidateCatalogCache();
    return { active: readAccounts().active };
  });

  server.handle(refreshManagerRpc, async () => {
    const cfg = await readRuntimeSettings();
    if (cfg.manager.enabled) {
      await refreshManagerQuotas({
        home: cfg.manager.home,
        port: cfg.manager.port,
      });
    }
    return buildSuperSnapshot({ refresh: true });
  });

  server.handle(releaseCooldownRpc, async ({ source, id }) => {
    if (source === "agy") {
      await clearRecord(id);
      return { ok: true };
    }

    const cfg = await readRuntimeSettings();
    await clearRecord(managerRiskKey(id));
    if (cfg.manager.enabled) {
      const mgr = await readManagerState({
        home: cfg.manager.home,
        port: cfg.manager.port,
      });
      if (mgr.currentAgyAccountId === id || mgr.currentAccountId === id) {
        await clearRecord(DEFAULT_ACCOUNT_ID);
      }
      await releaseManagerAccountQos(id, {
        home: cfg.manager.home,
        port: cfg.manager.port,
      });
    }
    return { ok: true };
  });

  /** The model families and reasoning tiers the active account's CLI reports. */
  server.handle(modelCatalogRpc, async () => {
    const active = readAccounts().active;
    const catalog = await buildCatalog(active);
    return {
      account: active,
      models: catalog.models.map((model) => ({
        id: model.id,
        label: model.label,
        tiers: (model.thinkingOptions ?? []).map((tier) => ({
          id: tier.id,
          label: tier.label,
        })),
      })),
    };
  });

  server.handle(subagentsRpc, async ({ limit }) => {
    const children = await listChildren(limit);
    return {
      subagents: children.map((child) => ({
        id: child.id,
        parentId: child.parentId,
        role: child.role,
        prompt: child.prompt,
        cwd: child.cwd,
        openedAt: child.openedAt,
      })),
    };
  });

  server.handle(handoffRpc, async ({ sessionId, maxChars }) => {
    const values = await readRuntimeSettings();
    const result = await buildBrief(sessionId, maxChars);
    const choice = values.models.implement;
    return {
      brief: result.brief,
      rows: result.rows,
      model: choice.model.length > 0 ? choice.model : null,
      thinking: choice.thinking.length > 0 ? choice.thinking : null,
      truncated: result.truncated,
    };
  });

  return () => {};
}

export type { ProviderModel };
