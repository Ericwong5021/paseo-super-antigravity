import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { GEMINI_ICON } from "../shared/gemini-icon";
import { useSuperSettingsState, useSuperSnapshot } from "./hooks";
import { QuotaPopover } from "./quota-popover";
import { SidebarIndicator } from "./sidebar-indicator";

export function SuperSidebarItem({
  theme,
  currentScreen,
  openScreen,
  openPopover,
}: PluginSidebarItemProps) {
  const { data: snapshot } = useSuperSnapshot();
  const { values } = useSuperSettingsState();

  return (
    <SidebarRow
      icon={GEMINI_ICON}
      label="Antigravity"
      active={currentScreen?.screenId === "main"}
      onPress={() => openScreen({ screenId: "main" })}
      trailing={
        <SidebarIndicator
          theme={theme}
          accounts={snapshot?.accounts ?? []}
          managerRunning={snapshot?.manager.running}
          sidebar={values.sidebar}
          onPress={() => openPopover(QuotaPopover)}
        />
      }
    />
  );
}
