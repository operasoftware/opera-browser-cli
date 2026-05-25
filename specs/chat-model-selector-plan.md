# Chat Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--model` flag to the `chat` command and a new `models` command for discovering available AI models.

**Architecture:** Extend the existing CDP → MCP → CLI pipeline. Add optional `model` field to `opera_chat` MCP tool, add new `opera_list_models` MCP tool, thread both through the CLI with arg parsing modeled after the existing `--type` flag on `research`.

**Tech Stack:** TypeScript, Zod (MCP schemas), Vitest (tests), axi-sdk-js (CLI framework)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `opera-devtools-mcp/src/tools/opera.ts` | Modify | Add `model` param to `operaChat`, add `operaListModels` tool |
| `opera-devtools-mcp/src/bin/chrome-devtools-cli-options.ts` | Modify | Add `model` arg to `opera_chat`, add `opera_list_models` entry |
| `opera-browser-cli/src/cli.ts` | Modify | Add `parseChatArgs`, update `handleChat`, add `handleModels`, update help text |
| `opera-browser-cli/test/cli.test.ts` | Modify | Add tests for `parseChatArgs` |

---

### Task 1: Add `model` parameter to `opera_chat` MCP tool

**Files:**
- Modify: `opera-devtools-mcp/src/tools/opera.ts:121-148`

- [ ] **Step 1: Add `model` to the schema**

In `opera-devtools-mcp/src/tools/opera.ts`, update the `operaChat` definition:

```typescript
export const operaChat = definePageTool({
  name: 'opera_chat',
  description:
    "Send a chat prompt to Opera's built-in AI and return the response. Only available when connected to Opera Neon.",
  blockedByDialog: false,
  annotations: {
    category: ToolCategory.OPERA,
    readOnlyHint: false,
  },
  schema: {
    prompt: zod.string().describe('The prompt to send to Opera AI.'),
    model: zod
      .string()
      .optional()
      .describe(
        'Model ID to use for the chat. Omit to use the browser default. Use opera_list_models to discover available IDs.',
      ),
  },
  handler: async (request, response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = getCDPSession(request.page.pptrPage as any);
    try {
      const payload: Record<string, unknown> = {
        action: 'chat',
        prompt: request.params.prompt,
      };
      if (request.params.model !== undefined) {
        payload['model'] = request.params.model;
      }
      const result = await dispatchAction(session, payload);
      response.appendResponseLine(result);
    } catch (e) {
      response.appendResponseLine(
        `Opera.dispatchAction(chat) failed with error: ${(e as Error).message}`,
      );
    }
  },
});
```

- [ ] **Step 2: Verify the MCP package compiles**

Run: `cd opera-devtools-mcp && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add opera-devtools-mcp/src/tools/opera.ts
git commit -m "feat(mcp): add optional model param to opera_chat tool"
```

---

### Task 2: Add `opera_list_models` MCP tool

**Files:**
- Modify: `opera-devtools-mcp/src/tools/opera.ts` (append after `operaResearch`)

- [ ] **Step 1: Add the tool definition**

Append to `opera-devtools-mcp/src/tools/opera.ts`:

```typescript
export const operaListModels = definePageTool({
  name: 'opera_list_models',
  description:
    'List available AI models for Opera chat. Returns model IDs, display names, and which is the default.',
  blockedByDialog: false,
  annotations: {
    category: ToolCategory.OPERA,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = getCDPSession(request.page.pptrPage as any);
    try {
      const result = await session.send('Opera.getAvailableModels');
      response.appendResponseLine(JSON.stringify(result));
    } catch (e) {
      response.appendResponseLine(
        `Opera.getAvailableModels failed with error: ${(e as Error).message}`,
      );
    }
  },
});
```

- [ ] **Step 2: Verify the MCP package compiles**

Run: `cd opera-devtools-mcp && npm run build`
Expected: Build succeeds. The new tool is auto-registered via `Object.values(operaTools)` in `tools.ts`.

- [ ] **Step 3: Commit**

```bash
git add opera-devtools-mcp/src/tools/opera.ts
git commit -m "feat(mcp): add opera_list_models tool"
```

---

### Task 3: Update generated CLI options for MCP package

**Files:**
- Modify: `opera-devtools-mcp/src/bin/chrome-devtools-cli-options.ts:469-481`

- [ ] **Step 1: Add `model` arg to `opera_chat` and add `opera_list_models` entry**

Update the `opera_chat` entry in `chrome-devtools-cli-options.ts`:

```typescript
  opera_chat: {
    description:
      "Send a chat prompt to Opera's built-in AI and return the response. Only available when connected to Opera Neon.",
    category: 'Opera',
    args: {
      prompt: {
        name: 'prompt',
        type: 'string',
        description: 'The prompt to send to Opera AI.',
        required: true,
      },
      model: {
        name: 'model',
        type: 'string',
        description:
          'Model ID to use for the chat. Omit to use the browser default. Use opera_list_models to discover available IDs.',
        required: false,
      },
    },
  },
```

Add a new entry for `opera_list_models` (insert alphabetically near the other `opera_` entries):

```typescript
  opera_list_models: {
    description:
      'List available AI models for Opera chat. Returns model IDs, display names, and which is the default.',
    category: 'Opera',
    args: {},
  },
```

- [ ] **Step 2: Verify build**

Run: `cd opera-devtools-mcp && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add opera-devtools-mcp/src/bin/chrome-devtools-cli-options.ts
git commit -m "feat(mcp): update generated CLI options for model selector"
```

---

### Task 4: Add `parseChatArgs` with tests (CLI layer)

**Files:**
- Modify: `opera-browser-cli/src/cli.ts` (add export `parseChatArgs`)
- Modify: `opera-browser-cli/test/cli.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Add to `opera-browser-cli/test/cli.test.ts`:

```typescript
import { parseChatArgs } from "../src/cli.js";

describe("parseChatArgs", () => {
  it("parses prompt only", () => {
    const result = parseChatArgs(["Hello", "world"]);
    expect(result).toEqual({ prompt: "Hello world", model: undefined });
  });

  it("parses --model flag with prompt", () => {
    const result = parseChatArgs(["--model", "gpt-4o", "What", "is", "this?"]);
    expect(result).toEqual({ prompt: "What is this?", model: "gpt-4o" });
  });

  it("parses --model at end of args", () => {
    const result = parseChatArgs(["Hello", "--model", "claude-sonnet-4"]);
    expect(result).toEqual({ prompt: "Hello", model: "claude-sonnet-4" });
  });

  it("returns empty prompt when only --model is given", () => {
    const result = parseChatArgs(["--model", "gpt-4o"]);
    expect(result).toEqual({ prompt: "", model: "gpt-4o" });
  });

  it("ignores --model without a value", () => {
    const result = parseChatArgs(["Hello", "--model"]);
    expect(result).toEqual({ prompt: "Hello", model: undefined });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd opera-browser-cli && npx vitest run test/cli.test.ts`
Expected: FAIL — `parseChatArgs` is not exported from `../src/cli.js`

- [ ] **Step 3: Implement `parseChatArgs`**

Add to `opera-browser-cli/src/cli.ts` (near `parseResearchArgs`):

```typescript
export function parseChatArgs(args: string[]): {
  prompt: string;
  model?: string;
} {
  let model: string | undefined;
  const promptParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else {
      promptParts.push(args[i]);
    }
  }
  return { prompt: promptParts.join(" "), model };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd opera-browser-cli && npx vitest run test/cli.test.ts`
Expected: All `parseChatArgs` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add opera-browser-cli/src/cli.ts opera-browser-cli/test/cli.test.ts
git commit -m "feat(cli): add parseChatArgs for --model flag"
```

---

### Task 5: Update `handleChat` to use `parseChatArgs`

**Files:**
- Modify: `opera-browser-cli/src/cli.ts:2229-2239`

- [ ] **Step 1: Update `handleChat`**

Replace the current `handleChat` function:

```typescript
async function handleChat(args: string[]): Promise<string> {
  const { prompt, model } = parseChatArgs(args);
  if (!prompt) {
    throw new CdpError("Missing prompt", "VALIDATION_ERROR", [
      'Run `opera-browser-cli chat "What is on this page?"` to chat with Opera AI',
      "Use --model <id> to select a model (run `opera-browser-cli models` to list)",
    ]);
  }
  const toolArgs: Record<string, unknown> = { prompt };
  if (model !== undefined) {
    toolArgs["model"] = model;
  }
  const result = await callAiTool("chat", "opera_chat", toolArgs);
  checkAiResultForSignInError("chat", result);
  return formatMcpResult("result", result, []);
}
```

- [ ] **Step 2: Verify build**

Run: `cd opera-browser-cli && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add opera-browser-cli/src/cli.ts
git commit -m "feat(cli): wire --model flag into handleChat"
```

---

### Task 6: Add `handleModels` command

**Files:**
- Modify: `opera-browser-cli/src/cli.ts` (add handler + register command)

- [ ] **Step 1: Add `handleModels` function**

Add near the other AI command handlers in `opera-browser-cli/src/cli.ts`:

```typescript
async function handleModels(): Promise<string> {
  let raw: string;
  try {
    raw = await callTool("opera_list_models", {});
  } catch (error) {
    if (error instanceof CdpError) {
      throw new CdpError(
        "Model listing not supported by connected browser. Upgrade Opera or check connection.",
        "UNSUPPORTED_OPERATION",
        ['Run `opera-browser-cli doctor` to check the connection'],
      );
    }
    throw error;
  }
  const data = JSON.parse(raw) as {
    models: Array<{ id: string; name: string; isDefault: boolean }>;
  };
  const lines = ["Available models:"];
  for (const m of data.models) {
    const marker = m.isDefault ? "* " : "  ";
    const suffix = m.isDefault ? " (default)" : "";
    lines.push(`  ${marker}${m.id}${suffix}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Register the command in the dispatch map**

In the `commands` object (around line 2454), add:

```typescript
  models: withoutFullFlag(handleModels),
```

- [ ] **Step 3: Verify build**

Run: `cd opera-browser-cli && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add opera-browser-cli/src/cli.ts
git commit -m "feat(cli): add models command for listing available AI models"
```

---

### Task 7: Update CLI help text

**Files:**
- Modify: `opera-browser-cli/src/cli.ts` (help strings)

- [ ] **Step 1: Update `chat` help text**

Replace the `chat` entry in the `HELP` object:

```typescript
  chat: `usage: opera-browser-cli chat [--model <model-id>] <prompt>
Send a chat message to the Opera AI.

args:
  <prompt>  Message to send (required)

options:
  --model <model-id>  AI model to use (run "opera-browser-cli models" to list)

examples:
  opera-browser-cli chat "Hello, who are you?"
  opera-browser-cli chat --model claude-sonnet-4 "Summarize this page"`,
```

- [ ] **Step 2: Add `models` help text**

Add a new entry to the `HELP` object:

```typescript
  models: `usage: opera-browser-cli models
List available AI models for chat.

examples:
  opera-browser-cli models`,
```

- [ ] **Step 3: Update `TOP_HELP` command list**

In the `TOP_HELP` string, update the command listing line that contains `chat`:

From:
```
  chat <prompt>, invoke-do <prompt>, make <prompt>, research <prompt>,
```

To:
```
  chat [--model <id>] <prompt>, invoke-do <prompt>, make <prompt>,
  research <prompt>, models,
```

- [ ] **Step 4: Update the `opera ai:` section of `TOP_HELP`**

From:
```
opera ai:
  chat is available on any Opera browser.
  invoke-do, make, and research require Opera Neon with an active sign-in.
```

To:
```
opera ai:
  chat is available on any Opera browser. Use --model to select a model.
  Run "models" to list available models.
  invoke-do, make, and research require Opera Neon with an active sign-in.
```

- [ ] **Step 5: Verify build and existing help tests still pass**

Run: `cd opera-browser-cli && npx vitest run test/cli.test.ts`
Expected: All tests pass (the `getCommandHelp` tests should still work).

- [ ] **Step 6: Commit**

```bash
git add opera-browser-cli/src/cli.ts
git commit -m "docs(cli): update help text for --model flag and models command"
```

---

### Task 8: Update CLAUDE.md specs table

**Files:**
- Modify: `opera-browser-cli/CLAUDE.md`

- [ ] **Step 1: Add the new spec to the table**

Update the specs table in `opera-browser-cli/CLAUDE.md`:

```markdown
| Spec | Status |
|---|---|
| [`specs/fix-parallel-streaming-routing.md`](specs/fix-parallel-streaming-routing.md) | Planned — parallel chunk routing for concurrent Opera AI calls |
| [`specs/chat-model-selector.md`](specs/chat-model-selector.md) | Planned — model selector for chat command |
```

- [ ] **Step 2: Commit**

```bash
git add opera-browser-cli/CLAUDE.md
git commit -m "docs: add chat-model-selector spec to CLAUDE.md"
```
