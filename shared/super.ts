import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const UsageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  shortLabel: z.string().optional(),
  pool: z.string().optional(),
  period: z.enum(["5h", "7d", "other"]).optional(),
  usedPct: z.number().nullable(),
  remainingPct: z.number().nullable(),
  resetsAt: z.string().nullable(),
});
export type UsageWindowView = z.infer<typeof UsageWindowSchema>;

export const AccountHealthSchema = z.enum([
  "ready",
  "cooling",
  "banned",
  "reauth",
  "disabled",
  "unknown",
]);
export type AccountHealth = z.infer<typeof AccountHealthSchema>;

export const AccountSourceSchema = z.enum(["agy", "manager"]);
export type AccountSource = z.infer<typeof AccountSourceSchema>;

export const SuperAccountSchema = z.object({
  id: z.string(),
  source: AccountSourceSchema,
  label: z.string(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  active: z.boolean(),
  health: AccountHealthSchema,
  healthDetail: z.string().nullable(),
  cooldownUntil: z.string().nullable(),
  windows: z.array(UsageWindowSchema),
  priority: z.number().nullable(),
  launchable: z.boolean(),
  disabled: z.boolean().default(false),
  readAt: z.string().nullable().default(null),
  limitedModels: z.array(z.string()).default([]),
});
export type SuperAccount = z.infer<typeof SuperAccountSchema>;

export const ManagerStatusSchema = z.object({
  present: z.boolean(),
  running: z.boolean(),
  version: z.string().nullable(),
  port: z.number(),
  accountCount: z.number(),
  currentAgyAccountId: z.string().nullable(),
  error: z.string().nullable(),
});
export type ManagerStatus = z.infer<typeof ManagerStatusSchema>;

export const SuperSnapshotSchema = z.object({
  accounts: z.array(SuperAccountSchema),
  manager: ManagerStatusSchema,
  agyActiveId: z.string(),
  /** The account the local `agy` last reported signing in as. */
  realAgyEmail: z.string().nullable().default(null),
  /** Antigravity Tools' pointer names an account the CLI is not signed in as. */
  pointerMismatch: z.boolean().default(false),
  suggested: z
    .object({
      id: z.string(),
      source: AccountSourceSchema,
      label: z.string(),
    })
    .nullable(),
  fetchedAt: z.number(),
});
export type SuperSnapshot = z.infer<typeof SuperSnapshotSchema>;

export const snapshotRpc = defineRpc({
  name: "super.accounts.snapshot",
  input: z.object({ refresh: z.boolean().optional() }),
  output: SuperSnapshotSchema,
});

export const switchAccountRpc = defineRpc({
  name: "super.accounts.switch",
  input: z.object({
    source: AccountSourceSchema,
    id: z.string().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    activeId: z.string(),
    message: z.string().optional(),
  }),
});

export const useAccountRpc = defineRpc({
  name: "super.accounts.use",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ active: z.string() }),
});

export const refreshManagerRpc = defineRpc({
  name: "super.manager.refresh",
  input: z.object({}),
  output: SuperSnapshotSchema,
});

export const releaseCooldownRpc = defineRpc({
  name: "super.accounts.release-cooldown",
  input: z.object({
    source: AccountSourceSchema,
    id: z.string().min(1),
  }),
  output: z.object({ ok: z.boolean() }),
});

export const ModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  tiers: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const modelCatalogRpc = defineRpc({
  name: "super.models.catalog",
  input: z.object({}),
  output: z.object({
    models: z.array(ModelOptionSchema),
    account: z.string(),
  }),
});

export const SubagentSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  role: z.string().nullable(),
  prompt: z.string().nullable(),
  cwd: z.string().nullable(),
  openedAt: z.number(),
});

export const subagentsRpc = defineRpc({
  name: "super.subagents.list",
  input: z.object({ limit: z.number().int().positive().max(200).default(50) }),
  output: z.object({ subagents: z.array(SubagentSchema) }),
});

export const handoffRpc = defineRpc({
  name: "super.handoff.prepare",
  input: z.object({
    sessionId: z.string(),
    maxChars: z.number().int().positive().max(200_000).default(24_000),
  }),
  output: z.object({
    brief: z.string(),
    rows: z.number(),
    model: z.string().nullable(),
    thinking: z.string().nullable(),
    truncated: z.boolean(),
  }),
});
