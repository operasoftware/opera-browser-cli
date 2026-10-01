#!/usr/bin/env node

/**
 * `opera-browser-cli` compatibility launcher.
 *
 * The CLI moved into `opera-devtools-mcp`, but npm has no way to remove another
 * package's global binstub except a **same-name upgrade**: it retires the
 * previous version of the incoming package's name — unlinking its binstubs —
 * before the new package's bin-conflict check runs. So this package keeps the
 * old name and the old bin name and depends on the real implementation, which
 * makes `npm i -g opera-browser-cli` / `npm update -g opera-browser-cli` — the
 * command users already run — install the new CLI without `--force` and
 * without a manual uninstall.
 *
 * The launcher only resolves and spawns; it never reimplements the CLI. The
 * implementation entry is ESM (so it is spawned, not `require`d), and stdio is
 * inherited for a zero-copy pass-through of TTYs and pipes.
 *
 * Marker it hands the child (read by `--version` and `doctor` in
 * `opera-devtools-mcp`, `src/opera/launcherNotice.ts`):
 *   OPERA_CLI_LAUNCHER=1               — this CLI came from the launcher
 *   OPERA_CLI_LAUNCHER_PREFIX=<prefix> — the global prefix it resolved
 *
 * Retire the launcher when `opera-browser-cli@0.2.0` (a bin-less tombstone) and
 * `opera-devtools-mcp@0.9.0` (dual bin) exist:
 *   npm i -g opera-devtools-mcp@0.9.0 opera-browser-cli@0.2.0
 *   npm rm -g opera-browser-cli   # optional: drops the inert tombstone
 */

'use strict';

const {execSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Where the implementation's CLI entry lives inside its package. */
const CLI_ENTRY = path.join('build', 'src', 'bin', 'opera-browser-cli.js');

/** What npm sets while it runs an install script, when it is set at all. */
function envPrefix() {
  const prefix = process.env.npm_config_prefix ?? process.env.NPM_CONFIG_PREFIX;
  return prefix ? prefix : null;
}

/** The prefix npm installed this launcher under, asked of npm as a last resort. */
function npmPrefix() {
  try {
    return (
      execSync('npm config get prefix', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * The prefix the launcher itself sits under, read from its own path: npm links
 * `<prefix>/bin/opera-browser-cli` to `<prefix>/lib/node_modules/<pkg>/bin/cli.js`
 * on POSIX and `<prefix>/node_modules/<pkg>/bin/cli.js` on Windows. Deriving it
 * costs nothing; asking npm would spawn a process on every single command.
 */
function ownPathPrefix() {
  const packageDir = path.dirname(__dirname);
  if (path.basename(packageDir) !== 'opera-browser-cli') {
    return null;
  }
  const nodeModules = path.dirname(packageDir);
  if (path.basename(nodeModules) !== 'node_modules') {
    return null;
  }
  const parent = path.dirname(nodeModules);
  return path.basename(parent) === 'lib' ? path.dirname(parent) : parent;
}

function globalPrefix() {
  return ownPathPrefix() ?? envPrefix() ?? npmPrefix();
}

/**
 * Where the implementation may be, best first: a sibling root is a package the
 * user installed directly and is therefore the one they upgrade, while the
 * nested copy is whatever `^0.8.0` resolved when *this* launcher was installed.
 */
function implementationCandidates() {
  const candidates = [];
  const prefix = globalPrefix();
  if (prefix) {
    candidates.push(
      path.join(prefix, 'lib', 'node_modules', 'opera-devtools-mcp'),
      path.join(prefix, 'node_modules', 'opera-devtools-mcp'),
    );
  }
  try {
    candidates.push(path.dirname(require.resolve('opera-devtools-mcp/package.json')));
  } catch {
    // No nested copy either: the candidates tried so far are what the error lists.
  }
  return candidates;
}

function resolveImplementation() {
  const candidates = implementationCandidates();
  const usable = candidates.find(dir => fs.existsSync(path.join(dir, CLI_ENTRY)));
  if (usable) {
    return usable;
  }
  process.stderr.write(
    [
      'opera-browser-cli: the compatibility launcher cannot find the new implementation.',
      ...candidates.map(dir => `  tried ${dir}`),
      'Install it directly, then retire this launcher:',
      '  npm i -g opera-devtools-mcp@latest',
      '  npm rm -g opera-browser-cli',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const prefix = globalPrefix();
const result = spawnSync(
  process.execPath,
  [path.join(resolveImplementation(), CLI_ENTRY), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPERA_CLI_LAUNCHER: '1',
      OPERA_CLI_LAUNCHER_PREFIX: prefix ?? '',
    },
  },
);

if (result.error) {
  process.stderr.write(
    `opera-browser-cli: could not start the new implementation: ${result.error.message}\n`,
  );
  process.exit(1);
}

if (result.signal) {
  // A child killed by a signal (`Ctrl-C` sends SIGINT to the whole foreground
  // process group) has no exit status, and `?? 1` would report the user's
  // cancellation as a failure — visible to `set -e` and to CI runners. Re-raise
  // it instead; the ones Windows cannot raise on itself fall through to 1.
  try {
    process.kill(process.pid, result.signal);
  } catch {
    // Unsupported signal: the exit code below is all that is left.
  }
}

process.exit(result.status ?? 1);