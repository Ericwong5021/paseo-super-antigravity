# Notices and the license boundary

This plugin combines three things. Two are code, one is external service/data interop at runtime.

## 1. `server/core` + `client/core` + `shared/core` — fork of `paseo-plugin-antigravity-cli` (MIT)

- Upstream: <https://github.com/lefos13/paseo-plugin-antigravity-cli>, version `0.13.1`
- License: MIT, copied verbatim to [`LICENSE-UPSTREAM`](./LICENSE-UPSTREAM)
- Upstream README kept at [`UPSTREAM-README.md`](./UPSTREAM-README.md)

Changes made by this fork:

| File | Change |
| --- | --- |
| `server/core/provider.ts` | `PROVIDER_ID` is `antigravity-super`; label is "Antigravity (Super)"; calls `recordChild` at child-session emit points; hooks runtime risk tracking (`recordTurnSuccess`, `recordTurnFailure`) and new-session auto-rotation (`resolveAccountForNewSession`); advertises ACP conversation rewind and clarifies live approval policy |
| `server/core/acp/session.ts` | Hooks runtime risk tracking and new-session auto-rotation; applies modes via ACP and approval policy through the live permission handler; records and restores per-turn checkpoints for conversation rewind; preserves the first user message for replay; settles a mirrored self-wake turn that ends without a final answer (idle timeout, CLI exit) so the conversation cannot stay busy forever |
| `server/core/catalog.ts`, `icon.svg` | Distinct permission-mode icons and semantic colors, orange Auto; Auto retains confirmation for irreversible actions; single-colour `currentColor` provider icon (shared with the sidebar and command centre through `shared/gemini-icon.ts`) instead of the grayscale trace; new sessions default to Full access at the high tier |
| `server/core/permission-mode.ts`, `server/core/agy.ts`, `server/core/acp/client.ts` | Full access unattended mode, synchronization with Tool approval, mapping to native ACP default mode plus live auto-approval, and skip-permissions launch flags for legacy/structured turns |
| `server/core/rewind.ts`, `server/core/transcript.ts` | Native SQLite/log checkpoints and withdrawn-state backups; replacement of persisted timeline snapshots during conversation rewind |
| `server/core/plugindata.ts` | Owns `plugin-data/antigravity-super` instead of `plugin-data/antigravity-cli` |
| `server/core/usage.ts` | Usage source id is `antigravity-super` |
| `server/core/subagents.ts` | `fileURLToPath(url.href)` — the fork typechecks server and client together, where the two `URL` types disagree |
| everything else in `core/` | unchanged |

## 2. Antigravity Tools / `Antigravity-Manager` — CC BY-NC-SA 4.0, **not vendored**

<https://github.com/lbjlaq/Antigravity-Manager> (Rust + Tauri) is the desktop manager whose local state
and local HTTP API this plugin integrates with. Its license is **Attribution-NonCommercial-ShareAlike 4.0**,
which is not compatible with an MIT/Apache plugin release.

So this repository contains **none of its code**. `server/manager/store.ts` only reads `~/.antigravity_tools`
JSON state and calls the running local gateway HTTP endpoints (`127.0.0.1:8045` by default) from scratch
as pure external API/data-format interop.

## 3. Paseo plugin SDK

`@getpaseo/plugin` is supplied by Paseo at runtime (dev-only here), under Paseo's own license.
