#!/usr/bin/env node
/**
 * S5 corpus analysis (specs/compact-v3-plan.md).
 *
 * For each URL: opens it via the CLI, captures the raw and compact snapshots,
 * and reports (a) attribute/role frequencies in the raw tree — candidates for
 * data-driven pruning, and (b) the share of compact bytes sitting in runs of
 * ≥4 consecutive sibling subtrees with identical role-skeletons — the trigger
 * metric for R2 (fold repeated subtrees into tabular rows).
 *
 * Usage: node benchmarks/corpus-analyze.mjs <url> [<url> ...]
 * Env: OPERA_CLI_MCP_BIN as usual; uses dist/bin/opera-browser-cli.js.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin", "opera-browser-cli.js");

function cli(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

function stripToTree(out) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => /\bRootWebArea\b|\buid=|^@[\d.]/.test(l));
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^(urls:|help\[|\s*\.\.\. \(truncated)/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(Math.max(start, 0), end).join("\n");
}

function indentOf(l) { return l.match(/^\s*/)[0].length; }
function roleOf(l) { return l.match(/^\s*(?:uid=\S+ |@[\d.]+ )?(#+|[A-Za-z][a-zA-Z]*)/)?.[1] ?? "?"; }

/** End index (exclusive) of the subtree rooted at lines[i]. */
function subtreeEnd(lines, i) {
  const d = indentOf(lines[i]);
  let j = i + 1;
  while (j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > d)) j++;
  return j;
}

/** Role-skeleton of a subtree: relative indent + role per line. */
function shape(lines, i, end) {
  const base = indentOf(lines[i]);
  return lines.slice(i, end).map((l) => `${indentOf(l) - base}:${roleOf(l)}`).join(",");
}

/** Bytes inside runs of >=minRun consecutive siblings with identical skeletons. */
function foldableBytes(tree, minRun = 4) {
  const lines = tree.split("\n");
  let foldable = 0;
  let i = 0;
  while (i < lines.length) {
    const end = subtreeEnd(lines, i);
    const d = indentOf(lines[i]);
    const sh = shape(lines, i, end);
    // Walk consecutive siblings with the same shape
    let run = 1;
    let j = end;
    let runEnd = end;
    while (j < lines.length && indentOf(lines[j]) === d) {
      const e2 = subtreeEnd(lines, j);
      if (shape(lines, j, e2) !== sh) break;
      run++;
      runEnd = e2;
      j = e2;
    }
    if (run >= minRun && sh.includes(",")) {
      foldable += lines.slice(i, runEnd).join("\n").length;
      i = runEnd;
    } else {
      i = end;
    }
  }
  return foldable;
}

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: corpus-analyze.mjs <url> [...]");
  process.exit(1);
}

const attrCounts = new Map();
const roleCounts = new Map();
let totalCompact = 0;
let totalFoldable = 0;

for (const url of urls) {
  cli(["open", url, "--quiet"]);
  const raw = stripToTree(cli(["snapshot", "--raw", "--full"]));
  const compact = stripToTree(cli(["snapshot", "--full", "--force"]));

  for (const m of raw.matchAll(/ ([a-zA-Z-]+)="([^"]{0,30})[^"]*"/g)) {
    const key = `${m[1]}=${m[2].length > 15 ? "<long>" : `"${m[2]}"`}`;
    attrCounts.set(key, (attrCounts.get(key) ?? 0) + 1);
  }
  for (const line of raw.split("\n")) {
    const r = roleOf(line);
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }

  const fold = foldableBytes(compact);
  totalCompact += compact.length;
  totalFoldable += fold;
  console.log(`${url}\n  compact=${compact.length}b foldable=${fold}b (${((100 * fold) / compact.length).toFixed(1)}%)`);
}

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log("\nTop attribute=value pairs (raw):");
for (const [k, c] of top(attrCounts, 20)) console.log(`  ${c}\t${k}`);
console.log("\nTop roles (raw):");
for (const [k, c] of top(roleCounts, 15)) console.log(`  ${c}\t${k}`);
console.log(`\nAGGREGATE foldable share: ${((100 * totalFoldable) / totalCompact).toFixed(1)}% of ${totalCompact} compact bytes`);
