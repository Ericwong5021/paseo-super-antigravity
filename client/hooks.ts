import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { superSettings, type SuperSettings } from "../shared/settings";
import {
  refreshManagerRpc,
  releaseCooldownRpc,
  snapshotRpc,
  switchAccountRpc,
  type AccountSource,
  type SuperSnapshot,
} from "../shared/super";

export const SUPER_SNAPSHOT_KEY = ["super-antigravity", "snapshot"] as const;
export const AGY_ACCOUNTS_KEY = ["antigravity-accounts"] as const;

export function useSuperSettingsState() {
  const settings = useSettings(superSettings);
  const values: SuperSettings =
    settings.status === "ready" ? settings.values : superSettings.schema.parse({});

  const savePartial = useCallback(
    async (updater: (current: SuperSettings) => SuperSettings): Promise<boolean> => {
      if (settings.status !== "ready") return false;
      const next = superSettings.schema.parse(updater(settings.values));
      return settings.save(next, settings.revision);
    },
    [settings],
  );

  const toggleMask = useCallback(async () => {
    await savePartial((curr) => ({
      ...curr,
      sidebar: {
        ...curr.sidebar,
        maskAccounts: !curr.sidebar.maskAccounts,
      },
    }));
  }, [savePartial]);

  return {
    settings,
    values,
    savePartial,
    toggleMask,
  };
}

export function useSuperSnapshot(options: { pollMs?: number } = {}) {
  const fetchSnapshot = useRpc(snapshotRpc);
  return useQuery({
    queryKey: SUPER_SNAPSHOT_KEY,
    queryFn: () => fetchSnapshot({ refresh: false }),
    staleTime: 60_000,
    refetchInterval: options.pollMs ?? 120_000,
  });
}

export function useSwitchAccount() {
  const switchRpc = useRpc(switchAccountRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { source: AccountSource; id: string; label?: string }) =>
      switchRpc({ source: input.source, id: input.id }),
    onSuccess: (res, vars) => {
      if (!res.ok) {
        toast.error(res.message ?? "切换账号失败");
        return;
      }
      // A successful switch can still miss: the Tools pointer moved but `agy` stayed signed in as
      // the previous account. Say so instead of claiming success.
      if (res.message) {
        toast.show(res.message, { variant: "warning" });
      } else {
        toast.show(`已切换至 ${vars.label ?? vars.id}`, { variant: "success" });
      }
      void queryClient.invalidateQueries({ queryKey: SUPER_SNAPSHOT_KEY });
      void queryClient.invalidateQueries({ queryKey: AGY_ACCOUNTS_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "切换账号失败");
    },
  });
}

export function useRefreshSnapshot() {
  const refreshManager = useRpc(refreshManagerRpc);
  const fetchSnapshot = useRpc(snapshotRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (options?: { includeAgy?: boolean }): Promise<SuperSnapshot> => {
      const snap = await refreshManager({});
      if (options?.includeAgy) {
        return fetchSnapshot({ refresh: true });
      }
      return snap;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SUPER_SNAPSHOT_KEY, data);
      toast.show("已刷新配额", { variant: "success" });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "刷新配额失败");
    },
  });
}

export function useReleaseCooldown() {
  const release = useRpc(releaseCooldownRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { source: AccountSource; id: string }) => release(input),
    onSuccess: () => {
      toast.show("已解除冷却保护", { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: SUPER_SNAPSHOT_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "解除失败");
    },
  });
}

/** Ticks once a minute while mounted so relative countdowns stay current without jittering layout. */
export function useMinuteTick(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
