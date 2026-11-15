import { describe, expect, test } from "vitest";
import { assess, backoffMs, pickBest, type RiskPolicy, type RiskSignals } from "./engine";

const policy: RiskPolicy = {
  enabled: true,
  minRemainingPct: 5,
  baseCooldownMinutes: 15,
  maxCooldownMinutes: 360,
  failureThreshold: 2,
};

const now = Date.parse("2026-01-01T00:00:00Z");

function signals(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    disabled: false,
    forbidden: false,
    needsSignIn: false,
    windows: [],
    failures: 0,
    cooldownUntil: null,
    ...overrides,
  };
}

describe("assess", () => {
  test("the provider's own verdict outranks any quota reading", () => {
    const banned = assess(signals({ forbidden: true, forbiddenReason: "policy" }), policy, now);
    expect(banned.health).toBe("banned");
    expect(banned.detail).toBe("policy");

    const reauth = assess(signals({ needsSignIn: true }), policy, now);
    expect(reauth.health).toBe("reauth");

    const disabled = assess(signals({ disabled: true }), policy, now);
    expect(disabled.health).toBe("disabled");
  });

  test("a window at the floor benches the account until that window resets", () => {
    const reset = new Date(now + 3_600_000).toISOString();
    const assessment = assess(
      signals({ windows: [{ id: "5h", label: "5 hour", remainingPct: 4, resetsAt: reset }] }),
      policy,
      now,
    );
    expect(assessment.health).toBe("cooling");
    expect(assessment.cooldownUntil).toBe(reset);
  });

  test("a window above the floor keeps the account ready", () => {
    const assessment = assess(
      signals({ windows: [{ id: "5h", label: "5 hour", remainingPct: 40, resetsAt: null }] }),
      policy,
      now,
    );
    expect(assessment.health).toBe("ready");
    expect(assessment.score).toBe(40);
  });

  test("a recorded cooldown outranks the quota, because it is newer evidence", () => {
    const assessment = assess(
      signals({
        cooldownUntil: now + 60_000,
        failures: 2,
        windows: [{ id: "5h", label: "5 hour", remainingPct: 90, resetsAt: null }],
      }),
      policy,
      now,
    );
    expect(assessment.health).toBe("cooling");
    expect(assessment.cooldownUntil).toBe(new Date(now + 60_000).toISOString());
  });

  test("a finished cooldown does not bench forever", () => {
    const assessment = assess(
      signals({
        cooldownUntil: now - 60_000,
        failures: 2,
        windows: [{ id: "5h", label: "5 hour", remainingPct: 90, resetsAt: null }],
      }),
      policy,
      now,
    );
    expect(assessment.health).toBe("ready");
  });

  test("assessment can be turned off without overriding facts", () => {
    const off: RiskPolicy = { ...policy, enabled: false };
    const low = assess(
      signals({ windows: [{ id: "5h", label: "5 hour", remainingPct: 0, resetsAt: null }] }),
      off,
      now,
    );
    expect(low.health).toBe("ready");
    expect(assess(signals({ forbidden: true }), off, now).health).toBe("banned");
  });

  test("live limitedModels triggers cooling when policy is enabled", () => {
    const limited = assess(signals({ limitedModels: ["gemini-2.5-pro"] }), policy, now);
    expect(limited.health).toBe("cooling");
    expect(limited.detail).toContain("gemini-2.5-pro");
  });
});

describe("pickBest", () => {
  test("the healthiest ready account wins, then priority, then id", () => {
    const entries = [
      { id: "b", priority: 1, assessment: assess(signals({ windows: [{ id: "5h", label: "5h", remainingPct: 30, resetsAt: null }] }), policy, now) },
      { id: "a", priority: 9, assessment: assess(signals({ windows: [{ id: "5h", label: "5h", remainingPct: 30, resetsAt: null }] }), policy, now) },
      { id: "c", priority: 5, assessment: assess(signals({ windows: [{ id: "5h", label: "5h", remainingPct: 80, resetsAt: null }] }), policy, now) },
      { id: "d", priority: 99, assessment: assess(signals({ forbidden: true }), policy, now) },
    ];
    expect(pickBest(entries)).toBe("c");
  });

  test("no ready account means no suggestion", () => {
    const entries = [{ id: "a", priority: null, assessment: assess(signals({ disabled: true }), policy, now) }];
    expect(pickBest(entries)).toBeNull();
  });
});

describe("backoffMs", () => {
  test("doubles per failure and stops at the ceiling", () => {
    expect(backoffMs(1, policy)).toBe(15 * 60_000);
    expect(backoffMs(3, policy)).toBe(60 * 60_000);
    expect(backoffMs(10, policy)).toBe(360 * 60_000);
  });
});
