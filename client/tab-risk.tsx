import type { PluginScreenProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { SuperSettings } from "../shared/settings";

const MIN_PCT_OPTIONS = [0, 5, 10, 20] as const;
const COOLDOWN_MINUTES_OPTIONS = [5, 15, 30, 60] as const;
const THRESHOLD_OPTIONS = [1, 2, 3] as const;

export function RiskTab({
  theme,
  values,
  saving,
  refreshing,
  onSave,
  onRefreshManager,
}: {
  theme: PluginScreenProps["theme"];
  values: SuperSettings;
  saving: boolean;
  refreshing: boolean;
  onSave: (updater: (curr: SuperSettings) => SuperSettings) => Promise<boolean>;
  onRefreshManager: () => void;
}) {
  return (
    <View style={{ gap: 18 }}>
      <SettingsSection title="风控与自动避让">
        <SettingsSwitch
          label="启用运行时风控冷却"
          hint="当对话遇到 429、限流、配额耗尽或授权异常时自动标记账号进入冷却"
          value={values.risk.enabled}
          disabled={saving}
          onValueChange={(enabled) =>
            void onSave((curr) => ({ ...curr, risk: { ...curr.risk, enabled } }))
          }
        />

        <SettingsSwitch
          label="新会话自动轮换健康账号"
          hint="新建会话前，若当前账号处于冷却、被限流或低于额度下限，自动切换至最佳账号"
          value={values.risk.autoRotate}
          disabled={saving || !values.risk.enabled}
          onValueChange={(autoRotate) =>
            void onSave((curr) => ({ ...curr, risk: { ...curr.risk, autoRotate } }))
          }
        />

        <SettingsRow
          label="触发避让的最低剩余额度"
          hint="Gemini 5h/7d 任意窗口低于该值时不再用于新会话（默认 5%）"
        >
          <OptionPills
            theme={theme}
            disabled={saving || !values.risk.enabled}
            value={values.risk.minRemainingPct}
            options={MIN_PCT_OPTIONS.map((v) => ({ value: v, label: `${v}%` }))}
            onSelect={(minRemainingPct) =>
              void onSave((curr) => ({ ...curr, risk: { ...curr.risk, minRemainingPct } }))
            }
          />
        </SettingsRow>

        <SettingsRow
          label="基础冷却时长"
          hint="首次触发风控后的冷却分钟数，连续失败将指数退避"
        >
          <OptionPills
            theme={theme}
            disabled={saving || !values.risk.enabled}
            value={values.risk.baseCooldownMinutes}
            options={COOLDOWN_MINUTES_OPTIONS.map((v) => ({ value: v, label: `${v} 分钟` }))}
            onSelect={(baseCooldownMinutes) =>
              void onSave((curr) => ({ ...curr, risk: { ...curr.risk, baseCooldownMinutes } }))
            }
          />
        </SettingsRow>

        <SettingsRow
          label="连续失败触发阈值"
          hint="连续报错多少次后开始进入冷却（默认 1 次立即避让）"
        >
          <OptionPills
            theme={theme}
            disabled={saving || !values.risk.enabled}
            value={values.risk.failureThreshold}
            options={THRESHOLD_OPTIONS.map((v) => ({ value: v, label: `${v} 次` }))}
            onSelect={(failureThreshold) =>
              void onSave((curr) => ({ ...curr, risk: { ...curr.risk, failureThreshold } }))
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Antigravity Tools 联动">
        <SettingsSwitch
          label="连接本地 Antigravity Tools"
          hint="读取多账号配额与限流状态，并通过本地网关一键切换 agy 当前账号"
          value={values.manager.enabled}
          disabled={saving}
          onValueChange={(enabled) =>
            void onSave((curr) => ({
              ...curr,
              manager: { ...curr.manager, enabled, readState: enabled },
            }))
          }
        />

        <SettingsInput
          label="网关端口"
          hint="留空或默认 8045 时会自动优先读取 gui_config.json 中的真实端口"
          initialValue={String(values.manager.port)}
          disabled={saving || !values.manager.enabled}
          onChangeText={(text) => {
            const parsed = Number.parseInt(text.trim(), 10);
            if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535 && parsed !== values.manager.port) {
              void onSave((curr) => ({ ...curr, manager: { ...curr.manager, port: parsed } }));
            }
          }}
        />

        <SettingsAction
          label="同步账号与实时配额"
          hint="向 Antigravity Tools 发起主动配额刷新并更新本地快照"
          actionLabel={refreshing ? "同步中…" : "立即同步"}
          disabled={refreshing || !values.manager.enabled}
          onPress={onRefreshManager}
        />
      </SettingsSection>
    </View>
  );
}

function OptionPills<T extends number | string>({
  theme,
  options,
  value,
  disabled,
  onSelect,
}: {
  theme: PluginScreenProps["theme"];
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            disabled={disabled}
            onPress={() => onSelect(opt.value)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: selected ? c.accent : c.border,
              backgroundColor: selected
                ? c.accent
                : pressed
                  ? c.surface2
                  : c.surface1,
              opacity: disabled ? 0.55 : 1,
            })}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: selected ? "700" : "500",
                color: selected ? c.accentForeground : c.foreground,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
