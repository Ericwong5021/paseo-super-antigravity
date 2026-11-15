import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { buildAgyArgs } from "./agy";
import { AgyAcpClient } from "./acp/client";
import { JsonRpcConnection } from "./acp/rpc";
import { buildOneShotAgyArgs } from "./acp/session";
import { MODES, DEFAULT_MODE_ID } from "./catalog";
import { permissionConfigChanges } from "./permission-mode";

test("advertises Full access as the unattended mode alongside the existing default", () => {
  expect(DEFAULT_MODE_ID).toBe("default");
  expect(MODES.find((mode) => mode.id === "full-access")).toMatchObject({
    label: "Full access", icon: "ShieldOff", colorTier: "dangerous", isUnattended: true,
  });
  expect(MODES.filter((mode) => mode.isUnattended).map((mode) => mode.id)).toEqual(["full-access"]);
});

test("launches legacy and structured turns with the skip flag and no unsupported CLI mode", () => {
  const args = [
    buildAgyArgs({ cwd: "/tmp", mode: "full-access", skipPermissions: false }),
    buildOneShotAgyArgs({ promptText: "hello", conversationId: "conversation", schemaPath: "/tmp/schema.json",
      mode: "full-access", accountId: "default", skipPermissions: false }),
  ];
  for (const argv of args) {
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).not.toContain("--mode");
    expect(argv).not.toContain("full-access");
  }
  expect(buildAgyArgs({ cwd: "/tmp", mode: "auto", skipPermissions: false })).toContain("--mode");
  expect(buildAgyArgs({ cwd: "/tmp", mode: "default", skipPermissions: false })).not.toContain("--dangerously-skip-permissions");
});

test("maps Full access to a valid native ACP mode over the actual RPC transport", async () => {
  const input = new PassThrough(), output = new PassThrough();
  const server = new JsonRpcConnection(output, input);
  const modes: unknown[] = [];
  server.onRequest("session/new", () => ({ sessionId: "rpc-test" }));
  server.onRequest("session/set_mode", (params) => { modes.push(params); return {}; });
  server.onRequest("session/close", () => ({}));
  const client = new AgyAcpClient({ cwd: "/tmp" }, { transport: { input, output } });
  try {
    await client.newSession({ cwd: "/tmp" });
    await client.setMode("full-access");
    await client.setMode("auto");
    expect(modes).toEqual([{ sessionId: "rpc-test", modeId: "default" }, { sessionId: "rpc-test", modeId: "auto" }]);
  } finally { await client.close(); server.close(); }
});

test("keeps the old Tool approval setting and explicit mode changes synchronized", () => {
  expect(permissionConfigChanges({ settings: { approvalPolicy: "skip", shareMcp: true } }, "auto"))
    .toEqual({ mode: "full-access", settings: { approvalPolicy: "skip", shareMcp: true } });
  expect(permissionConfigChanges({ settings: { approvalPolicy: "agy" } }, "full-access"))
    .toEqual({ mode: "default", settings: { approvalPolicy: "agy" } });
  for (const mode of [null, "default", "accept-edits", "auto", "plan"]) {
    expect(permissionConfigChanges({ mode }, "full-access").settings?.approvalPolicy).toBe("agy");
  }
});
