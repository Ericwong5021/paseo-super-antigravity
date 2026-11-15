import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SuperScreen } from "./client/screen";
import { SuperSidebarItem } from "./client/sidebar";
import { GEMINI_ICON } from "./shared/gemini-icon";

/**
 * The app half.
 *
 * One clean sidebar entry with a 5h quota capsule + popover, opening into a 3-tab
 * Paseo-native management screen (账号 / 冷却 / 胶囊).
 */
export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "main",
    title: "Antigravity",
    Component: SuperScreen,
  });

  client.addSidebarHeaderItem({
    id: "antigravity",
    title: "Antigravity",
    Component: SuperSidebarItem,
  });

  client.addCommandCenterItem({
    id: "open-antigravity",
    title: "打开 Antigravity 配额与账号",
    icon: GEMINI_ICON,
    context: "global",
    keywords: ["antigravity", "quota", "agy", "account"],
    onSelect: (ctx) => {
      ctx.openScreen({ screenId: "main" });
    },
  });

  client.addSlashCommand({
    name: "antigravity",
    description: "打开 Antigravity 配额、风控冷却或胶囊设置",
    argumentHint: "[accounts|risk|capsule]",
    context: "agent",
    onSubmit: (ctx) => {
      const arg = ctx.args.trim().toLowerCase();
      const tab = arg === "risk" || arg === "capsule" ? arg : "accounts";
      ctx.openScreen({ screenId: "main", params: { tab } });
    },
  });

  return () => {};
}
