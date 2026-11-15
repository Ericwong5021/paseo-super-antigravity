import { describe, expect, it } from "vitest";
import { REAL_HOME_ACCOUNT_ID, resolveLiveAgyOwner } from "./account-truth";

const eric = { id: "eric", email: "ericwong5021@gmail.com", isCurrent: false };
const jeniffer = {
  id: "jeniffer",
  email: "jenifferchristhopher694@gmail.com",
  isCurrent: true,
};
const wtp = { id: "wtp", email: "wtpadugdw@gmail.com", isCurrent: false };

describe("resolveLiveAgyOwner", () => {
  it("marks the account the CLI is signed in as, not the Tools pointer", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: "ericwong5021@gmail.com",
        agyActive: REAL_HOME_ACCOUNT_ID,
        managerAccounts: [eric, jeniffer, wtp],
      }),
    ).toEqual({ ownerId: "eric", pointerMismatch: true });
  });

  it("matches the signed-in email case-insensitively", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: "  EricWong5021@Gmail.com ",
        agyActive: REAL_HOME_ACCOUNT_ID,
        managerAccounts: [eric, jeniffer],
      }),
    ).toEqual({ ownerId: "eric", pointerMismatch: true });
  });

  it("reports no mismatch when the pointer already names the signed-in account", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: "jenifferchristhopher694@gmail.com",
        agyActive: REAL_HOME_ACCOUNT_ID,
        managerAccounts: [eric, jeniffer],
      }),
    ).toEqual({ ownerId: "jeniffer", pointerMismatch: false });
  });

  it("falls back to the pointer while no launch has reported a sign-in", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: null,
        agyActive: REAL_HOME_ACCOUNT_ID,
        managerAccounts: [eric, jeniffer],
      }),
    ).toEqual({ ownerId: "jeniffer", pointerMismatch: false });
  });

  it("names no owner when the signed-in account is outside the pool", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: "someone-else@gmail.com",
        agyActive: REAL_HOME_ACCOUNT_ID,
        managerAccounts: [eric, jeniffer],
      }),
    ).toEqual({ ownerId: null, pointerMismatch: true });
  });

  it("leaves shadow accounts to the plugin's own selection", () => {
    expect(
      resolveLiveAgyOwner({
        realEmail: "ericwong5021@gmail.com",
        agyActive: "work",
        managerAccounts: [eric, jeniffer],
      }),
    ).toEqual({ ownerId: null, pointerMismatch: false });
  });
});
