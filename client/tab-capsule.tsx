import type { PluginScreenProps } from "@getpaseo/plugin/client";
import {
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { SuperSettings } from "../shared/settings";
import type { SuperAccount } from "../shared/super";
import { SidebarIndicator } from "./sidebar-indicator";

const CONTENT_OPTIONS: readonly { label: string; value: SuperSettings["sidebar"]["content"] }[] = [
  { label: "Gemini 5 小时剩余额度", value: "gemini-5h" },
  { label: "Gemini 7 天剩余额度", value: "gemini-week" },
  { label: "Gemini 4 Argon 7 天额度", value: "gemini-4-argon-week" },
  { label: "仅运行状态", value: "status" },
  { label: "隐藏侧边栏胶囊", value: "hidden" },
];

const STYLE_OPTIONS: readonly { label: string; value: SuperSettings["sidebar"]["style"] }[] = [
  { label: "进度条 + 百分比", value: "bar-percent" },
  { label: "仅进度条", value: "bar" },
  { label: "仅百分比", value: "percent" },
];

const COLOR_OPTIONS: readonly { label: string; value: SuperSettings["sidebar"]["color"] }[] = [
  { label: "主题高亮色", value: "accent" },
  { label: "中性灰色", value: "gray" },
];

export function CapsuleTab({
  theme,
  values,
  accounts,
  managerRunning,
  saving,
  onSave,
}: {
  theme: PluginScreenProps["theme"];
  values: SuperSettings;
  accounts: readonly SuperAccount[];
  managerRunning?: boolean;
  saving: boolean;
  onSave: (updater: (curr: SuperSettings) => SuperSettings) => Promise<boolean>;
}) {
  const c = theme.colors;
  const sidebar = values.sidebar;

  const updateSidebar = (patch: Partial<SuperSettings["sidebar"]>) =>
    void onSave((curr) => ({
      ...curr,
      sidebar: { ...curr.sidebar, ...patch },
    }));

  return (
    <View style={{ gap: 18 }}>
      {/* Live Preview */}
      <View
        style={{
          padding: 14,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: c.foreground }}>
            侧边栏胶囊实时预览
          </Text>
          <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
            在左侧栏点击胶囊可直接打开配额速览弹窗
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface0,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: c.foreground }}>
            Antigravity
          </Text>
          {sidebar.content === "hidden" ? (
            <Text style={{ fontSize: 11, color: c.foregroundMuted }}>已隐藏</Text>
          ) : (
            <SidebarIndicator
              theme={theme}
              accounts={accounts}
              managerRunning={managerRunning}
              sidebar={sidebar}
            />
          )}
        </View>
      </View>

      <SettingsSection title="胶囊外观与隐私">
        <SettingsSelect
          label="展示内容"
          hint="默认展示聚合后的 Gemini 5 小时剩余百分比"
          value={sidebar.content}
          options={CONTENT_OPTIONS}
          disabled={saving}
          onValueChange={(content) => updateSidebar({ content })}
        />

        <SettingsSelect
          label="胶囊样式"
          value={sidebar.style}
          options={STYLE_OPTIONS}
          disabled={saving || sidebar.content === "hidden" || sidebar.content === "status"}
          onValueChange={(style) => updateSidebar({ style })}
        />

        <SettingsSelect
          label="进度条配色"
          value={sidebar.color}
          options={COLOR_OPTIONS}
          disabled={saving || sidebar.content === "hidden" || sidebar.content === "status"}
          onValueChange={(color) => updateSidebar({ color })}
        />

        <SettingsSwitch
          label="低于 20% 标红提醒"
          hint="当聚合剩余额度低于 20% 时使用警示红色显示"
          value={sidebar.lowColor}
          disabled={saving || sidebar.content === "hidden" || sidebar.content === "status"}
          onValueChange={(lowColor) => updateSidebar({ lowColor })}
        />

        <SettingsSwitch
          label="默认打码隐藏账号与邮箱"
          hint="在截图、录屏或共享屏幕时遮蔽账号邮箱与别名"
          value={sidebar.maskAccounts}
          disabled={saving}
          onValueChange={(maskAccounts) => updateSidebar({ maskAccounts })}
        />
      </SettingsSection>
    </View>
  );
}
