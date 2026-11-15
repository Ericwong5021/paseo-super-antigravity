import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  ProviderConnection,
  ProviderEvent,
  ProviderSessionConfig,
} from "@getpaseo/plugin/server/provider";
import type { AgyAcpClientConfig, AgyAcpClientOptions } from "./client";

const native = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("./client", () => ({
  AgyAcpClient: class extends EventEmitter {
    running = true;
    sessionId: string | null = null;
    stderrTail = [];
    close = vi.fn(async () => {
      this.running = false;
    });
    setMode = vi.fn(async (_mode: string) => {});
    setConfigOption = vi.fn(async () => {});
    pendingPrompt = Promise.withResolvers<{ stopReason: string }>();
    constructor(readonly config: AgyAcpClientConfig, readonly options: AgyAcpClientOptions) {
      super();
      native.clients.push(this);
    }
    async initialize() {
      return {};
    }
    async newSession() {
      this.sessionId = "96a9e574-d43e-42a5-9820-8e4f1806c761";
      return { sessionId: this.sessionId };
    }
    async resumeSession(input: { sessionId: string }) {
      this.sessionId = input.sessionId;
      return {};
    }
    prompt() {
      return this.pendingPrompt.promise;
    }
    cancel() {}
  },
}));

import { AcpSession, checkTranscriptUpdates, createAcpConnection } from "./session";
import { ACP_CAPABILITIES } from "../provider";

const connections: ProviderConnection[] = [];
let taskRoot: string | undefined;
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  native.clients.length = 0;
  if (taskRoot) { await rm(taskRoot, { recursive: true, force: true }); taskRoot = undefined; }
  vi.unstubAllEnvs();
});

function setup(policy = "agy", persist = false, mode?: string) {
  const connection = createAcpConnection(ACP_CAPABILITIES);
  connections.push(connection);
  const config: ProviderSessionConfig = {
    cwd: "/tmp",
    env: {},
    mcpServers: {},
    settings: { approvalPolicy: policy },
    mode,
    persist,
  };
  const session = new AcpSession("test", config, null, "default");
  connection.state!.sessions.set("test", session);
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  const configure = (changes: any) =>
    connection.send({
      type: "session.configure",
      requestId: "configure",
      sessionId: "test",
      changes,
    });
  const prompt = () =>
    connection.send({
      type: "session.prompt",
      sessionId: "test",
      prompt: {
        clientMessageId: "message",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "hello" }] },
      },
    });
  return { connection, session, events, configure, prompt };
}

describe("live Antigravity approvals", () => {
  test("Full access resolves waiting approvals immediately and can be revoked in the same turn", async () => {
    // Opened in `default` on purpose: this is the switch from a gated mode to Full access and back.
    const { configure, prompt, events, session } = setup("agy", false, "default");
    await prompt();
    await vi.waitFor(() => expect(native.clients[0]?.sessionId).toBeTruthy());
    const client = native.clients[0];
    const request = (id: string) => ({
      sessionId: client.sessionId,
      toolCall: { toolCallId: id, title: "Run shell command" },
      options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
    });
    const pending = client.options.onRequestPermission(request("waiting"));
    expect(session.pendingPermissions.size).toBe(1);
    await configure({ mode: "full-access" });
    await expect(pending).resolves.toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    expect(session.selection.mode).toBe("full-access");
    expect(session.settings.approvalPolicy).toBe("skip");
    expect(session.pendingPermissions.size).toBe(0);
    client.emit("sessionUpdate", { sessionId: client.sessionId,
      update: { sessionUpdate: "current_mode_update", currentModeId: "default" } });
    expect(session.selection.mode).toBe("full-access");
    const cards = events.filter((event) => event.type === "session.permission").length;
    await expect(client.options.onRequestPermission(request("automatic"))).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(events.filter((event) => event.type === "session.permission")).toHaveLength(cards);
    await configure({ mode: "default" });
    expect(session.settings.approvalPolicy).toBe("agy");
    const after = client.options.onRequestPermission(request("ask-again"));
    expect(session.pendingPermissions.size).toBe(1);
    await configure({ mode: "full-access" });
    await expect(after).resolves.toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    expect(client.close).not.toHaveBeenCalled();
  });

  test("a session opened in Full access automatically approves from its first request", async () => {
    const { prompt, session } = setup("agy", false, "full-access");
    await prompt();
    await vi.waitFor(() => expect(native.clients[0]?.sessionId).toBeTruthy());
    const client = native.clients[0];
    expect(client.config.skipPermissions).toBe(false);
    await expect(client.options.onRequestPermission({ sessionId: client.sessionId,
      toolCall: { toolCallId: "first", title: "Edit file" },
      options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }] })).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(session.pendingPermissions.size).toBe(0);
  });

  test("switches mode on the existing active session and acknowledges only after the CLI", async () => {
    const { session, configure, prompt, events } = setup();
    await prompt();
    await vi.waitFor(() => expect(native.clients[0]?.sessionId).toBeTruthy());
    const client = native.clients[0];
    const ack = Promise.withResolvers<void>();
    client.setMode.mockImplementation(() => ack.promise);
    const change = configure({ mode: "auto" });
    expect(events.filter((event) => event.type === "request.completed")).toHaveLength(0);
    ack.resolve();
    await change;
    expect(client.setMode).toHaveBeenCalledWith("auto");
    expect(session.selection.mode).toBe("auto");
    expect(client.close).not.toHaveBeenCalled();
    client.setMode.mockRejectedValueOnce(new Error("unsupported mode"));
    await expect(configure({ mode: "plan" })).rejects.toThrow("unsupported mode");
    expect(session.selection.mode).toBe("auto");
  });

  test("revokes skip policy during a turn and forwards the next permission request", async () => {
    const { configure, prompt, events } = setup("skip");
    await prompt();
    await vi.waitFor(() => expect(native.clients[0]?.sessionId).toBeTruthy());
    const client = native.clients[0];
    expect(client.config.skipPermissions).toBe(false);
    const permission = {
      sessionId: client.sessionId,
      toolCall: { toolCallId: "edit", title: "Edit file" },
      options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
    };
    await expect(client.options.onRequestPermission(permission)).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    await configure({ settings: { approvalPolicy: "agy" } });
    const pending = client.options.onRequestPermission(permission);
    expect(events.some((event) => event.type === "session.permission")).toBe(true);
    await configure({ settings: { approvalPolicy: "skip" } });
    await expect(pending).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(client.close).not.toHaveBeenCalled();
  });
});

test("persists the first user message and rewinds it through the provider contract", async () => {
  taskRoot = await mkdtemp(join(tmpdir(), "agy-first-turn-"));
  vi.stubEnv("PASEO_HOME", taskRoot);
  const { connection, session, prompt, events } = setup("agy", true);
  await prompt();
  await vi.waitFor(() => expect(native.clients[0]?.sessionId).toBeTruthy());
  await vi.waitFor(() => expect(session.transcript?.list()[0]?.type).toBe("user_message"));
  const user = session.transcript!.list()[0];
  expect(user.revertToken).toHaveProperty("checkpoint");
  await expect(connection.send({ type: "session.revert", requestId: "busy", sessionId: "test",
    scope: "conversation", token: user.revertToken! })).rejects.toThrow("finish");
  native.clients[0].pendingPrompt.resolve({ stopReason: "end_turn" });
  await vi.waitFor(() => expect(session.activeTurn).toBeNull());
  await connection.send({ type: "session.revert", requestId: "rewind", sessionId: "test",
    scope: "conversation", token: user.revertToken! });
  expect(session.conversationId).toBeNull();
  expect(session.transcript).toBeNull();
  expect(session.unpersisted).toEqual([]);
  expect(events).toContainEqual({ type: "request.completed", requestId: "rewind" });
  expect(events).toContainEqual({ type: "session.persistence", sessionId: "test",
    persistence: { version: 1, data: { conversationId: null, accountId: "default", transport: "acp" } } });
});

/** A conversation transcript agy writes: one JSON line per step, indices ascending. */
function transcriptText(entries: readonly Record<string, unknown>[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function setupTranscript(transcript: string) {
  const { session, events } = setup();
  session.conversationId = "conversation-1";
  session.readTranscriptFile = () => transcript;
  session.lastTurnEndStepIndex = 0;
  const poll = () => checkTranscriptUpdates(session, (event) => events.push(event));
  return { session, events, poll };
}

function turnEvents(events: readonly { type: string; state?: string }[]) {
  return events.filter((event) => event.type === "session.turn");
}

describe("a self-woken turn agy never finishes", () => {
  test("closes the mirrored turn once the transcript stops growing", async () => {
    // The wake agy injects when a background command ends, then a tool call — no final answer, so
    // nothing in the transcript can settle the turn.
    const { session, events, poll } = setupTranscript(
      transcriptText([
        { step_index: 1, type: "SYSTEM_MESSAGE", content: 'Task id "bg-1" finished with result:\nok' },
        { step_index: 2, type: "PLANNER_RESPONSE", content: "", tool_calls: [
          { name: "run_command", args: { CommandLine: "npm run dev" } } ] },
        { step_index: 3, type: "GENERIC", content: "dev server listening on :6007" },
      ]),
    );

    await poll();
    const mirror = session.mirroredTurn;
    expect(mirror).not.toBeNull();
    expect(events).toContainEqual({
      type: "timeline.item",
      sessionId: "test",
      item: { type: "notification", id: `info:${mirror!.turnId}`, level: "info",
        message: "Background command finished" },
    });
    expect(turnEvents(events)).toEqual([
      { type: "session.turn", sessionId: "test", turnId: mirror!.turnId, state: "started" },
    ]);

    // Still the same transcript: nothing new to mirror, so the idle settle is what has to end it.
    session.mirrorIdleMs = 0;
    await poll();

    expect(session.mirroredTurn).toBeNull();
    expect(turnEvents(events)).toEqual([
      { type: "session.turn", sessionId: "test", turnId: mirror!.turnId, state: "started" },
      { type: "session.turn", sessionId: "test", turnId: mirror!.turnId, state: "completed" },
    ]);
    expect(session.lastTurnEndStepIndex).toBe(3);
    expect(session.unflushedSelfWake).toEqual({ turnId: mirror!.turnId, finalText: "" });
  });

  test("leaves a wake that is parked on a background command open", async () => {
    // The wake starts another command and hands off to it: agy is still working, and it can wait up
    // to 30 minutes for the task. Closing the turn here would split one wake into two.
    const { session, events, poll } = setupTranscript(
      transcriptText([
        { step_index: 1, type: "SYSTEM_MESSAGE", content: 'Task id "bg-1" finished with result:\nok' },
        { step_index: 2, type: "PLANNER_RESPONSE", content: "", tool_calls: [
          { name: "run_command", args: { CommandLine: "sleep 600" } } ] },
        { step_index: 3, type: "GENERIC",
          content: "Tool is running as a background task with task id: bg-2" },
      ]),
    );

    await poll();
    expect(session.mirroredTurn).not.toBeNull();
    session.mirrorIdleMs = 0;
    await poll();

    expect(session.mirroredTurn).not.toBeNull();
    expect(turnEvents(events).map((event) => event.state)).toEqual(["started"]);
  });

  test("completes a wake that ends with a plain answer without waiting for the idle settle", async () => {
    const { session, events, poll } = setupTranscript(
      transcriptText([
        { step_index: 1, type: "SYSTEM_MESSAGE", content: 'Task id "bg-1" finished with result:\nok' },
        { step_index: 2, type: "PLANNER_RESPONSE", content: "The dev server is up on :6007." },
      ]),
    );

    await poll();

    expect(session.mirroredTurn).toBeNull();
    expect(turnEvents(events).map((event) => event.state)).toEqual(["started", "completed"]);
    expect(session.lastTurnEndStepIndex).toBe(2);
  });
});
