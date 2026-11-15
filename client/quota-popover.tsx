import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import {
  findWindow,
  selectFleetAccounts,
  summarizeAntigravity,
} from "../shared/quota-summary";
import type { SuperAccount, UsageWindowView } from "../shared/super";
import { clampPct, formatAge, formatCountdown, formatUntilShort } from "./format";
import {
  useMinuteTick,
  useRefreshSnapshot,
  useReleaseCooldown,
  useSuperSettingsState,
  useSuperSnapshot,
  useSwitchAccount,
} from "./hooks";
import { MaskToggle, MosaicAccount } from "./mosaic";

const MAX_POPOVER_ACCOUNTS = 6;

export function QuotaPopover({ theme, openScreen, close }: PluginPopoverProps) {
  const c = theme.colors;
  const now = useMinuteTick();
  const { data: snapshot, isLoading } = useSuperSnapshot({ pollMs: 60_000 });
  const { values, toggleMask } = useSuperSettingsState();
  const switchAccount = useSwitchAccount();
  const refresh = useRefreshSnapshot();
  const releaseCooldown = useReleaseCooldown();

  const masked = values.sidebar.maskAccounts;
  const accounts = snapshot?.accounts ?? [];
  const realHome = accounts.find(
    (account) => account.source === "agy" && account.id === "default",
  );
  // The real home gets its own card above, so keep it out of the list even when no Tools pool
  // exists (the fleet selector returns every account in that case).
  const fleet = selectFleetAccounts(accounts).filter(
    (account) => !(account.source === "agy" && account.id === "default"),
  );
  const visibleAccounts = fleet.slice(0, MAX_POPOVER_ACCOUNTS);
  const overflowCount = Math.max(0, fleet.length - visibleAccounts.length);

  const g5 = summarizeAntigravity(accounts, "5h", "gemini");
  const g7 = summarizeAntigravity(accounts, "7d", "gemini");
  const argon = summarizeAntigravity(accounts, "7d", "gemini 4 argon");

  const pointer = accounts.find(
    (account) =>
      account.source === "manager" &&
      account.id === snapshot?.manager.currentAgyAccountId,
  );
  const pointerMismatch = snapshot?.pointerMismatch === true;

  const openMain = () => {
    close();
    openScreen({ screenId: "main" });
  };

  return (
    <View style={{ width: 344, padding: 14, gap: 10 }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name="Sparkles" size={15} color={c.accent} />
          <Text style={{ fontSize: 14, fontWeight: "700", color: c.foreground }}>
            Antigravity 配额
          </Text>
        </View>
        {snapshot ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: snapshot.manager.running
                  ? c.statusSuccess
                  : c.foregroundMuted,
              }}
            />
            <Text style={{ fontSize: 11, fontWeight: "600", color: c.foregroundMuted }}>
              {snapshot.manager.running
                ? `Tools v${snapshot.manager.version ?? ""}`.trim()
                : "本地 CLI"}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Fleet Summary Card */}
      <View
        style={{
          padding: 10,
          borderRadius: 10,
          backgroundColor: c.surface1,
          borderWidth: 1,
          borderColor: c.border,
          gap: 6,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <SummaryStat
            label="Gemini 5h"
            value={g5.remaining !== null ? `${clampPct(g5.remaining)}%` : "—"}
            danger={g5.remaining !== null && g5.remaining < 20}
            theme={theme}
          />
          <SummaryStat
            label="Gemini 7d"
            value={g7.remaining !== null ? `${clampPct(g7.remaining)}%` : "—"}
            danger={g7.remaining !== null && g7.remaining < 20}
            theme={theme}
          />
          {argon.remaining !== null ? (
            <SummaryStat
              label="Argon 7d"
              value={`${clampPct(argon.remaining)}%`}
              danger={argon.remaining < 20}
              theme={theme}
            />
          ) : null}
          <SummaryStat label="可用" value={`${g5.included}/${g5.total}`} theme={theme} />
        </View>
        {g5.excludedLowWeekly > 0 || g5.cooling > 0 ? (
          <Text style={{ fontSize: 11, color: c.foregroundMuted }}>
            {[
              g5.excludedLowWeekly > 0
                ? `已剔除 ${g5.excludedLowWeekly} 个周配额 <5%`
                : null,
              g5.cooling > 0 ? `${g5.cooling} 个冷却中` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>

      {/* Real home: the account agy is signed in as, and what this machine actually spends */}
      {realHome ? (
        <PopoverRealHomeRow
          account={realHome}
          pointerLabel={pointer ? (pointer.email ?? pointer.label) : null}
          pointerMismatch={pointerMismatch}
          masked={masked}
          now={now}
          theme={theme}
        />
      ) : null}

      {/* Account List (no nested ScrollView in Popover) */}
      {isLoading && accounts.length === 0 ? (
        <Text style={{ fontSize: 12, color: c.foregroundMuted, paddingVertical: 8 }}>
          正在读取账号与配额…
        </Text>
      ) : visibleAccounts.length === 0 ? (
        <Text style={{ fontSize: 12, color: c.foregroundMuted, paddingVertical: 8 }}>
          未发现可用账号，点击下方「管理」添加或连接 Antigravity Tools。
        </Text>
      ) : (
        <View style={{ gap: 7 }}>
          {visibleAccounts.map((acc) => (
            <PopoverAccountRow
              key={`${acc.source}:${acc.id}`}
              account={acc}
              masked={masked}
              now={now}
              theme={theme}
              switching={switchAccount.isPending}
              releasing={releaseCooldown.isPending}
              onUse={() =>
                switchAccount.mutate({ source: acc.source, id: acc.id, label: acc.label })
              }
              onRelease={() => releaseCooldown.mutate({ source: acc.source, id: acc.id })}
            />
          ))}
          {overflowCount > 0 ? (
            <Pressable onPress={openMain} style={{ paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, color: c.accent, textAlign: "center" }}>
                还有 {overflowCount} 个账号，前往管理页查看 →
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Footer Actions */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: c.border,
          gap: 8,
        }}
      >
        <MaskToggle
          masked={masked}
          theme={theme}
          compact
          onToggle={() => void toggleMask()}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            onPress={() => refresh.mutate({ includeAgy: false })}
            disabled={refresh.isPending}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : c.surface0,
              opacity: refresh.isPending ? 0.55 : 1,
            })}
          >
            <Icon name="RefreshCw" size={12} color={c.foreground} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: c.foreground }}>
              {refresh.isPending ? "刷新中" : "刷新"}
            </Text>
          </Pressable>
          <Pressable
            onPress={openMain}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: c.accent,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: c.accentForeground }}>
              管理
            </Text>
            <Icon name="ChevronRight" size={12} color={c.accentForeground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SummaryStat({
  label,
  value,
  danger,
  theme,
}: {
  label: string;
  value: string;
  danger?: boolean;
  theme: PluginPopoverProps["theme"];
}) {
  const c = theme.colors;
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ fontSize: 10, color: c.foregroundMuted }}>{label}</Text>
      <Text
        style={{
          fontSize: 14,
          fontWeight: "700",
          color: danger ? c.statusDanger : c.foreground,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function PopoverRealHomeRow({
  account,
  pointerLabel,
  pointerMismatch,
  masked,
  now,
  theme,
}: {
  account: SuperAccount;
  pointerLabel: string | null;
  pointerMismatch: boolean;
  masked: boolean;
  now: number;
  theme: PluginPopoverProps["theme"];
}) {
  const c = theme.colors;
  const g5 = findWindow(account, "5h", "gemini");
  const g7 = findWindow(account, "7d", "gemini");
  const age = formatAge(account.readAt, now);
  const signedInAs = account.email ?? "尚未读取到登录记录";

  return (
    <View
      style={{
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: account.active ? c.accent : c.border,
        backgroundColor: c.surface1,
        gap: 5,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: c.foreground }}>
          本机 agy（真实 home）
        </Text>
        {account.active ? (
          <Badge label="正在使用" bg={c.accent} fg={c.accentForeground} />
        ) : null}
      </View>
      <MosaicAccount
        value={signedInAs}
        masked={masked}
        style={{ fontSize: 11, color: c.foregroundMuted }}
      />
      {g5 || g7 ? (
        <View style={{ gap: 4 }}>
          {g5 ? <MiniBar label="5h" win={g5} now={now} theme={theme} /> : null}
          {g7 ? <MiniBar label="7d" win={g7} now={now} theme={theme} /> : null}
        </View>
      ) : (
        <Text style={{ fontSize: 11, color: c.foregroundMuted }}>
          {account.healthDetail ?? "暂无配额数据"}
        </Text>
      )}
      {pointerMismatch && pointerLabel ? (
        <Text style={{ fontSize: 10, color: c.statusWarning }}>
          Tools 指针指向 {pointerLabel}，与实际登录不同
        </Text>
      ) : null}
      {age ? (
        <Text style={{ fontSize: 10, color: c.foregroundMuted }}>更新于 {age}</Text>
      ) : null}
    </View>
  );
}

function PopoverAccountRow({
  account,
  masked,
  now,
  theme,
  switching,
  releasing,
  onUse,
  onRelease,
}: {
  account: SuperAccount;
  masked: boolean;
  now: number;
  theme: PluginPopoverProps["theme"];
  switching: boolean;
  releasing: boolean;
  onUse: () => void;
  onRelease: () => void;
}) {
  const c = theme.colors;
  const g5 = findWindow(account, "5h", "gemini");
  const g7 = findWindow(account, "7d", "gemini");
  const coolShort = formatUntilShort(account.cooldownUntil, now);
  const age = formatAge(account.readAt, now);
  const canRelease = account.health === "cooling" || account.limitedModels.length > 0;

  return (
    <View
      style={{
        padding: 9,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: account.active ? c.accent : c.border,
        backgroundColor: c.surface1,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <MosaicAccount
            value={account.email ?? account.label}
            masked={masked}
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: c.foreground,
              flexShrink: 1,
            }}
          />
          {account.active ? (
            <Badge label="当前" bg={c.accent} fg={c.accentForeground} />
          ) : null}
          {account.health === "cooling" ? (
            <Badge
              label={coolShort ? `冷却 ${coolShort}` : "冷却中"}
              bg={c.surface2}
              fg={c.statusWarning}
            />
          ) : account.health === "banned" || account.health === "disabled" ? (
            <Badge label="不可用" bg={c.surface2} fg={c.statusDanger} />
          ) : account.health === "reauth" ? (
            <Badge label="需登录" bg={c.surface2} fg={c.statusWarning} />
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {canRelease ? (
            <SmallBtn
              label="解封"
              disabled={releasing}
              theme={theme}
              onPress={onRelease}
            />
          ) : null}
          {!account.active && account.launchable && !account.disabled ? (
            <SmallBtn label="使用" disabled={switching} theme={theme} onPress={onUse} />
          ) : null}
        </View>
      </View>

      {/* 5h & 7d mini bars */}
      {g5 || g7 ? (
        <View style={{ gap: 4 }}>
          {g5 ? <MiniBar label="5h" win={g5} now={now} theme={theme} /> : null}
          {g7 ? <MiniBar label="7d" win={g7} now={now} theme={theme} /> : null}
        </View>
      ) : (
        <Text style={{ fontSize: 11, color: c.foregroundMuted }}>
          {account.healthDetail ?? "暂无配额数据"}
        </Text>
      )}

      {age ? (
        <Text style={{ fontSize: 10, color: c.foregroundMuted }}>更新于 {age}</Text>
      ) : null}
    </View>
  );
}

function MiniBar({
  label,
  win,
  now,
  theme,
}: {
  label: string;
  win: UsageWindowView;
  now: number;
  theme: PluginPopoverProps["theme"];
}) {
  const c = theme.colors;
  const pct = clampPct(win.remainingPct);
  const reset = formatCountdown(win.resetsAt, now);
  const fill = pct < 20 ? c.statusDanger : c.accent;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ width: 20, fontSize: 10, color: c.foregroundMuted }}>{label}</Text>
      <View
        style={{
          flex: 1,
          height: 5,
          borderRadius: 999,
          backgroundColor: c.surface2,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: fill,
          }}
        />
      </View>
      <Text
        style={{
          width: 34,
          fontSize: 11,
          fontWeight: "600",
          color: pct < 20 ? c.statusDanger : c.foreground,
          textAlign: "right",
          fontVariant: ["tabular-nums"],
        }}
      >
        {pct}%
      </Text>
      {reset ? (
        <Text
          style={{
            width: 58,
            fontSize: 10,
            color: c.foregroundMuted,
            textAlign: "right",
          }}
        >
          {reset}
        </Text>
      ) : null}
    </View>
  );
}

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "700", color: fg }}>{label}</Text>
    </View>
  );
}

function SmallBtn({
  label,
  disabled,
  theme,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  theme: PluginPopoverProps["theme"];
  onPress: () => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.surface2 : c.surface1,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}
