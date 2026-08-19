# Robustness hardening — "it just works"

**Status:** Complete. M1 (P0.1–P0.8), M2 (P1.1–P1.4), M3 (P2.1–P2.4), M4 (P3.1–P3.3), M5 (P4, P5), M6 (tests).
**Goal:** A user (or agent) can run any `opera-browser-cli` command at any time, in any state, and either get a correct result or a single actionable sentence. No manual `stop`, no `lsof | xargs kill`, no reading `bridge.log` to find out why nothing happened.

---

## 1. Success criteria

The CLI is "done" when all of these hold:

| # | Scenario | Required behaviour | State |
|---|---|---|---|
| S1 | Fresh machine, never configured | First command auto-detects the browser, writes config, and works. No prompt required. | ✅ M2 |
| S2 | Package upgraded, old bridge still running | Next command detects version skew, restarts the bridge transparently. | ✅ M1 |
| S3 | Bridge crashed / was killed | Next command restarts it transparently. | ✅ M1 |
| S4 | Port 9225 taken by something else | Falls back to the next free port. No error. | ✅ M1 |
| S5 | Two commands race on a cold start | Exactly one bridge starts; both commands succeed. | ✅ M1 |
| S6 | Opera already running on the same profile | Connects to it (or uses a distinct profile) instead of failing to launch. | ✅ M3 |
| S7 | User closes the browser window mid-session | Next command relaunches and reports the lost page state, not a CDP stack trace. | ✅ M1 |
| S8 | PID file deleted / token stale | Token is re-read or the bridge restarted; never a bare `unauthorized`. | ✅ M1 |
| S9 | Not signed in / no subscription / consent pending | One-line message + a command that fixes it. | ✅ M4 |
| S10 | `opera-devtools-mcp` missing or broken | Named in the error, with the install command. | ✅ M1 |
| S11 | Anything fails anyway | `doctor` explains it, `doctor --fix` repairs it, exit code is machine-readable. | ✅ M5 |

**Non-goal:** hiding genuine user decisions (which browser, which profile). Those get a sane default and a way to change it — not a prompt on the hot path.

---

## 2. Current failure inventory

Everything below is a real gap in the code today, not a hypothetical.

### 2.1 Bridge lifecycle (`src/client.ts`, `src/bridge.ts`)

| ID | Location | Problem |
|---|---|---|
| F1 | `client.ts:265-274` | `ensureBridge` trusts a live PID from the PID file and **SIGTERMs it** if unhealthy. After a reboot the PID is recycled — we can signal an unrelated user process. No identity verification. |
| F2 | `bridge.ts:396-403` | `/health` returns `{status, server}` with **no version**. A bridge running pre-upgrade code looks healthy forever. This is the documented `BRIDGE_NOT_READY` / "different server" issue in `CLAUDE.md`. |
| F3 | `bridge.ts:633-637` | `server.listen()` has **no `error` handler**. `EADDRINUSE` (lost start race, or port grabbed between probe and listen) is an uncaught exception — the bridge dies with a stack trace in `bridge.log` and the client just times out after 30 s. |
| F4 | `client.ts:277-290` | Port conflict is a **hard error**. No fallback port, no port range. |
| F5 | `client.ts:312-330` | **No start lock.** Concurrent invocations (an agent firing three commands at once) all pass the health probe and all spawn a bridge. Losers die on F3; the winner's PID file may already have been overwritten. |
| F6 | `client.ts:312-321` | Bridge is spawned `detached` with stdio to a log file, so the **`READY\n` handshake** written by `writeReadySignal()` (`bridge.ts:453`) is never read. We poll blind for 30 s even when the child died in 200 ms. |
| F7 | `client.ts:332-335` | Startup failure message is generic and does not include **the tail of `bridge.log`**, which already contains the actual cause. |
| F8 | `client.ts:375-379` | `ECONNREFUSED` maps to "Bridge is not running" **with no retry**. The bridge shuts itself down when the MCP transport closes (`bridge.ts:655-659`), so a browser crash reliably produces this — and we make the user re-run by hand. |
| F9 | `client.ts:294-299` | Dev-mode detection spawns `npx tsx`. If `tsx` is not cached, **`npx` blocks on an install prompt** with stdio pointed at a log file — a silent 30 s hang. |
| F10 | `client.ts:504-514` | `stopBridge` sends SIGTERM, **does not wait, does not escalate to SIGKILL, and does not clean a stale PID file**. `stop` can report success against a process that ignored the signal. |
| F11 | `bridge.ts:107-120` | `writePidFile` runs inside the `listen` callback. If `~/.opera-browser-cli` is unwritable (e.g. root-owned after a `sudo` run) it throws **uncaught** and the bridge dies after binding the port. |
| F12 | — | No `restart` command. `CLAUDE.md` documents `stop` + `lsof -ti :9224 | xargs kill` as the recovery procedure. That procedure should not need to exist. |
| F13 | `client.ts:301-310` | `bridge.log` is opened `"a"` and **never rotated**. Unbounded growth on a long-lived machine. |

### 2.2 Browser launch (`bridge.ts:457-503`)

| ID | Problem |
|---|---|
| F14 | **Profile already in use.** With `OPERA_CLI_USER_DATA_DIR` pointing at the real Opera profile (which `setup` offers as the detected default, `cli.ts:1862`), launching while Opera is open hits the `SingletonLock` and the launch fails or silently attaches to nothing. This is the single most likely everyday failure — users have their browser open. |
| F15 | **No attach path.** There is no way to say "use the Opera I already have open". `OPERA_CLI_BROWSER_URL` exists but requires the user to have started Opera with `--remote-debugging-port` themselves. |
| F16 | **Headless is the default** (`bridge.ts:490`) unless `OPERA_CLI_HEADED=1`. Un-configured users get headless + `--isolated`, where sign-in is impossible, so every AI command fails on a state they cannot fix from the CLI. |
| F17 | **MCP binary is not preflighted.** `resolveOperaMcpBin` (`bridge.ts:505`) falls back to bare `opera-devtools-mcp` on `PATH`; if absent, the spawn fails inside the transport and surfaces as a 30 s timeout. |
| F18 | **No browser-crash recovery.** Transport close → bridge exits (correct) → next call is F8. |

### 2.3 Auth and entitlement (`cli.ts:2191-2272`)

| ID | Problem |
|---|---|
| F19 | Sign-in / subscription / consent are detected (`CDP_RESULT_ERRORS`) but only produce **prose advice**. There is no `login` command that opens the sign-in page in the headed browser and waits. |
| F20 | `requireNeon` (`cli.ts:2191`) only checks that the executable **path exists**. It cannot tell Neon from Opera from Chrome, and cannot tell signed-in from signed-out — so the fast-fail misses the two most common cases. |
| F21 | The bridge's own bearer token has **no error mapping**. A stale PID file yields a bare `unauthorized` string with no code and no recovery. |

### 2.4 Configuration and first run

| ID | Problem |
|---|---|
| F22 | `warnIfUnconfigured` (`cli.ts:2591`) prints a hint to stderr and proceeds into a broken configuration. |
| F23 | `setup` **requires a TTY** (`cli.ts:1749`) and refuses to run under an agent — which is exactly how most of these users invoke the CLI. There is no non-interactive path. |
| F24 | Config keys are **not validated**. A typo (`OPERA_CLI_EXEC_PATH=`) is silently ignored and `doctor` does not flag it. |

### 2.5 Contract with callers

| ID | Problem |
|---|---|
| F25 | **Exit codes are undifferentiated** — everything non-zero is 1. Agents and scripts cannot distinguish "retry later" from "ask the user to sign in". |
| F26 | No transient-error retry. Element-detached-during-navigation and similar races surface raw. |

---

## 3. Design principles

1. **Recover, then report.** Any failure with a mechanical fix is fixed silently and the command completes. The user only ever hears about decisions they must make.
2. **Every error carries a next action.** The existing `CdpError(message, code, suggestions)` shape is already right; the gap is coverage, not format.
3. **One bridge, provably ours.** Identity = `{server, version, pid, startedAt, bootId}`. Never signal a process we have not identified.
4. **Idempotent and concurrency-safe.** Any command can run twice, or three at once, from a cold start.
5. **Config is a cache, not a prerequisite.** Absent config means "detect it now", not "fail".
6. **Fail fast, not fail slow.** No 30 s poll for a child that died in 200 ms.

---

## 4. Workstreams

### P0 — Self-healing bridge lifecycle ✅ done
*Fixes F1–F13, F21. Highest value: it removes the documented manual recovery procedure entirely.*

**Shipped.** `src/identity.ts` and `src/version.ts` are new; `src/client.ts` was substantially
rewritten. Covered by `test/identity.test.ts`, `test/bridge-lifecycle.test.ts`,
`test/bridge-startup.test.ts`, `test/bridge-recovery.test.ts` (41 tests), with
`test/fixtures/stub-mcp.js` standing in for `opera-devtools-mcp` so the whole lifecycle is
tested without launching a browser.

Two deviations from the plan as written, both deliberate:

- **`bootMinute`, not a hashed `bootId`.** A hash cannot be compared with a tolerance, and
  two processes computing boot time from `os.uptime()` seconds apart legitimately disagree
  by a second or two. A raw boot-minute compared with `sameBoot` (±1) is robust where an
  equality check on a hash would produce false mismatches at minute boundaries.
- **The bridge binds its port before connecting to MCP.** Not in the original plan, and
  necessary: with the reverse order, losing a port race meant launching an entire browser
  and then discarding it, leaving an orphaned child. Binding first makes a lost race free,
  which is what allows the port scan to be cheap enough to be the default path.

**P0.1 — Health contract with identity** (`bridge.ts`, `client.ts`)

`/health` returns:

```json
{
  "status": "ok",
  "server": "opera-browser-cli",
  "version": "0.1.46",
  "pid": 12345,
  "startedAt": 1755400000000,
  "bootId": "<hash of boot time>",
  "browser": { "connected": true, "target": "Opera Neon", "headed": true }
}
```

- `version` read from `package.json` at bridge start (reuse `readPackageVersion`, `cli.ts:916` — extract to a shared module).
- `bootId` derived from `os.uptime()` at start, rounded to the minute, so a recycled PID after reboot never matches.
- Client-side `BridgeIdentity` check replaces the current boolean `isBridgeHealthy`:
  - `version !== ourVersion` → **restart** (fixes F2).
  - `pid`/`bootId` mismatch with the PID file → treat the PID file as stale, **do not signal** (fixes F1).
  - `server !== "opera-browser-cli"` → foreign server, port fallback (P0.3).

**P0.2 — Start lock** (`client.ts`)

Wrap the spawn in an exclusive lock at `~/.opera-browser-cli/bridge.lock`, created with `openSync(path, "wx")`, containing `{pid, startedAt}`.

- Lock acquired → spawn, wait for ready, release.
- Lock held by a live process → poll `/health` for up to 30 s instead of spawning (fixes F5).
- Lock held by a dead PID, or older than 60 s → steal it.
- Released in a `finally` and on `process.on("exit")`.

**P0.3 — Port allocation** (`client.ts`, `bridge.ts`)

- Probe `OPERA_CLI_PORT` (default 9225), then 9226…9234.
- First port answering with our identity → use it.
- First port with nothing listening → spawn there; the child receives it via `OPERA_CLI_PORT`.
- All busy with foreign servers → the current hard error, which is now genuinely exceptional (fixes F4).
- Add `server.on("error")` in `runBridge`: on `EADDRINUSE`, log and exit `75` (EX_TEMPFAIL) rather than throwing; the parent reads the exit code and retries the next port (fixes F3).

**P0.4 — Ready handshake and fast failure** (`client.ts`, `bridge.ts`)

- Spawn with `stdio: ["ignore", "pipe", logFd]`, read the `READY\n` line from the pipe, then `unref` and detach (fixes F6). Startup latency drops from "poll interval" to "as fast as the bridge binds".
- Bridge emits `FAILED <reason>\n` on the same channel for known-fatal startup errors (MCP spawn failure, unwritable state dir).
- Watch for child `exit` during the wait — if it dies, abort the poll immediately and read the last ~40 lines of `bridge.log` into the thrown `CdpError` (fixes F7).
- Wrap `writePidFile` in try/catch; on failure log `FAILED state-dir-unwritable` and exit cleanly with a message naming the directory and the fix (`chown`) (fixes F11).

**P0.5 — Transparent retry on connection loss** (`client.ts`)

`callTool` gains a single-retry wrapper:

```
attempt → ECONNREFUSED | ECONNRESET | 401 | "MCP transport disconnected"
        → invalidate cached identity, ensureBridge() (which restarts), replay once
        → still failing → CdpError with recovery suggestions
```

- Replay is safe for reads and navigation; **not** replayed for `opera_do` / `opera_make` (side-effecting and expensive) — those report the restart and ask for a re-run (fixes F8, F18).
- 401 first re-reads the PID file (the token may have rotated under us) before escalating to a restart (fixes F21).

**P0.6 — Lifecycle commands** (`cli.ts`)

- `restart` — stop (with escalation) + start, one command (fixes F12).
- `stop` — SIGTERM, poll up to 5 s, SIGKILL, remove the PID file, report what actually happened. Also handles the "PID file exists, process dead" case by cleaning up and reporting `stopped (stale)` (fixes F10).
- `status` — identity + browser state, no side effects (thin alias over the new health payload).

**P0.7 — Log rotation** (`client.ts`)

Before opening `bridge.log`, if it exceeds 5 MB, rename to `bridge.log.1` (keep one generation) (fixes F13).

**P0.8 — Dev-mode gating** (`client.ts`)

Only take the `tsx` path when `OPERA_CLI_DEV=1` **and** `tsx` resolves locally; never invoke `npx` with a non-interactive stdio (fixes F9).

---

### P1 — Zero-config first run ✅ done
*Fixes F22, F23, F16, F24. This is the "one-click" half of the goal.*

**Shipped.** `src/detect.ts` and `src/config.ts` are new; `warnIfUnconfigured` is replaced
by `ensureConfigured`, and `setup` no longer requires a TTY. Covered by
`test/config.test.ts` plus setup/flag parsing in `test/cli.test.ts` (26 tests).

One significant deviation:

- **P1.3 is narrower than "headed by default".** A blanket inversion would break every
  machine with no display — CI, Docker, and anyone driving plain Chrome — for whom
  headless is not a preference but the only thing that works. The rule shipped instead is
  *headed when an Opera binary is configured*, which is exactly the population that needs
  a window (sign-in and consent cannot be completed headlessly) and excludes the
  headless-only population entirely. Autoconfiguration writes `OPERA_CLI_HEADED=1` when it
  detects a browser, so the F16 case — an unconfigured user getting an unusable headless
  AI command — is closed from both directions. `OPERA_CLI_HEADED=0` still overrides.
  The openclaw sidecar is unaffected: it uses `OPERA_CLI_BROWSER_URL`, which never reaches
  the headless branch.
- **Autoconfiguration prefers the browser's real profile**, per M3's revised P2.1, rather
  than the CLI-owned profile the original P1.1 specified. A profile that turns out to be
  in use is now resolved at launch time, so there is no reason to avoid it.

**P1.1 — Autoconfigure on first use** (`cli.ts`)

Replace `warnIfUnconfigured` with `ensureConfigured()`, run before any browser-touching command:

1. Config exists → done.
2. No config → run **detection silently**: `neonCandidatePaths()` → `operaCandidatePaths()` → first hit wins.
3. Write `~/.opera-browser-cli/config` with the detected binary, `OPERA_CLI_HEADED=1`, and a **CLI-owned profile** at `~/.opera-browser-cli/profile` (not the live Opera profile — see P2.1).
4. Print one line to stderr: `configured: Opera Neon (headed) — run 'opera-browser-cli setup' to change`.
5. Nothing detected → a single actionable error naming the download URL and the `OPERA_CLI_EXECUTABLE_PATH` override.

This works identically under an agent and in a terminal (fixes F22, F23).

**P1.2 — `setup --non-interactive`** (`cli.ts`)

Same detection as P1.1, plus flags for scripted installs: `--executable`, `--profile`, `--headed`/`--headless`, `--yes`. Removes the TTY hard requirement; the wizard stays as the default interactive path.

**P1.3 — Headed by default** (`bridge.ts:490`)

Invert the default: headed unless `OPERA_CLI_HEADED=0` or `OPERA_CLI_HEADLESS=1`. Sign-in, consent, and every Opera AI feature depend on a real window; headless-by-default makes the AI commands unusable for anyone who skipped setup (fixes F16).
*Note: this is a behaviour change for existing users who rely on the current default — call it out in the changelog and honour an explicit `OPERA_CLI_HEADED=0`.*

**P1.4 — Config validation** (`client.ts`, `cli.ts`)

`loadConfig` collects unknown keys against a known-key allowlist; `doctor` reports them as `warn` with a did-you-mean suggestion (fixes F24).

---

### P2 — Browser launch conflicts ✅ done
*Fixes F14, F15, F17. Highest-frequency real-world failure after the bridge.*

**Shipped.** `src/profile.ts` and `src/browser-target.ts` are new; conflict resolution runs
as a preflight in `cli.ts` before the bridge starts, because resolving one may need to ask
the user something and the bridge is detached with no terminal. Covered by
`test/profile.test.ts` and `test/browser-target.test.ts` (39 tests).

Deviations from the plan as written:

- **`DevToolsActivePort` does the work P2.3 was going to ask the user to do.** Chromium
  records the debug port inside the user-data-dir whenever it is given one. So detection
  needs no configuration at all: start Opera with a port once, and every later command
  finds it. `attach` remains for pointing at a *different* endpoint, but is no longer the
  primary path.
- **A live debug port overrides the lock**, rather than being checked after it. A profile
  locked by another host reads as `unknown`, but if something answers on the recorded port
  the question is already settled.
- **Self-launch only after a takeover**, not whenever a real profile is configured. When
  the profile is free, the existing managed launch already works and is well-tested;
  changing it would be an enhancement with regression risk, not a fix. The asymmetry is
  deliberate: having just quit the user's browser, we owe them one that outlives the
  bridge, which is what the self-launched, detached, attachable browser gives them.
- **No `--takeover` escalation to SIGKILL.** Forcing a browser risks a corrupted profile
  and loses the user's tabs; a browser that will not quit is reported instead.

**P2.1 — Keep the live profile; resolve the conflict instead of avoiding it**

*Revised from "own the profile by default" — the original plan traded away the thing users
actually want (their real logged-in browser) to dodge a conflict that can be resolved.*

The governing constraint: **`--remote-debugging-port` is a startup-only flag.** An Opera
launched normally cannot be attached to, ever. So there is no way to "hook up to the
browser that is already open" — only ways to arrange that the open browser was started
correctly in the first place. Given that, the default becomes:

1. **Opera not running** → launch it ourselves with the real profile and a debug port.
   The user gets their own logged-in browser, no sign-in needed.
2. **Opera running on the target profile** → offer to restart it (P2.2). One keypress,
   session restore returns the tabs, all logins intact.
3. **User declines** → fall back to `~/.opera-browser-cli/profile` for that run and say so.

`setup` keeps a "use a separate CLI profile" option for anyone who prefers isolation.

**P2.2 — Detect the lock and offer a takeover** (`bridge.ts`, `cli.ts`)

Before spawning with a `userDataDir`, read `SingletonLock` at the user-data-dir root. On
POSIX it is a symlink whose target is `<hostname>-<pid>`, so `readlink` → parse the PID →
`kill(pid, 0)` tells us whether the owner is alive. A dangling link means Chromium will
clean it up itself and the directory is free. (Windows uses a `lockfile` plus a mutex and
needs a separate probe — tracked in §7.)

If the profile is genuinely in use:

1. **Attach** if a debug port is already open — probe `/json/version` and confirm the
   `Browser` string is Opera, then switch to `--browserUrl`.
2. **Offer a restart**: "Opera is running. Restart it so the CLI can drive it? [Y/n]".
   Non-interactive callers get this only with an explicit `--takeover` flag; an agent must
   never quit a user's browser unprompted.
3. **Fall back** to the CLI-owned profile, warning once.
4. Never emit a raw Chrome launch failure (fixes F14).

**P2.2a — Debug-port exposure**

Attaching to the live profile means an unauthenticated CDP port on a browser logged into
everything the user is. The bridge's bearer token does not cover this — CDP has no auth of
its own — so the mitigations are structural:

- Allocate a **random high port per launch**, never a fixed 9222, and record it in the PID
  file so only our CLI knows where it is.
- Bind `--remote-debugging-address=127.0.0.1` explicitly.
- **Never** pass `--remote-allow-origins=*`. Chromium's default rejection of CDP WebSocket
  upgrades carrying an `Origin` header is what stops a web page from driving the browser.
- Tear the port down with the browser when the CLI owns its lifecycle.
- Say plainly in the docs that live-profile mode means an open local CDP port for as long
  as that browser runs.

**P2.3 — `attach` command** (`cli.ts`)

`opera-browser-cli attach [--port 9222]` — persists `OPERA_CLI_BROWSER_URL` and verifies the endpoint. Plus a `launch-args` helper that prints the exact flags to start Opera with remote debugging, so "use the browser I already have open" is a two-step, documented path (fixes F15).

**P2.4 — Preflight the MCP binary** (`bridge.ts`, `cli.ts doctor`)

Resolve `opera-devtools-mcp` at bridge start; if unresolvable, emit `FAILED mcp-not-found` and have the client raise a `CdpError` naming the install command. Add a `doctor` check for it (fixes F17).

---

### P3 — Auth and entitlement UX ✅ done
*Fixes F19, F20.*

**Shipped.** `login` opens the Opera account page in a visible window and confirms afterwards;
`requireNeon` now classifies the browser instead of only checking that a path exists; the
entitlement descriptors carry `AUTH_REQUIRED` and name `login`.

Deviation:

- **`login` does not poll for sign-in state.** P3.1 assumed that state is observable. It is
  not: sign-in, subscription, and consent are only visible in the reply to a real Opera AI
  call, so polling would mean repeatedly making billable calls against a user who has not
  finished typing their password. Instead `login` waits on the user (Enter on a TTY) and
  then verifies once. `login --check` verifies without navigating.
- **P3.2's capability probe is path- and attach-based, not a live browser query.** When
  attached we have the browser's real version string and use it; when launching, the build
  is identified from the binary, which is how Opera names them. A CDP-level probe would add
  a round trip to every AI command to distinguish cases the binary name already separates.

**P3.1 — `login` command** (`cli.ts`)

`opera-browser-cli login` — forces a headed session, navigates to the Opera account sign-in, polls sign-in state, and returns when authenticated (or times out with a clear message). This turns F19's advice into an action.

**P3.2 — Capability probe replaces path-sniffing** (`cli.ts:2191`)

Ask the browser what it is rather than guessing from the path: a lightweight probe (browser version string / Opera AI tool availability) cached in the bridge and exposed on `/health` as `browser.capabilities`. `requireNeon` then checks the actual capability, and can distinguish:

- not an Opera browser → install prompt
- Opera but not Neon → "chat works here; `invoke-do`/`make`/`research` need Neon"
- Neon but signed out → `opera-browser-cli login`

(fixes F20).

**P3.3 — Entitlement errors carry the fix**

Extend `CDP_RESULT_ERRORS` (`cli.ts:2222`) so each entry names a command, not just a URL: `NOT_SIGNED_IN` → `opera-browser-cli login`; `CONSENT_REQUIRED` → open the consent surface in the headed window.

---

### P4 — Caller contract ✅ done
*Fixes F25, F26.*

**Shipped** via the `formatError` hook `runAxiCli` already exposes. Required a new
`AUTH_REQUIRED` error code — entitlement failures were previously `BROWSER_ERROR`, which is
indistinguishable from a browser fault and would have collapsed exit codes 3 and 4.

**P4.1 — Exit codes**

| Code | Meaning | Caller action |
|---|---|---|
| 0 | Success | — |
| 1 | Unknown / internal | Report |
| 2 | `VALIDATION_ERROR` — bad arguments | Fix the command |
| 3 | Environment not ready (bridge/browser/MCP) after auto-recovery | Run `doctor` |
| 4 | Auth or entitlement (`login`, subscription, consent) | Ask the user |
| 5 | `TIMEOUT` | Retry |
| 6 | `REF_NOT_FOUND` / `PAGE_CLOSED` — stale page state | Re-snapshot and retry |

Mapped centrally from `ErrorCode` in the top-level error handler. Documented in `README.md` and `SKILL.md` so agents can branch on it.

**P4.2 — Transient retry**

Retry once, after a 250 ms delay, for known-transient CDP failures (element detached, execution context destroyed, target crashed during navigation) — with the retry recorded so it shows in `logs` (fixes F26).

---

### P5 — Diagnosis and repair ✅ done

**P5.1 — `doctor --fix`**

Every check that currently prints advice gains a repair action:

| Check | Repair |
|---|---|
| stale PID file | remove it |
| dead/unhealthy bridge | restart |
| version skew | restart |
| missing config | run P1.1 autoconfigure |
| unknown config keys | report (no auto-edit) |
| oversized log | rotate |
| missing MCP binary | print install command (no auto-install) |

**P5.2 — Richer `doctor` checks**

Add: MCP binary resolution, browser capability probe, profile-lock state, port scan (what is on 9225–9234), Node version, package version vs. running bridge version.

**P5.3 — `logs --follow` and `logs --errors`**

Tail mode and a filter for the failure lines that actually matter, so the common debugging step is one command.

---

### P6 — Test matrix

New tests, mirroring the existing `test/*.test.ts` layout:

| File | Covers |
|---|---|
| `test/bridge-lifecycle.test.ts` | version skew → restart; recycled PID → no signal sent; stale lock stolen after 60 s; EADDRINUSE → clean exit 75 |
| `test/bridge-concurrency.test.ts` | N=5 concurrent `ensureBridge()` → exactly one spawn, five successes |
| `test/port-fallback.test.ts` | foreign server on 9225 → bridge lands on 9226 |
| `test/recovery.test.ts` | bridge killed mid-session → next `callTool` succeeds; `opera_do` is *not* silently replayed |
| `test/first-run.test.ts` | empty `$HOME` + detected binary → config written, command succeeds, no TTY |
| `test/profile-lock.test.ts` | `SingletonLock` present → attach or fall back, never a raw launch error |
| `test/exit-codes.test.ts` | each `ErrorCode` → its documented exit code |

Plus a manual pre-release checklist (real browser, real account) for the states that cannot be faked: signed-out, no subscription, consent pending, Opera already running, browser closed mid-command.

---

## 5. Sequencing

| Milestone | Contents | Why this order |
|---|---|---|
| ~~**M1 — Bridge never needs a human**~~ ✅ | P0.1–P0.8 | Removes the documented manual recovery procedure; every later workstream depends on a trustworthy bridge. |
| ~~**M2 — First run needs no setup**~~ ✅ | P1.1–P1.4 | Turns the largest new-user cliff into a no-op. (P2.4 shipped with M3.) |
| ~~**M3 — Browser conflicts resolve themselves**~~ ✅ | P2.1–P2.4 | The most common everyday failure once M1/M2 land. |
| ~~**M4 — Auth is one command**~~ ✅ | P3.1–P3.3 | Depends on M3's headed, capability-probed session. |
| ~~**M5 — Contract and repair**~~ ✅ | P4, P5 | Polish; makes the remaining failures self-service. |
| ~~**M6 — Test matrix**~~ ✅ | P6 | Written alongside each milestone, not after. |

M1 and M2 together cover S1–S5, S8, S10 — the majority of the success criteria — and are independently shippable.

---

## 6. Risks and trade-offs

| Risk | Mitigation |
|---|---|
| **Headed-by-default (P1.3)** changes behaviour for existing headless CI users. | Honour `OPERA_CLI_HEADED=0`; announce in `CHANGELOG.md`; keep `--headless` documented in `TOP_HELP`. |
| **Restarting the user's browser (P2.2)** interrupts what they were doing. | Never without consent: interactive prompt, or an explicit `--takeover` flag for scripted callers. Session restore returns the tabs. |
| **Live-profile CDP port (P2.2a)** exposes a fully logged-in browser to any local process. | Random per-launch port, loopback bind, no `--remote-allow-origins`, torn down with the browser, documented plainly. Inherent to attaching at all — not fixable by our bearer token. |
| **Auto-restart (P0.5)** could mask a genuine crash loop. | Cap at one restart per invocation; count restarts in `bridge.log`; surface repeated restarts as a `doctor` `fail`. |
| **Port fallback (P0.3)** breaks anything hardcoding 9225. | The PID file remains the source of truth for the port; document that callers must read it, not assume. |
| **Capability probe (P3.2)** adds latency to the first AI command. | Probe once at bridge start, cache on the bridge, expose via `/health`. |
| **Retry (P0.5, P4.2)** could double a side effect. | Explicit allowlist: reads and navigation replay; `opera_do` / `opera_make` / `opera_research` never do. |

---

## 7. Out of scope

- Linux support for Opera Neon (`neonCandidatePaths` returns `[]` — Neon does not ship for Linux).
- Windows process-group teardown (`bridge.ts:664-671` uses `process.kill(-pid)`, a POSIX construct). Worth a follow-up spec if Windows becomes a supported target.
- The parallel streaming work already tracked in [`fix-parallel-streaming-routing.md`](fix-parallel-streaming-routing.md) and [`fix-streaming-timeout-and-cleanup.md`](fix-streaming-timeout-and-cleanup.md).
