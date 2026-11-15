import type { ProviderConfigChanges } from "@getpaseo/plugin/server/provider";

export const FULL_ACCESS_MODE_ID = "full-access";

/** Full access is a Paseo approval mode; agy itself only knows its native execution modes. */
export function nativeModeId(mode: string): string {
  return mode === FULL_ACCESS_MODE_ID ? "default" : mode;
}

/** Keep the mode menu and the existing Tool approval setting in sync. An explicit mode wins. */
export function permissionConfigChanges(
  changes: ProviderConfigChanges,
  currentMode: string | undefined,
): ProviderConfigChanges {
  if (changes.mode !== undefined) {
    return {
      ...changes,
      settings: {
        ...changes.settings,
        approvalPolicy: changes.mode === FULL_ACCESS_MODE_ID ? "skip" : "agy",
      },
    };
  }
  if (changes.settings?.approvalPolicy === "skip") {
    return { ...changes, mode: FULL_ACCESS_MODE_ID };
  }
  if (changes.settings?.approvalPolicy === "agy" && currentMode === FULL_ACCESS_MODE_ID) {
    return { ...changes, mode: "default" };
  }
  return changes;
}
