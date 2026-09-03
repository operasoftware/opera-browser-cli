/**
 * Panda MCP adapter shim.
 *
 * The opera-browser-cli bridge talks to opera-devtools-mcp over stdio. When
 * OPERA_CLI_BROWSER_BACKEND=panda the bridge instead talks to this process.
 * It exposes the same tool *names* the CLI already calls, but translates each
 * call into Lightpanda ("panda") MCP tools.
 *
 * The load-bearing contract is the CLI's `@X.Y` ref system: `take_snapshot`
 * must return text the CLI's `compactSnapshot()` can process, and every
 * interactive tool must accept the `uid` refs that snapshot produced. Panda
 * addresses nodes by `backendNodeId`, so this shim keeps a
 * `backendNodeId -> @X.Y` map between snapshots.
 *
 * backendNodeId values are stable across non-navigating mutations (panda's
 * CDPNode.Registry is monotonic and only resets on navigation), so the map is
 * built lazily from one `tree` call and reused until a navigation invalidates
 * it. A stale-ref `NodeNotFound` triggers one rebuild + retry, matching the
 * CLI's exit-code-6 "re-snapshot" behaviour.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { detectLightpanda } from "./detect.js";

const SHIM_VERSION = "1.0.0";

/** Distinctive marker the CLI maps to exit code 2 (unsupported on panda). */
const UNSUPPORTED_SENTINEL = "UNSUPPORTED_ON_PANDA";

/** Safety net for a single panda tool round-trip (lightpanda is Beta). */
const PANDA_CALL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- types

interface PandaNode {
  backendNodeId: number;
  depth: number;
  /** Empty string for text-only nodes (panda omits StaticText/none/generic). */
  role: string;
  name: string | null;
  value: string | null;
  interactive: boolean;
  disabled: boolean;
  checked: boolean | null;
}

class PandaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PandaError";
  }
}

// ---------------------------------------------------------------- tree parser

const isFrameNotLoaded = (message: string): boolean => /FrameNotLoaded/i.test(message);
const isNodeNotFound = (message: string): boolean => /NodeNotFound/i.test(message);

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collapse whitespace and drop quote characters that would break the `key="value"` format. */
function sanitize(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/["']/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Parse one line of panda's `tree` text output.
 *
 * Grammar (order is fixed, from browser/src/SemanticTree.zig TextVisitor):
 *   <depth spaces><id>( [i](:disabled)?)?( role)?( 'name')?( value='v')?( [checked|unchecked])?( options=[...])?
 */
export function parseTreeLine(line: string): { depth: number; node: PandaNode } {
  const trimmed = line.replace(/\r$/, "");
  const indent = trimmed.match(/^ */)?.[0].length ?? 0;
  const depth = indent;

  let rest = trimmed.slice(indent);

  // 1. backendNodeId
  const idMatch = rest.match(/^(\d+)/);
  const backendNodeId = idMatch ? Number.parseInt(idMatch[1], 10) : 0;
  rest = rest.slice(idMatch?.[0].length ?? 0);

  // 2. Interactive flag (" [i]" or " [i:disabled]")
  let interactive = false;
  let disabled = false;
  const iMatch = rest.match(/^ \[i(?::disabled)?\]/);
  if (iMatch) {
    interactive = true;
    disabled = iMatch[0] === " [i:disabled]";
    rest = rest.slice(iMatch[0].length);
  }

  // 3. Role — omitted for text-only nodes (which print `id 'text'` directly).
  let role = "";
  if (!/^\s*'/.test(rest)) {
    const roleMatch = rest.match(/^\s*([A-Za-z][A-Za-z0-9]*)/);
    if (roleMatch) {
      role = roleMatch[1];
      rest = rest.slice(roleMatch[0].length);
    }
  }

  // 4. Accessible name / text value (single-quoted)
  const nameMatch = rest.match(/^\s*'([^']*)'/);
  let name: string | null = null;
  if (nameMatch) {
    name = nameMatch[1];
    rest = rest.slice(nameMatch[0].length);
  }
  if (name != null && name.length === 0) name = null;

  // 5. Input value
  const valueMatch = rest.match(/^\s* value='([^']*)'/);
  const value = valueMatch?.[1] ?? null;

  // 6. Checked state
  const checkedMatch = rest.match(/ \[(checked|unchecked)\]/);
  const checked = checkedMatch ? checkedMatch[1] === "checked" : null;

  return {
    depth,
    node: { backendNodeId, depth, role, name, value, interactive, disabled, checked },
  };
}

/** Parse a full `tree` response into nodes in document order. */
export function parsePandaTree(text: string): PandaNode[] {
  const nodes: PandaNode[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    nodes.push(parseTreeLine(line).node);
  }
  return nodes;
}

/** Map a panda semantic role to the Chrome a11y role name the CLI expects. */
export function mapRole(role: string): string {
  if (role === "" || role === "none" || role === "generic" || role === "StaticText") {
    return "StaticText";
  }
  if (role === "RootWebArea") return "RootWebArea";
  // Panda roles already use Chrome's lowercase a11y names (link, button, …).
  return role;
}

export interface SerializeResult {
  text: string;
  /** uid ("1_4") -> backendNodeId, for action resolution. */
  uidToBackend: Map<string, number>;
  /** backendNodeId -> uid, so stable nodes keep their refs across refreshes. */
  backendToUid: Map<number, string>;
  nextId: number;
}

/**
 * Serialize parsed panda nodes into the `uid=X_Y RoleName "name" attr="value"`
 * text the CLI's compactSnapshot pipeline consumes. Reuses existing uids for
 * backendNodeIds already seen; assigns fresh uids to new ones.
 */
export function serializeNodes(
  nodes: PandaNode[],
  pageUrl: string | null,
  backendToUid: ReadonlyMap<number, string>,
  nextId: number,
  pageNum: number,
): SerializeResult {
  const newBackendToUid = new Map<number, string>(backendToUid);
  const uidToBackend = new Map<string, number>();
  let id = nextId;

  const lines: string[] = [];
  for (const node of nodes) {
    let uid = newBackendToUid.get(node.backendNodeId);
    if (uid === undefined) {
      uid = `${pageNum}_${id++}`;
      newBackendToUid.set(node.backendNodeId, uid);
    }
    uidToBackend.set(uid, node.backendNodeId);

    const role = mapRole(node.role);
    const parts = [`uid=${uid}`, role];
    if (node.name != null) parts.push(`"${sanitize(node.name)}"`);
    if (node.value != null) parts.push(`value="${sanitize(node.value)}"`);
    if (node.checked === true) parts.push("checked");
    if (node.disabled) parts.push("disabled");
    if (node.interactive) parts.push("focusable");
    if (node.depth === 0 && pageUrl != null) parts.push(`url="${pageUrl}"`);

    lines.push(`${"  ".repeat(node.depth)}${parts.join(" ")}`);
  }

  return {
    text: lines.join("\n"),
    uidToBackend,
    backendToUid: newBackendToUid,
    nextId: id,
  };
}

/**
 * Turn the CLI's `evaluate_script {function}` value into a panda `evaluate`
 * script. The CLI wraps plain expressions as `() => (EXPR)`; Panda stringifies
 * that form instead of invoking it, so unwrap it. Real function literals are
 * invoked and their result returned.
 */
export function toPandaScript(fn: string): string {
  const t = fn.trim();
  const wrapped = t.match(/^\(\)\s*=>\s*\(([\s\S]*)\)$/);
  if (wrapped) return `return (${wrapped[1]})`;
  const isFn = /^(?:async\s+)?(?:function(?:\s*\*)?(?:\s+[\w$]+)?\s*\(|\([\s\S]*?\)\s*=>|[\w$]+\s*=>)/.test(t);
  if (isFn) return `return (${t})()`;
  return `return (${t})`;
}

// ---------------------------------------------------------------- shim state

let backendToUid = new Map<number, string>();
let uidToBackend = new Map<string, number>();
let nextElemId = 1;
/** Monotonic page number — bumped on navigation so stale `@P.E` refs never collide. */
let pageSeq = 0;
let cachedSnapshot: string | null = null;
let currentUrl: string | null = null;

let pandaClient: Client | null = null;

function invalidateRefs(): void {
  pageSeq += 1;
  backendToUid.clear();
  uidToBackend.clear();
  nextElemId = 1;
  cachedSnapshot = null;
}

/** A non-navigating action only invalidates the cached snapshot content. */
function markStale(): void {
  cachedSnapshot = null;
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

function extractText(result: CallToolResult): string {
  return (result.content ?? [])
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callPanda(name: string, args: Record<string, unknown>): Promise<string> {
  if (!pandaClient) {
    throw new PandaError(
      "Lightpanda is not reachable. Set OPERA_CLI_LIGHTPANDA_BIN, or install `lightpanda` on PATH.",
    );
  }
  let result: CallToolResult;
  try {
    result = (await pandaClient.callTool(
      { name, arguments: args },
      undefined,
      { timeout: PANDA_CALL_TIMEOUT_MS },
    )) as CallToolResult;
  } catch (error) {
    throw new PandaError(errorMessageOf(error));
  }
  if (result.isError) {
    throw new PandaError(extractText(result) || `${name} failed`);
  }
  return extractText(result);
}

async function currentPageUrl(): Promise<string | null> {
  try {
    return await callPanda("getUrl", {});
  } catch (error) {
    if (isFrameNotLoaded(errorMessageOf(error))) return null;
    throw error;
  }
}

/** Fetch a fresh tree, rebuild uids for new nodes, and cache the snapshot. */
async function refreshSnapshot(): Promise<string> {
  let tree: string;
  try {
    tree = await callPanda("tree", {});
  } catch (error) {
    if (isFrameNotLoaded(errorMessageOf(error))) {
      currentUrl = null;
      cachedSnapshot = null;
      return "No page selected";
    }
    throw error;
  }
  let url: string | null = null;
  try {
    url = await currentPageUrl();
  } catch {
    url = null;
  }

  // A changing URL means a navigation (link click, form submit, JS redirect)
  // that no explicit trigger observed. Swap to a fresh page number so stale
  // `@P.E` refs from the previous page can never resolve to the new page.
  if (url !== null && currentUrl !== null && url !== currentUrl) {
    invalidateRefs();
  }
  currentUrl = url;

  const nodes = parsePandaTree(tree);
  const serialized = serializeNodes(nodes, currentUrl, backendToUid, nextElemId, pageSeq);
  backendToUid = serialized.backendToUid;
  uidToBackend = serialized.uidToBackend;
  nextElemId = serialized.nextId;
  cachedSnapshot = serialized.text;
  return serialized.text;
}

async function takeSnapshot(): Promise<string> {
  if (cachedSnapshot != null) return cachedSnapshot;
  return refreshSnapshot();
}

/** Resolve a `uid` ("1_4") to a backendNodeId, refreshing the snapshot if needed. */
async function resolveUid(uid: string): Promise<number> {
  let id = uidToBackend.get(uid);
  if (id === undefined) {
    await refreshSnapshot();
    id = uidToBackend.get(uid);
  }
  if (id === undefined) {
    throw new PandaError(
      `Element ${uid} not found in the snapshot — run \`opera-browser-cli snapshot\` and retry with a fresh ref`,
    );
  }
  return id;
}

/**
 * Run a panda action addressed by the CLI's uid. A `NodeNotFound` means the
 * element moved under us (navigation or DOM churn): refresh the snapshot and
 * surface a stale-ref error that the CLI maps to exit 6, exactly like Chrome's
 * stale-element-ref contract.
 */
async function runRefAction(
  pandaName: "click" | "fill" | "hover",
  uid: string,
  extraArgs: Record<string, unknown> = {},
): Promise<string> {
  try {
    return await callPanda(pandaName, { backendNodeId: await resolveUid(uid), ...extraArgs });
  } catch (error) {
    if (!isNodeNotFound(errorMessageOf(error))) throw error;
    await refreshSnapshot();
    throw new PandaError(
      `Element ${uid} not found (stale ref) — the page changed. Run \`opera-browser-cli snapshot\` and retry with a fresh ref.`,
    );
  }
}

function unsupported(name: string): CallToolResult {
  return textResult(
    `${UNSUPPORTED_SENTINEL}: \`${name}\` requires Chrome/Opera and is not available on the Lightpanda backend. Switch backends with OPERA_CLI_BROWSER_BACKEND=chrome.`,
    true,
  );
}

// ---------------------------------------------------------------- tool registry

const SUPPORTED_TOOLS: Array<Pick<Tool, "name" | "description">> = [
  { name: "navigate_page", description: "Navigate the current page to a URL, or go back." },
  { name: "take_snapshot", description: "Take a text snapshot of the current page." },
  { name: "page_markdown", description: "Read the current page as compact markdown (full text content)." },
  { name: "click", description: "Click an element by uid (e.g. @1.4)." },
  { name: "fill", description: "Fill a text field by uid." },
  { name: "hover", description: "Hover over an element by uid." },
  { name: "press_key", description: "Press a keyboard key." },
  { name: "type_text", description: "Type text into the focused element." },
  { name: "evaluate_script", description: "Run JavaScript in the page." },
  { name: "wait_for", description: "Wait for text to appear on the page." },
  { name: "list_console_messages", description: "List buffered console messages." },
  { name: "list_pages", description: "List open pages." },
  { name: "new_page", description: "Open a URL in a new page." },
  { name: "select_page", description: "Select a page by id." },
  { name: "close_page", description: "Close a page by id." },
];

const UNSUPPORTED_TOOLS: Array<Pick<Tool, "name" | "description">> = [
  "take_screenshot",
  "drag",
  "upload_file",
  "fill_form",
  "handle_dialog",
  "resize_page",
  "emulate",
  "get_console_message",
  "list_network_requests",
  "get_network_request",
  "lighthouse_audit",
  "performance_start_trace",
  "performance_stop_trace",
  "performance_analyze_insight",
  "take_memory_snapshot",
  "opera_chat",
  "opera_do",
  "opera_make",
  "opera_research",
  "opera_list_models",
  "opera_list_mcp_servers",
  "opera_list_mcp_tools",
  "opera_call_mcp_tool",
  "opera_register_mcp_server",
  "opera_connect_mcp_server",
  "opera_authenticate_mcp_server",
  "opera_enable_mcp_server",
  "opera_disable_mcp_server",
  "opera_unregister_mcp_server",
].map((name) => ({
  name,
  description: "Not supported on the Lightpanda backend.",
}));

const PERMISSIVE_SCHEMA = { type: "object" as const, properties: {} };

// ---------------------------------------------------------------- handlers

async function handleCall(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  switch (name) {
    case "navigate_page": {
      if (args.type === "back") {
        invalidateRefs();
        await callPanda("evaluate", { script: "history.back()" });
        currentUrl = null;
        return textResult("Navigated back");
      }
      const url = String(args.url ?? "");
      if (!url) return textResult("Missing URL", true);
      invalidateRefs();
      await callPanda("goto", { url });
      currentUrl = url;
      return textResult("Navigated successfully.");
    }
    case "new_page": {
      const url = String(args.url ?? "");
      if (!url) return textResult("Missing URL", true);
      invalidateRefs();
      await callPanda("goto", { url });
      currentUrl = url;
      return textResult("Navigated successfully.");
    }
    case "select_page": {
      // Lightpanda over stdio has a single session, so there is exactly one page.
      markStale();
      return textResult(`Selected page ${String(args.pageId ?? 0)}`);
    }
    case "close_page": {
      return textResult("Only one page exists on the Lightpanda backend", true);
    }
    case "take_snapshot":
      return textResult(await takeSnapshot());
    case "click": {
      const resultText = await runRefAction("click", String(args.uid ?? ""));
      // Panda's click reply includes the post-click URL — use it to detect a
      // navigation eagerly so a stale ref clicked right after never resolves
      // to an unrelated node on the new page.
      const m = resultText.match(/Page url:\s*([^\s,]+)/);
      if (m && currentUrl !== null && m[1] !== currentUrl) {
        invalidateRefs();
        currentUrl = m[1];
      }
      markStale();
      return textResult("Clicked element");
    }
    case "fill": {
      await runRefAction("fill", String(args.uid ?? ""), { value: String(args.value ?? "") });
      markStale();
      return textResult("Filled input");
    }
    case "hover": {
      await runRefAction("hover", String(args.uid ?? ""));
      markStale();
      return textResult("Hovered element");
    }
    case "press_key": {
      await callPanda("press", { key: String(args.key ?? "") });
      markStale();
      return textResult("Pressed key");
    }
    case "type_text": {
      const text = String(args.text ?? "");
      const script = [
        "(() => {",
        "  const el = document.activeElement;",
        "  if (!el || typeof el.value !== 'string') return null;",
        `  const t = ${JSON.stringify(text)};`,
        "  el.value = el.value + t;",
        "  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: t, inputType: 'insertText' }));",
        "  el.dispatchEvent(new Event('change', { bubbles: true }));",
        "  return el.value;",
        "})()",
      ].join("\n");
      await callPanda("evaluate", { script });
      markStale();
      return textResult("Typed text");
    }
    case "evaluate_script": {
      const script = toPandaScript(String(args.function ?? ""));
      const out = await callPanda("evaluate", { script });
      markStale();
      return textResult(out);
    }
    case "wait_for": {
      const target = Array.isArray(args.text) ? String(args.text[0] ?? "") : String(args.text ?? "");
      const script = `document.body && document.body.innerText.includes(${JSON.stringify(target)})`;
      await callPanda("waitForScript", { script });
      markStale();
      return textResult(`Waited for ${JSON.stringify(target)}`);
    }
    case "list_console_messages": {
      return textResult(await callPanda("consoleLogs", {}));
    }
    case "list_pages": {
      const url = (await currentPageUrl()) ?? "about:blank";
      return textResult(`0: ${url} [selected]`);
    }
    case "page_markdown": {
      return textResult(await callPanda("markdown", {}));
    }
    default:
      return unsupported(name);
  }
}

// ---------------------------------------------------------------- server

async function resolveLightpandaBin(argv: string[]): Promise<string | null> {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--lightpanda-bin" && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith("--lightpanda-bin=")) return argv[i].slice("--lightpanda-bin=".length);
  }
  return detectLightpanda();
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const lightpandaBin = await resolveLightpandaBin(argv);

  // Connect to lightpanda up front. If it is missing we still serve tools/list
  // so the CLI can introspect, and every call surfaces a clear error instead of
  // a mysterious bridge crash.
  if (lightpandaBin) {
    const transport = new StdioClientTransport({
      command: lightpandaBin,
      args: ["mcp"],
      stderr: "inherit",
    });
    const client = new Client({ name: "panda-mcp-adapter", version: SHIM_VERSION });
    try {
      await client.connect(transport);
      pandaClient = client;
    } catch (error) {
      process.stderr.write(
        `[panda-mcp-adapter] Failed to connect to lightpanda (${lightpandaBin}): ${errorMessageOf(error)}\n`,
      );
    }
  } else {
    process.stderr.write(
      "[panda-mcp-adapter] lightpanda not found — set OPERA_CLI_LIGHTPANDA_BIN or install `lightpanda`.\n",
    );
  }

  const server = new Server(
    { name: "panda-mcp-adapter", version: SHIM_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...SUPPORTED_TOOLS, ...UNSUPPORTED_TOOLS].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: PERMISSIVE_SCHEMA,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleCall(name, (args ?? {}) as Record<string, unknown>);
    } catch (error) {
      return textResult(errorMessageOf(error), true);
    }
  });

  const shutdown = async () => {
    await server.close();
    await pandaClient?.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}