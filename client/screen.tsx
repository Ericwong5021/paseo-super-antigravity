import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRefreshSnapshot, useSuperSettingsState, useSuperSnapshot } from "./hooks";
import { MaskToggle } from "./mosaic";
import { AccountsTab } from "./tab-accounts";
import { CapsuleTab } from "./tab-capsule";
import { RiskTab } from "./tab-risk";

type TabKey = "accounts" | "risk" | "capsule";

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: "accounts", label: "账号" },
  { key: "risk", label: "冷却" },
  { key: "capsule", label: "胶囊" },
];

export function SuperScreen({ theme, layout, params }: PluginScreenProps) {
  const c = theme.colors;
  const initialTab: TabKey =
    params.tab === "risk" || params.tab === "capsule" ? params.tab : "accounts";
  const [tab, setTab] = useState<TabKey>(initialTab);

  const { data: snapshot, isLoading } = useSuperSnapshot();
  const { settings, values, savePartial, toggleMask } = useSuperSettingsState();
  const refresh = useRefreshSnapshot();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.surface0 }}
      contentContainerStyle={{
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 14 : 18,
        maxWidth: 880,
        width: "100%",
        alignSelf: "center",
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="Sparkles" size={20} color={c.accent} />
          <View>
            <Text style={{ fontSize: layout.compact ? 18 : 20, fontWeight: "700", color: c.foreground }}>
              Antigravity
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: snapshot?.manager.running ? c.statusSuccess : c.foregroundMuted,
                }}
              />
              <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
                {snapshot?.manager.running
                  ? `Antigravity Tools v${snapshot.manager.version ?? ""} 已联动`.trim()
                  : snapshot?.manager.present
                    ? "Antigravity Tools 未运行 · 本地模式"
                    : "本地 CLI 模式"}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MaskToggle
            masked={values.sidebar.maskAccounts}
            disabled={settings.saving}
            theme={theme}
            onToggle={() => void toggleMask()}
          />
          <Pressable
            onPress={() => refresh.mutate({ includeAgy: tab === "accounts" })}
            disabled={refresh.isPending}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : c.surface0,
              opacity: refresh.isPending ? 0.55 : 1,
            })}
          >
            <Icon name="RefreshCw" size={13} color={c.foreground} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: c.foreground }}>
              {refresh.isPending ? "刷新中…" : "刷新"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Segmented Tabs */}
      <View
        style={{
          flexDirection: "row",
          padding: 3,
          borderRadius: 10,
          backgroundColor: c.surface1,
          borderWidth: 1,
          borderColor: c.border,
          alignSelf: "flex-start",
          gap: 3,
        }}
      >
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 7,
                backgroundColor: active
                  ? c.accent
                  : pressed
                    ? c.surface2
                    : "transparent",
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: active ? "700" : "500",
                  color: active ? c.accentForeground : c.foreground,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab Body */}
      {tab === "accounts" ? (
        <AccountsTab
          theme={theme}
          layout={layout}
          snapshot={snapshot}
          masked={values.sidebar.maskAccounts}
          isLoading={isLoading}
        />
      ) : tab === "risk" ? (
        <RiskTab
          theme={theme}
          values={values}
          saving={settings.saving}
          refreshing={refresh.isPending}
          onSave={savePartial}
          onRefreshManager={() => refresh.mutate({ includeAgy: false })}
        />
      ) : (
        <CapsuleTab
          theme={theme}
          values={values}
          accounts={snapshot?.accounts ?? []}
          managerRunning={snapshot?.manager.running}
          saving={settings.saving}
          onSave={savePartial}
        />
      )}
    </ScrollView>
  );
}
