import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import {
  summarizeAntigravity,
  type AntigravityPool,
  type QuotaPeriod,
} from "../shared/quota-summary";
import type { SuperSettings } from "../shared/settings";
import type { SuperAccount } from "../shared/super";
import { clampPct } from "./format";

export type SidebarContentMode = SuperSettings["sidebar"]["content"];
export type SidebarStyleMode = SuperSettings["sidebar"]["style"];
export type SidebarColorMode = SuperSettings["sidebar"]["color"];

const MODE_META: Record<
  Exclude<SidebarContentMode, "status" | "hidden">,
  { period: QuotaPeriod; pool: AntigravityPool; label: string }
> = {
  "gemini-5h": { period: "5h", pool: "gemini", label: "Gemini 5h" },
  "gemini-week": { period: "7d", pool: "gemini", label: "Gemini 周配额" },
  "gemini-4-argon-week": {
    period: "7d",
    pool: "gemini 4 argon",
    label: "Gemini 4 Argon 周配额",
  },
};

export function SidebarIndicator({
  theme,
  accounts,
  managerRunning,
  sidebar,
  onPress,
}: {
  theme: PluginTheme;
  accounts: readonly SuperAccount[];
  managerRunning?: boolean;
  sidebar: SuperSettings["sidebar"];
  onPress?: () => void;
}) {
  const c = theme.colors;
  if (sidebar.content === "hidden") return null;

  if (sidebar.content === "status") {
    const anyCooling = accounts.some((a) => a.health === "cooling");
    const anyReady = accounts.some((a) => a.health === "ready");
    const dotColor = anyReady
      ? c.statusSuccess
      : anyCooling
        ? c.statusWarning
        : managerRunning === false
          ? c.foregroundMuted
          : c.statusDanger;
    const text = anyReady ? "就绪" : anyCooling ? "冷却" : "待处理";
    return (
      <IndicatorShell theme={theme} onPress={onPress} label={`Antigravity 状态：${text}`}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            backgroundColor: dotColor,
          }}
        />
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: c.foregroundMuted,
          }}
        >
          {text}
        </Text>
      </IndicatorShell>
    );
  }

  const meta = MODE_META[sidebar.content];
  const summary = summarizeAntigravity(accounts, meta.period, meta.pool);
  const pct = summary.remaining;

  if (pct === null) {
    return (
      <IndicatorShell theme={theme} onPress={onPress} label={`${meta.label}：暂无数据`}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: c.foregroundMuted,
            fontVariant: ["tabular-nums"],
          }}
        >
          —
        </Text>
      </IndicatorShell>
    );
  }

  const clamped = clampPct(pct);
  const isLow = sidebar.lowColor && clamped < 20;
  const fill = isLow
    ? c.statusDanger
    : sidebar.color === "accent"
      ? c.accent
      : c.foregroundMuted;

  const showBar = sidebar.style === "bar-percent" || sidebar.style === "bar";
  const showPercent = sidebar.style === "bar-percent" || sidebar.style === "percent";

  return (
    <IndicatorShell
      theme={theme}
      onPress={onPress}
      label={`${meta.label} 剩余 ${clamped}% (${summary.included}/${summary.total})`}
    >
      {showBar ? (
        <View
          style={{
            width: 28,
            height: 5,
            borderRadius: 999,
            backgroundColor: c.surface2,
            borderWidth: 1,
            borderColor: c.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${clamped}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: fill,
            }}
          />
        </View>
      ) : null}
      {showPercent ? (
        <Text
          style={{
            fontSize: 11,
            fontWeight: "700",
            color: isLow ? c.statusDanger : c.foreground,
            fontVariant: ["tabular-nums"],
          }}
        >
          {clamped}%
        </Text>
      ) : null}
    </IndicatorShell>
  );
}

function IndicatorShell({
  theme,
  label,
  onPress,
  children,
}: {
  theme: PluginTheme;
  label: string;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  const c = theme.colors;
  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: c.surface1,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      {children}
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        borderRadius: 999,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      {inner}
    </Pressable>
  );
}
