import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text } from "react-native";

function maskSegment(segment: string): string {
  if (segment.length <= 2) return "*".repeat(segment.length);
  return `${segment.slice(0, 2)}${"*".repeat(Math.min(6, Math.max(2, segment.length - 2)))}`;
}

/** Masks emails (`a@b.com` -> `ab***@b***.com`) or plain labels (`Work` -> `Wo**`). */
export function maskAccountText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const atIndex = trimmed.indexOf("@");
  if (atIndex > 0) {
    const local = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1);
    const dot = domain.lastIndexOf(".");
    if (dot > 0) {
      return `${maskSegment(local)}@${maskSegment(domain.slice(0, dot))}${domain.slice(dot)}`;
    }
    return `${maskSegment(local)}@${maskSegment(domain)}`;
  }
  return maskSegment(trimmed);
}

export function MosaicAccount({
  value,
  masked,
  numberOfLines = 1,
  style,
}: {
  value: string;
  masked: boolean;
  numberOfLines?: number;
  style?: object;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={style}>
      {masked ? maskAccountText(value) : value}
    </Text>
  );
}

export function MaskToggle({
  masked,
  disabled,
  theme,
  compact = false,
  onToggle,
}: {
  masked: boolean;
  disabled?: boolean;
  theme: PluginTheme;
  compact?: boolean;
  onToggle: () => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={masked ? "显示账号名称" : "隐藏账号名称"}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: compact ? 4 : 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: masked ? c.accent : c.border,
        backgroundColor: pressed ? c.surface2 : c.surface0,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <Icon name={masked ? "EyeOff" : "Eye"} size={13} color={masked ? c.accent : c.foregroundMuted} />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: masked ? c.accent : c.foregroundMuted,
        }}
      >
        {masked ? "已打码" : "打码"}
      </Text>
    </Pressable>
  );
}
