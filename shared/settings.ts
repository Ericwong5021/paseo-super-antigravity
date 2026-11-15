import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const ModelChoiceSchema = z.object({
  model: z.string().default(""),
  thinking: z.string().default(""),
});

const ModelChoiceDefault = { model: "", thinking: "" };

const RiskSchema = z.object({
  /** 自动记录 429/风控/额度耗尽失败并冷却账号 */
  enabled: z.boolean().default(true),
  /** 新建会话时，若当前账号冷却或低于额度下限则自动切换健康账号 */
  autoRotate: z.boolean().default(true),
  /** 低于该百分比时视作额度耗尽并触发避让 */
  minRemainingPct: z.number().min(0).max(100).default(5),
  /** 首次失败后的冷却时长（分钟） */
  baseCooldownMinutes: z.number().min(1).max(240).default(15),
  /** 连续失败指数退避上限（分钟） */
  maxCooldownMinutes: z.number().min(1).max(1440).default(120),
  /** 触发冷却所需的连续失败次数 */
  failureThreshold: z.number().int().min(1).max(10).default(1),
});

const ManagerSchema = z.object({
  /** 联动本地 Antigravity Tools (读取账号配额与切换当前 agy 账号) */
  enabled: z.boolean().default(true),
  /** 兼容旧字段别名 */
  readState: z.boolean().default(true),
  /** 自定义状态目录，留空表示 ~/.antigravity_tools */
  home: z.string().default(""),
  /** 本地网关端口（默认自动从 gui_config.json 读取，回退 8045） */
  port: z.number().int().min(1).max(65535).default(8045),
});

const SidebarSchema = z.object({
  /** 侧边栏胶囊默认展示 Gemini 5 小时额度 */
  content: z
    .enum(["gemini-5h", "gemini-week", "gemini-4-argon-week", "status", "hidden"])
    .default("gemini-5h"),
  /** 胶囊展示样式：进度条+百分比 / 仅进度条 / 仅百分比 */
  style: z.enum(["bar-percent", "bar", "percent"]).default("bar-percent"),
  /** 配色：主题色 / 灰色 */
  color: z.enum(["accent", "gray"]).default("accent"),
  /** 低于 20% 标红提醒 */
  lowColor: z.boolean().default(true),
  /** 默认打码隐藏账号名称与邮箱 */
  maskAccounts: z.boolean().default(false),
});

const ModelsSchema = z.object({
  plan: ModelChoiceSchema.default(ModelChoiceDefault),
  implement: ModelChoiceSchema.default(ModelChoiceDefault),
  review: ModelChoiceSchema.default(ModelChoiceDefault),
  subagent: ModelChoiceSchema.default(ModelChoiceDefault),
});

export const RISK_DEFAULTS = {
  enabled: true,
  autoRotate: true,
  minRemainingPct: 5,
  baseCooldownMinutes: 15,
  maxCooldownMinutes: 120,
  failureThreshold: 1,
} as const;

export const MANAGER_DEFAULTS = {
  enabled: true,
  readState: true,
  home: "",
  port: 8045,
} as const;

export const SIDEBAR_DEFAULTS = {
  content: "gemini-5h" as const,
  style: "bar-percent" as const,
  color: "accent" as const,
  lowColor: true,
  maskAccounts: false,
};

export const superSettings = defineSettings({
  id: "super-antigravity",
  scope: "host",
  version: 1,
  schema: z.object({
    risk: RiskSchema.default(RISK_DEFAULTS),
    manager: ManagerSchema.default(MANAGER_DEFAULTS),
    sidebar: SidebarSchema.default(SIDEBAR_DEFAULTS),
    models: ModelsSchema.default({
      plan: ModelChoiceDefault,
      implement: ModelChoiceDefault,
      review: ModelChoiceDefault,
      subagent: ModelChoiceDefault,
    }),
  }),
});

export type SuperSettings = z.infer<typeof superSettings.schema>;
export type SidebarSettings = SuperSettings["sidebar"];
export type TaskRole = keyof SuperSettings["models"];
export const TASK_ROLES: readonly TaskRole[] = ["plan", "implement", "review", "subagent"];
