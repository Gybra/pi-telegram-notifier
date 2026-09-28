# pi-telegram-notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a paired private Telegram chat once per final Pi response with timestamp, full text and real provider quota/credit where available.

**Architecture:** A thin Pi TypeScript entry point delegates to small JavaScript modules for Telegram pairing/delivery and provider quota lookups; plain Node tests stub `fetch` and Pi event contexts. Pi's model registry resolves credentials, while the provider inventory determines which official balance endpoints are actually usable.

**Tech Stack:** Node >=22.19.0, Pi extension API, native `fetch`, `crypto`, `fs`, `node:test`; no runtime dependencies beyond Pi peer dependency.

**Spec:** `docs/superpowers/specs/2026-09-28-pi-telegram-notifier-design.md`

## Global Constraints

- Separate npm/Pi package in `Pi-Plugins/pi-telegram-notifier/`; manual release later, no remote push or npm publish.
- Bot token: `PI_TELEGRAM_BOT_TOKEN` from environment only; do not log/store it.
- Pairing command `/telegram-pair`: private `/start <code>` with one-time cryptographically random code valid for five minutes; save numeric chat ID under Pi agent directory with private file permissions.
- Notify only after `agent_settled` with completed text; timestamp UTC ISO 8601; Telegram plain text; split long Unicode safely.
- Use only officially documented, credential-accessible **remaining** allowance/credit endpoints; include OpenRouter; otherwise `Quota non disponibile`.
- Never report context %, rate limit, spend analytics, or per-key limit as remaining plan quota; failures must not abort Pi.
- Copy mandatory `Gybra/software-engineering-principles/AGENTS.md` principles to new repo's `AGENTS.md`; include MIT license and open-source documentation/CI.

## Review Focus

- A webhook/other `getUpdates` consumer returns HTTP 409: pairing reports the conflict and never binds a chat (Task 1 test).
- A late or wrong `/start` or a group chat cannot claim the pairing code (Task 1 test).
- A final answer containing astral Unicode exceeds Telegram's 4096-character limit: every code point arrives exactly once (Task 2 test).
- A settled run ending in error/abort or without completed assistant text cannot reuse the prior answer (Task 2 test, scoped to entries added since `agent_start`).
- Quota API returns malformed JSON, 401, or insufficient scopes: final text is still delivered with `Quota non disponibile` (Task 3 test).

---

### Task 1: Pairing and package entry

**Files:** Create `package.json`, `.gitignore`, `extensions/index.ts`, `src/telegram.js`, `test/telegram.test.js`.

**Interfaces:** `pairChat(token, code, fetchImpl = fetch, now = Date.now): Promise<number>` polls `getUpdates` until five minutes expire and returns the private numeric chat ID; `loadChatId(agentDir): number | undefined`, `saveChatId(agentDir, chatId): void` use a user-private file; `sendTelegram(token, chatId, text, fetchImpl = fetch): Promise<void>` posts plain text with bounded timeout, splitting as needed. Export these from `src/telegram.js`; `extensions/index.ts` registers `/telegram-pair` and calls them. Locate agent directory using `PI_CODING_AGENT_DIR` or `homedir()/.pi/agent`.

- [ ] **Step 1: Write failing tests** in `test/telegram.test.js`: matching private `/start <code>` returns chat ID; wrong/group/late/reused codes fail; 409 fails with actionable nonsecret message; saving/reloading uses numeric ID and mode 0600; long Unicode `sendTelegram` preserves full text in <=4096-character chunks, HTTP failures reject with redacted errors.
- [ ] **Step 2: Run** `npm test -- test/telegram.test.js`; expect failure for missing `src/telegram.js`.
- [ ] **Step 3: Implement** those exact exports using Bot API `getUpdates`/`sendMessage`, `randomBytes(16)` for pairing code in `/telegram-pair`, local private file, native fetch and AbortSignal timeouts. Validate Bot API `ok` and HTTP status, never include tokenized URL or response body in errors. Add the Pi package manifest and extension entry; never poll until the command runs.
- [ ] **Step 4: Run** `npm test -- test/telegram.test.js`; expect PASS. Commit `feat: add Telegram pairing and delivery`.

### Task 2: Final-response notification

**Files:** Modify `extensions/index.ts`; create `src/notification.js`, `test/notification.test.js`.

**Interfaces:** `finalResponse(branch, startLeafId): { text: string, provider: string, modelId: string } | undefined` reads only new entries after the leaf recorded at `agent_start`, rejecting tool-only/failed/aborted runs; `formatNotification(timestamp, response, quota): string` returns plain text. Entry point reads `ctx.sessionManager.getBranch()` on `agent_settled`, uses the stored chat ID, and delivers through Task 1 `sendTelegram`; Task 3 replaces the temporary `Quota non disponibile` value with lookup.

- [ ] **Step 1: Write failing tests** for exactly one logical notification on settlement after tool turns/retries; no previous answer on failure or empty run; ISO 8601 timestamp, provider and complete text included; Telegram failure reported to Pi UI without throwing or exposing secrets; JSON/print modes work without interactive UI.
- [ ] **Step 2: Run** `npm test -- test/notification.test.js`; expect failure for missing module.
- [ ] **Step 3: Implement** `finalResponse` and `formatNotification`, record `getLeafId()` at `agent_start`, and wire `agent_settled`; use the assistant message's provider/model (not a newer selection), skip unpaired sessions, no sends on intermediate `turn_end`. Until Task 3 use literal `Quota non disponibile`. Expose registration via a testable factory or test the Pi entry via Pi's loader if cheaper; do not add a framework.
- [ ] **Step 4: Run** `npm test -- test/notification.test.js`; expect PASS. Commit `feat: notify once after final response`.

### Task 3: Verified provider quota and release readiness

**Files:** Create `src/quota.js`, `test/quota.test.js`, `docs/providers.md`, `README.md`, `AGENTS.md`, `LICENSE`, `.github/workflows/test.yml`; modify `extensions/index.ts`, `package.json`.

**Interfaces:** `getQuota(model, modelRegistry, fetchImpl = fetch): Promise<string>` resolves the exact model's credential through `modelRegistry.getApiKeyAndHeaders(model)`, returns a labeled remaining unit/percentage only for verified official provider endpoints; otherwise returns `Quota non disponibile`. The registration from Task 2 calls `getQuota`.

- [ ] **Step 1: Inventory Pi's built-in provider IDs** from the installed Pi model catalog, check each provider's *official* documentation for remaining quota/credit endpoints usable with a Pi credential, record endpoint/auth/units and unavailable reasons in `docs/providers.md`. Include OpenRouter `GET /api/v1/credits`; do not count request-rate headers or spend history. This inventory is a reviewable prerequisite to choosing branches in `getQuota`.
- [ ] **Step 2: Write failing tests** in `test/quota.test.js` for the official response fixture of each applicable endpoint found in Step 1, including OpenRouter remaining credits; wrong/missing scope, missing credentials, malformed/nonfinite values, custom providers and rejected fetch return `Quota non disponibile` without leaking credentials. Assert the registered notifier still sends the text on a quota error.
- [ ] **Step 3: Run** `npm test -- test/quota.test.js`; expect failure for missing module.
- [ ] **Step 4: Implement** `getQuota`, supported provider cases only, native fetch with timeouts, and wire to Task 2 by resolving `modelRegistry.find(response.provider, response.modelId)` before lookup. Document precise coverage, environment configuration, pairing/re-pairing, privacy, limits and local/git installation in README; add the verbatim five principles plus project-specific rules to `AGENTS.md`, MIT license, package manifest `pi-package` keyword/entry/peer dependency, CI (`npm test` and `npm pack --dry-run`).
- [ ] **Step 5: Run** `npm test && npm pack --dry-run --json && pi -e . --help`; expect tests PASS, tarball lists entry/docs/license, Pi reports no extension load errors. Commit `feat: add verified quota lookups and open-source package docs`.

## Final verification

- [ ] Check `git diff --check`, `git status --short`, all tests, package contents, and no secrets/private paths in tracked files; record the exact provider coverage and any remaining gaps against the approved spec. Do not create a GitHub repo or publish.
