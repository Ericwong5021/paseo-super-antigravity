import { describe, expect, test } from "vitest";
import { findWindow, selectFleetAccounts, summarizeAntigravity } from "./quota-summary";
import type { SuperAccount } from "./super";

function makeAccount(overrides: Partial<SuperAccount> = {}): SuperAccount {
  return {
    id: "acc-1",
    source: "manager",
    label: "acc1@example.com",
    email: "acc1@example.com",
    plan: "PRO",
    active: false,
    health: "ready",
    healthDetail: null,
    cooldownUntil: null,
    windows: [],
    priority: 1,
    launchable: true,
    disabled: false,
    readAt: null,
    limitedModels: [],
    ...overrides,
  };
}

describe("findWindow", () => {
  test("matches period and pool on both Manager and agy window formats", () => {
    const acc = makeAccount({
      windows: [
        {
          id: "gemini-5h",
          label: "Gemini 5h",
          pool: "gemini",
          period: "5h",
          usedPct: 20,
          remainingPct: 80,
          resetsAt: null,
        },
        {
          id: "gemini-7d",
          label: "Gemini Weekly",
          pool: "gemini",
          period: "7d",
          usedPct: 10,
          remainingPct: 90,
          resetsAt: null,
        },
        {
          id: "argon-7d",
          label: "Gemini 4 Argon Weekly",
          pool: "gemini 4 argon",
          period: "7d",
          usedPct: 30,
          remainingPct: 70,
          resetsAt: null,
        },
      ],
    });

    expect(findWindow(acc, "5h", "gemini")?.remainingPct).toBe(80);
    expect(findWindow(acc, "7d", "gemini")?.remainingPct).toBe(90);
    expect(findWindow(acc, "7d", "gemini 4 argon")?.remainingPct).toBe(70);
    expect(findWindow(acc, "5h", "claude")).toBeNull();
  });
});

describe("selectFleetAccounts", () => {
  test("deduplicates Default agy home when Manager accounts exist", () => {
    const accounts: SuperAccount[] = [
      makeAccount({ id: "m1", source: "manager" }),
      makeAccount({ id: "default", source: "agy", label: "Default" }),
      makeAccount({ id: "work", source: "agy", label: "Work" }),
    ];

    const selected = selectFleetAccounts(accounts);
    expect(selected.map((a) => `${a.source}:${a.id}`)).toEqual(["manager:m1", "agy:work"]);
  });

  test("keeps all agy accounts when no Manager accounts exist", () => {
    const accounts: SuperAccount[] = [
      makeAccount({ id: "default", source: "agy", label: "Default" }),
      makeAccount({ id: "work", source: "agy", label: "Work" }),
    ];

    const selected = selectFleetAccounts(accounts);
    expect(selected.map((a) => a.id)).toEqual(["default", "work"]);
  });
});

describe("summarizeAntigravity", () => {
  test("averages 5h remaining across ready accounts and excludes 5h when weekly < 5%", () => {
    const accounts: SuperAccount[] = [
      makeAccount({
        id: "healthy-a",
        windows: [
          { id: "g5", label: "Gemini 5h", pool: "gemini", period: "5h", usedPct: 20, remainingPct: 80, resetsAt: null },
          { id: "g7", label: "Gemini Weekly", pool: "gemini", period: "7d", usedPct: 40, remainingPct: 60, resetsAt: null },
        ],
      }),
      makeAccount({
        id: "healthy-b",
        windows: [
          { id: "g5", label: "Gemini 5h", pool: "gemini", period: "5h", usedPct: 40, remainingPct: 60, resetsAt: null },
          { id: "g7", label: "Gemini Weekly", pool: "gemini", period: "7d", usedPct: 50, remainingPct: 50, resetsAt: null },
        ],
      }),
      makeAccount({
        id: "weekly-depleted",
        windows: [
          // 5h reads 100%, but 7d is 3% (<5%) so 5h must be excluded from average
          { id: "g5", label: "Gemini 5h", pool: "gemini", period: "5h", usedPct: 0, remainingPct: 100, resetsAt: null },
          { id: "g7", label: "Gemini Weekly", pool: "gemini", period: "7d", usedPct: 97, remainingPct: 3, resetsAt: null },
        ],
      }),
      makeAccount({
        id: "disabled-acc",
        disabled: true,
        health: "disabled",
        windows: [
          { id: "g5", label: "Gemini 5h", pool: "gemini", period: "5h", usedPct: 0, remainingPct: 100, resetsAt: null },
          { id: "g7", label: "Gemini Weekly", pool: "gemini", period: "7d", usedPct: 0, remainingPct: 100, resetsAt: null },
        ],
      }),
    ];

    const s5 = summarizeAntigravity(accounts, "5h", "gemini");
    expect(s5.remaining).toBe(70);
    expect(s5.included).toBe(2);
    expect(s5.total).toBe(4);
    expect(s5.excludedLowWeekly).toBe(1);
    expect(s5.unavailable).toBe(1);

    const s7 = summarizeAntigravity(accounts, "7d", "gemini");
    expect(s7.remaining).toBeCloseTo((60 + 50 + 3) / 3, 5);
    expect(s7.included).toBe(3);
  });

  test("counts cooling and missing weekly windows accurately", () => {
    const accounts: SuperAccount[] = [
      makeAccount({
        id: "no-weekly",
        health: "cooling",
        windows: [
          { id: "g5", label: "Gemini 5h", pool: "gemini", period: "5h", usedPct: 50, remainingPct: 50, resetsAt: null },
        ],
      }),
    ];

    const summary = summarizeAntigravity(accounts, "5h", "gemini");
    expect(summary.remaining).toBe(50);
    expect(summary.unknownWeekly).toBe(1);
    expect(summary.cooling).toBe(1);
  });
});
