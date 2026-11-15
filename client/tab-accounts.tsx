import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, SettingsSection, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  accountsAdd,
  accountsList,
  accountsRemove,
  accountsSignIn,
} from "../shared/core/accounts";
import { findWindow, summarizeAntigravity } from "../shared/quota-summary";
import type { SuperAccount, SuperSnapshot, UsageWindowView } from "../shared/super";
import { AccountSettings } from "./core/account-settings";
import { AccountQuota } from "./core/quota";
import { clampPct, formatAge, formatCountdown, formatUntilShort } from "./format";
import {
  AGY_ACCOUNTS_KEY,
  SUPER_SNAPSHOT_KEY,
  useMinuteTick,
  useReleaseCooldown,
  useSwitchAccount,
} from "./hooks";
import { MosaicAccount } from "./mosaic";

interface SignInNotice {
  id: string;
  name: string;
  launched: boolean;
  host: string;
  command: string;
}

export function AccountsTab({
  theme,
  layout,
  snapshot,
  masked,
  isLoading,
}: {
  theme: PluginScreenProps["theme"];
  layout: PluginScreenProps["layout"];
  snapshot: SuperSnapshot | undefined;
  masked: boolean;
  isLoading: boolean;
}) {
  const c = theme.colors;
  const now = useMinuteTick();
  const toast = useToast();
  const queryClient = useQueryClient();
  const switchAccount = useSwitchAccount();
  const releaseCooldown = useReleaseCooldown();

  const fetchAgyAccounts = useRpc(accountsList);
  const addAccount = useRpc(accountsAdd);
  const removeAccount = useRpc(accountsRemove);
  const signIn = useRpc(accountsSignIn);

  const agyMetaQuery = useQuery({
    queryKey: AGY_ACCOUNTS_KEY,
    queryFn: () => fetchAgyAccounts({}),
    staleTime: 60_000,
  });

  const [expandedAgyId, setExpandedAgyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [notice, setNotice] = useState<SignInNotice | null>(null);
  const [showShadowSection, setShowShadowSection] = useState(false);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: SUPER_SNAPSHOT_KEY });
    void queryClient.invalidateQueries({ queryKey: AGY_ACCOUNTS_KEY });
  };

  const createMut = useMutation({
    mutationFn: (name: string) => addAccount({ name }),
    onSuccess: async (acc) => {
      setDraftName("");
      setExpandedAgyId(acc.id);
      setShowShadowSection(true);
      invalidateAll();
      try {
        const res = await signIn({ id: acc.id });
        setNotice({ id: acc.id, name: acc.name, ...res });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "启动登录失败");
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "添加账号失败"),
  });

  const signInMut = useMutation({
    mutationFn: (acc: { id: string; label: string }) =>
      signIn({ id: acc.id }).then((res) => ({ acc, res })),
    onSuccess: ({ acc, res }) => {
      setNotice({ id: acc.id, name: acc.label, ...res });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "启动登录失败"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeAccount({ id }),
    onSuccess: (_res, id) => {
      setConfirmRemoveId(null);
      setNotice((curr) => (curr?.id === id ? null : curr));
      queryClient.removeQueries({ queryKey: ["agy-quota", id] });
      toast.show("已移除本地隔离账号", { variant: "success" });
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "移除失败"),
  });

  const accounts = snapshot?.accounts ?? [];
  const managerAccounts = accounts.filter((a) => a.source === "manager");
  const agyAccounts = accounts.filter((a) => a.source === "agy");
  const customShadowCount = agyAccounts.filter((a) => a.id !== "default").length;
  const multiAccount = agyMetaQuery.data?.multiAccount ?? true;
  // The Tools pointer can name an account the CLI is not signed in as; show the truth next to it.
  const realAgyEmail = snapshot?.realAgyEmail ?? null;
  const pointerMismatch = snapshot?.pointerMismatch === true;
  const pointerAccount = accounts.find(
    (a) => a.source === "manager" && a.id === snapshot?.manager.currentAgyAccountId,
  );

  const g5 = summarizeAntigravity(accounts, "5h", "gemini");
  const g7 = summarizeAntigravity(accounts, "7d", "gemini");
  const argon = summarizeAntigravity(accounts, "7d", "gemini 4 argon");

  return (
    <View style={{ gap: layout.compact ? 14 : 18 }}>
      {/* Fleet Summary */}
      <View
        style={{
          padding: layout.compact ? 12 : 14,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          gap: 10,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "700", color: c.foreground }}>
            整体剩余额度
          </Text>
          <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
            可用 {g5.included}/{g5.total}
            {g5.cooling > 0 ? ` · ${g5.cooling} 个冷却中` : ""}
          </Text>
        </View>

        <View
          style={{
            flexDirection: layout.compact ? "column" : "row",
            gap: 10,
          }}
        >
          <SummaryBox title="Gemini 5h" pct={g5.remaining} theme={theme} />
          <SummaryBox title="Gemini 7d" pct={g7.remaining} theme={theme} />
          {argon.remaining !== null ? (
            <SummaryBox title="Gemini 4 Argon 7d" pct={argon.remaining} theme={theme} />
          ) : null}
        </View>

        {g5.excludedLowWeekly > 0 ? (
          <Text style={{ fontSize: 11, color: c.foregroundMuted }}>
            注：已自动排除 {g5.excludedLowWeekly} 个周配额低于 5% 的账号的 5h
            读数，避免虚高。
          </Text>
        ) : null}

        {snapshot?.suggested ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: c.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <Icon name="Sparkles" size={13} color={c.accent} />
              <Text style={{ fontSize: 12, color: c.foregroundMuted }}>推荐首选：</Text>
              <MosaicAccount
                value={snapshot.suggested.label}
                masked={masked}
                style={{ fontSize: 12, fontWeight: "600", color: c.foreground }}
              />
            </View>
          </View>
        ) : null}
      </View>

      {/* Antigravity Tools Manager Accounts */}
      {managerAccounts.length > 0 ? (
        <SettingsSection
          title="Antigravity Tools 账号池"
          info={
            <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
              {snapshot?.manager.running
                ? `已连接本地网关 :${snapshot.manager.port}`
                : "仅读取本地磁盘快照（网关未启动时无法切换）"}
            </Text>
          }
        >
          <View style={{ gap: 10 }}>
            <Text
              style={{
                fontSize: 11,
                color: pointerMismatch ? c.statusWarning : c.foregroundMuted,
              }}
            >
              {realAgyEmail
                ? `agy 实际登录：${realAgyEmail}`
                : "agy 尚未产生登录记录，暂按 Tools 指针显示"}
              {pointerMismatch
                ? ` · Tools 指针为 ${pointerAccount?.email ?? pointerAccount?.label ?? "其它账号"}，点目标账号的「使用」可同步`
                : ""}
            </Text>
            {managerAccounts.map((acc) => (
              <AccountCard
                key={`manager:${acc.id}`}
                account={acc}
                masked={masked}
                now={now}
                theme={theme}
                switching={switchAccount.isPending}
                releasing={releaseCooldown.isPending}
                onUse={() =>
                  switchAccount.mutate({
                    source: "manager",
                    id: acc.id,
                    label: acc.label,
                  })
                }
                onRelease={() =>
                  releaseCooldown.mutate({ source: "manager", id: acc.id })
                }
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}

      {/* Local agy accounts (Default + Shadow homes) */}
      <SettingsSection
        title={managerAccounts.length > 0 ? "本地 CLI 与隔离账号" : "本地 CLI 账号"}
        trailing={
          managerAccounts.length > 0 ? (
            <Pressable
              onPress={() => setShowShadowSection((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
                backgroundColor: pressed ? c.surface2 : "transparent",
              })}
            >
              <Text style={{ fontSize: 12, color: c.accent, fontWeight: "600" }}>
                {showShadowSection ? "收起" : `展开 (${agyAccounts.length})`}
              </Text>
            </Pressable>
          ) : undefined
        }
      >
        {managerAccounts.length === 0 || showShadowSection || customShadowCount > 0 ? (
          <View style={{ gap: 10 }}>
            {isLoading && accounts.length === 0 ? (
              <Text style={{ fontSize: 13, color: c.foregroundMuted }}>
                正在加载账号…
              </Text>
            ) : (
              agyAccounts.map((acc) => {
                const isDefault = acc.id === "default";
                const expanded = expandedAgyId === acc.id;
                const confirming = confirmRemoveId === acc.id;
                return (
                  <View key={`agy:${acc.id}`} style={{ gap: 8 }}>
                    <AccountCard
                      account={acc}
                      masked={masked}
                      now={now}
                      theme={theme}
                      switching={switchAccount.isPending}
                      releasing={releaseCooldown.isPending}
                      onUse={() =>
                        switchAccount.mutate({
                          source: "agy",
                          id: acc.id,
                          label: acc.label,
                        })
                      }
                      onRelease={() =>
                        releaseCooldown.mutate({ source: "agy", id: acc.id })
                      }
                      extraActions={
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                        >
                          <PillButton
                            label={expanded ? "收起详情" : "详情"}
                            theme={theme}
                            onPress={() => setExpandedAgyId(expanded ? null : acc.id)}
                          />
                          <PillButton
                            label="登录"
                            theme={theme}
                            disabled={signInMut.isPending}
                            onPress={() =>
                              signInMut.mutate({ id: acc.id, label: acc.label })
                            }
                          />
                          {!isDefault ? (
                            confirming ? (
                              <>
                                <PillButton
                                  label="确认移除"
                                  danger
                                  theme={theme}
                                  disabled={removeMut.isPending}
                                  onPress={() => removeMut.mutate(acc.id)}
                                />
                                <PillButton
                                  label="取消"
                                  theme={theme}
                                  onPress={() => setConfirmRemoveId(null)}
                                />
                              </>
                            ) : (
                              <PillButton
                                label="移除"
                                danger
                                theme={theme}
                                onPress={() => setConfirmRemoveId(acc.id)}
                              />
                            )
                          ) : null}
                        </View>
                      }
                    />
                    {expanded ? (
                      <View
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: c.border,
                          backgroundColor: c.surface0,
                          gap: 12,
                        }}
                      >
                        <AccountQuota
                          accountId={acc.id}
                          accountName={acc.label}
                          theme={theme}
                          layout={layout}
                        />
                        <AccountSettings
                          accountId={acc.id}
                          accountName={acc.label}
                          theme={theme}
                          layout={layout}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}

            {notice ? (
              <View
                style={{
                  padding: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.accent,
                  backgroundColor: c.surface1,
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: c.foreground }}>
                  {notice.launched
                    ? `已在宿主机 ${notice.host} 发起「${notice.name}」登录流程`
                    : `请手动完成「${notice.name}」登录`}
                </Text>
                <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
                  若浏览器未弹出或需终端手动登录，可复制以下命令在终端执行：
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text
                    selectable
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: c.foreground,
                      padding: 8,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface0,
                      fontFamily: layout.platform === "ios" ? "Courier" : "monospace",
                    }}
                  >
                    {notice.command}
                  </Text>
                  <PillButton
                    label="复制"
                    theme={theme}
                    onPress={() => {
                      void copyText(notice.command).then(() =>
                        toast.show("已复制登录命令", { variant: "success" }),
                      );
                    }}
                  />
                </View>
              </View>
            ) : null}

            {multiAccount ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface1,
                }}
              >
                <TextInput
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="新建本地隔离账号名称（例如 Work）"
                  placeholderTextColor={c.foregroundMuted}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: c.foreground,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.surface0,
                  }}
                />
                <Pressable
                  disabled={!draftName.trim() || createMut.isPending}
                  onPress={() => createMut.mutate(draftName.trim())}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 8,
                    backgroundColor: c.accent,
                    opacity:
                      !draftName.trim() || createMut.isPending ? 0.5 : pressed ? 0.82 : 1,
                  })}
                >
                  <Text
                    style={{ fontSize: 12, fontWeight: "700", color: c.accentForeground }}
                  >
                    {createMut.isPending ? "创建中…" : "+ 添加"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
            当前通过 Antigravity Tools 联动默认工作目录；点击右上角「展开」可查看原生 CLI
            配额或新增独立隔离账号。
          </Text>
        )}
      </SettingsSection>
    </View>
  );
}

function SummaryBox({
  title,
  pct,
  theme,
}: {
  title: string;
  pct: number | null;
  theme: PluginScreenProps["theme"];
}) {
  const c = theme.colors;
  const clamped = pct === null ? 0 : clampPct(pct);
  const danger = pct !== null && clamped < 20;

  return (
    <View
      style={{
        flex: 1,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface0,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 11, color: c.foregroundMuted }}>{title}</Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: danger ? c.statusDanger : c.foreground,
            fontVariant: ["tabular-nums"],
          }}
        >
          {pct === null ? "—" : `${clamped}%`}
        </Text>
      </View>
      <View
        style={{
          height: 5,
          borderRadius: 999,
          backgroundColor: c.surface2,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${pct === null ? 0 : clamped}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: danger ? c.statusDanger : c.accent,
          }}
        />
      </View>
    </View>
  );
}

function AccountCard({
  account,
  masked,
  now,
  theme,
  switching,
  releasing,
  onUse,
  onRelease,
  extraActions,
}: {
  account: SuperAccount;
  masked: boolean;
  now: number;
  theme: PluginScreenProps["theme"];
  switching: boolean;
  releasing: boolean;
  onUse: () => void;
  onRelease: () => void;
  extraActions?: React.ReactNode;
}) {
  const c = theme.colors;
  const g5 = findWindow(account, "5h", "gemini");
  const g7 = findWindow(account, "7d", "gemini");
  const claude5 = findWindow(account, "5h", "claude");
  const argon7 = findWindow(account, "7d", "gemini 4 argon");
  const windowsToShow = [g5, g7, claude5, argon7].filter(
    (w): w is UsageWindowView => w !== null,
  );
  const fallbackWindows =
    windowsToShow.length > 0 ? windowsToShow : account.windows.slice(0, 4);

  const coolShort = formatUntilShort(account.cooldownUntil, now);
  const age = formatAge(account.readAt, now);
  const canRelease = account.health === "cooling" || account.limitedModels.length > 0;

  return (
    <View
      style={{
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: account.active ? c.accent : c.border,
        backgroundColor: c.surface1,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            flex: 1,
            minWidth: 180,
          }}
        >
          <MosaicAccount
            value={account.email ?? account.label}
            masked={masked}
            style={{
              fontSize: 14,
              fontWeight: "700",
              color: c.foreground,
              flexShrink: 1,
            }}
          />
          {account.plan ? <Tag text={account.plan} theme={theme} /> : null}
          {account.active ? <Tag text="当前" accent theme={theme} /> : null}
          {account.health === "cooling" ? (
            <Tag text={coolShort ? `冷却 ${coolShort}` : "冷却中"} warn theme={theme} />
          ) : account.health === "banned" || account.health === "disabled" ? (
            <Tag text="不可用" danger theme={theme} />
          ) : account.health === "reauth" ? (
            <Tag text="需登录" warn theme={theme} />
          ) : null}
        </View>

        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        >
          {canRelease ? (
            <PillButton
              label="解除冷却"
              disabled={releasing}
              theme={theme}
              onPress={onRelease}
            />
          ) : null}
          {!account.active && account.launchable && !account.disabled ? (
            <PillButton
              label="设为当前"
              accent
              disabled={switching}
              theme={theme}
              onPress={onUse}
            />
          ) : null}
          {extraActions}
        </View>
      </View>

      {fallbackWindows.length > 0 ? (
        <View style={{ gap: 5 }}>
          {fallbackWindows.map((win) => (
            <WindowBar key={win.id} win={win} now={now} theme={theme} />
          ))}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
          {account.healthDetail ?? "暂无配额窗口数据"}
        </Text>
      )}

      {(account.healthDetail && account.health !== "ready") || age ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 11, color: c.foregroundMuted, flex: 1 }}>
            {account.health !== "ready" ? (account.healthDetail ?? "") : ""}
          </Text>
          {age ? (
            <Text style={{ fontSize: 11, color: c.foregroundMuted }}>更新于 {age}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function WindowBar({
  win,
  now,
  theme,
}: {
  win: UsageWindowView;
  now: number;
  theme: PluginScreenProps["theme"];
}) {
  const c = theme.colors;
  const pct = clampPct(win.remainingPct);
  const reset = formatCountdown(win.resetsAt, now);
  const fill = pct < 20 ? c.statusDanger : c.accent;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text
        numberOfLines={1}
        style={{ width: 112, fontSize: 11, color: c.foregroundMuted }}
      >
        {win.label}
      </Text>
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
          width: 36,
          fontSize: 11,
          fontWeight: "600",
          color: pct < 20 ? c.statusDanger : c.foreground,
          textAlign: "right",
          fontVariant: ["tabular-nums"],
        }}
      >
        {pct}%
      </Text>
      <Text
        style={{ width: 64, fontSize: 11, color: c.foregroundMuted, textAlign: "right" }}
      >
        {reset ?? "—"}
      </Text>
    </View>
  );
}

function Tag({
  text,
  accent,
  warn,
  danger,
  theme,
}: {
  text: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
  theme: PluginScreenProps["theme"];
}) {
  const c = theme.colors;
  const bg = accent ? c.accent : c.surface2;
  const fg = accent
    ? c.accentForeground
    : danger
      ? c.statusDanger
      : warn
        ? c.statusWarning
        : c.foregroundMuted;
  return (
    <View
      style={{
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "700", color: fg }}>{text}</Text>
    </View>
  );
}

function PillButton({
  label,
  accent,
  danger,
  disabled,
  theme,
  onPress,
}: {
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  theme: PluginScreenProps["theme"];
  onPress: () => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: accent ? c.accent : danger ? c.statusDanger : c.border,
        backgroundColor: accent ? c.accent : pressed ? c.surface2 : c.surface1,
        opacity: disabled ? 0.55 : pressed ? 0.82 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: accent ? c.accentForeground : danger ? c.statusDanger : c.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
