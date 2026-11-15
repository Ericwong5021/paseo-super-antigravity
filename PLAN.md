# Super Antigravity — architecture and build plan

A Paseo plugin that owns the Antigravity (`agy`) integration end to end: the provider, the account
fleet, the quota picture, the cooldown policy, and the bridge into Paseo's own orchestration.

This file is the plan of record. It describes what exists today, what is stubbed, and the order the
rest lands in.

## Shape

```
index.server.ts        wire only: core provider + account RPCs + super RPCs
index.client.tsx       wire only: two screens and two sidebar items
shared/super.ts        the RPC vocabulary (zod schemas, no logic)
shared/settings.ts     host settings: risk policy and task models
server/core/           forked agy provider (MIT) — see NOTICE.md
server/manager/        read-only view of Antigravity Tools' on-disk state
server/risk/           cooldown policy (pure) + recorded failures (disk)
server/handoff/        transcript → brief
server/subagents/      index of child sessions the fork announced
client/super-screen.tsx the Super screen
client/core/           forked account surfaces
```

Paseo only loads plugin modules from `client/`, `server/`, and `shared/`, which is why the fork sits
under `server/core` and `client/core` rather than a top-level `src/`.

Two rules hold the layering together:

1. **Decisions live in `server/`, never in `index.*` or in a screen.** `index.server.ts` reads
   settings, calls a module, returns its answer. A screen renders that answer and calls an RPC.
2. **`server/core` stays a fork, not a rewrite.** Every change to it is listed in `NOTICE.md`, so
   upstream updates stay mergeable.

## Feature map

| # | Requirement | Where | Status |
| --- | --- | --- | --- |
| a | Multi-account quota display | `server/manager/store.ts`, `server/core/server/quota.ts`, `client/super-screen.tsx` | **Done**: one row per account (agy + manager), every window with a bar, plan, resets |
| b | Native management | `server/core/client/accounts.tsx` (forked surface), `super.accounts.use` | **Done** for agy accounts (add/sign-in/remove/switch); manager accounts are read-only here |
| c | Risk control and cooldown | `server/risk/engine.ts`, `server/risk/store.ts` | **Engine + policy done and tested**; runtime recording is wired but nothing calls it yet (see phase 2) |
| d | Subagents as Paseo tabs | `server/subagents/registry.ts`, fork emit hooks | **Index done** (children recorded, listed on screen); child sessions stay read-only because agy owns them |
| e | Task handoff | `server/handoff/brief.ts`, `super.handoff.prepare` | **Done**: builds a brief from the stored transcript, plus the model the successor should start on |
| f | Task model config | `shared/settings.ts`, Super screen → Task models | **Done**: per-role model + tier, fed by the account's live catalog |
| g | Which account is actually in use | `server/core/signin-identity.ts`, `shared/account-truth.ts`, `server/manager/verify-switch.ts` | **Done**: the CLI's own `applyAuthResult` line decides, not the Tools pointer. The popover shows the real home's figures, the pool row carrying that email takes 「当前」, a pointer that disagrees is flagged, and a Tools switch is verified by one `/usage` probe. Antigravity Tools' `current_agy_account_id` only answers while no launch has reported a sign-in |

## Phase 2 — the parts deliberately left out

1. **Per-session account routing.** Today the fork launches whatever account is active globally
   (`readAccounts().active`). For cooldowns to matter, a session must be able to pick its own
   account: add an `account` session setting, resolve it in `createProvider`, and let the risk
   engine propose the default when it is unset.
2. **Record failures from real turns.** The store has `recordFailure`/`clearRecord`; the provider
   needs to call them on a 429/403 tool error and on a successful turn. That is the only missing
   link between the engine and reality, and it is a two-call change in the fork's error paths.
3. **Import manager accounts into Paseo.** `agy`'s token carries the email; match it against the
   manager's records and create a shadow home per matched account. Then `launchable` becomes true
   for manager rows and `super.accounts.use` can switch them.
4. **Handoff that creates the successor.** The brief exists; the next step is a button that opens a
   new agent with `{ cwd, model, thinking }` from the task-model policy and the brief as the first
   message.
5. **Device/risk handling beyond cooldowns.** The manager rotates device profiles; this plugin
   currently does not. Any port of that logic must respect the license boundary in `NOTICE.md`.

## Open questions

These change the design, so they are worth answering before phase 2:

- **Account identity.** Is one `agy` shadow home per Google account acceptable, or should accounts
  be keyed by the manager's record ids so both tools agree on the set?
- **Cooldown trigger.** Should a cooldown come only from explicit 429/403 evidence, or also from a
  predicted "this will run out mid-task" check against the remaining window?
- **Auto-rotate authority.** Rotating mid-task is visible to the user and can be surprising. Should
  rotation only ever happen *between* agents, or also when a running agent stalls?
- **Handoff target.** Hand off to the same provider on another account, or to whatever model the
  task-role policy names (possibly another provider entirely)?

## Development

```bash
npm install          # dev types only; Paseo supplies the SDK at runtime
npm run typecheck
npm test             # risk engine tests
paseo plugin add /Volumes/Workspace/project/Paseo/plugins/super-antigravity
paseo plugin logs super-antigravity
```

The plugin keeps its own state under `$PASEO_HOME/plugin-data/antigravity-super/`, so it can run
side by side with `lefos13/antigravity-cli` and with Paseo's built-in `antigravity` provider.
