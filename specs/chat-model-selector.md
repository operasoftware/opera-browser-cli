# Chat Model Selector

**Status:** Planned  
**Date:** 2026-05-25  
**Scope:** `opera-browser-cli` CLI + `opera-devtools-mcp` MCP layer + CDP contract for browser team

## Overview

Add a model selector to the Opera CLI Chat feature, allowing users to choose which AI model is used for chat sessions. The browser does not yet support model selection via CDP — this spec defines the full client-side implementation and the CDP contract the browser team must fulfill.

## CLI UX

### `--model` flag on `chat`

```
opera-browser-cli chat --model <model-id> "What is on this page?"
opera-browser-cli chat "Hello"                  # no flag → browser default
```

When `--model` is omitted, no model field is sent in the CDP payload — the browser uses its own default.

### `models` command

New top-level command to discover available models:

```
opera-browser-cli models
```

Output:

```
Available models:
  * gpt-4o (default)
    claude-sonnet-4
    gemini-2.5-pro
```

The `*` marks the browser's reported default model.

### Error handling

| Scenario | Behavior |
|----------|----------|
| `--model` with invalid ID | Surface browser error: `Model "foo" is not available. Run "opera-browser-cli models" to see available models.` |
| `models` command when browser doesn't support listing | `Model listing not supported by connected browser. Upgrade Opera or check connection.` |
| `--model` when browser doesn't support model param | Forward the field; if browser errors, surface it with upgrade hint |

## CDP Contract (Requirements for Browser Team)

### New method: `Opera.getAvailableModels`

Returns the list of AI models available for chat.

**Request:** No parameters.

```json
{ "method": "Opera.getAvailableModels" }
```

**Response:**

```json
{
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o", "isDefault": true },
    { "id": "claude-sonnet-4", "name": "Claude Sonnet 4", "isDefault": false },
    { "id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "isDefault": false }
  ]
}
```

**Model object schema:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable identifier used in `--model` flag and `dispatchAction` payload |
| `name` | `string` | Human-readable display name for CLI output |
| `isDefault` | `boolean` | Exactly one model has `isDefault: true` — the browser's current default |

### Extended `Opera.dispatchAction` payload for chat

Current (unchanged when no model specified):

```json
{ "action": "chat", "prompt": "Hello" }
```

With model selection:

```json
{ "action": "chat", "prompt": "Hello", "model": "claude-sonnet-4" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | `"chat"` |
| `prompt` | `string` | Yes | User's message |
| `model` | `string` | No | Model ID from `getAvailableModels`. Omit to use browser default. |

### Error response for invalid model

When `model` is provided but not recognized:

```json
{
  "error": "MODEL_NOT_AVAILABLE",
  "message": "Model \"foo\" is not available",
  "availableModels": ["gpt-4o", "claude-sonnet-4", "gemini-2.5-pro"]
}
```

## MCP Layer Changes (opera-devtools-mcp)

### Updated `opera_chat` tool

Add optional `model` parameter to the schema:

```typescript
schema: {
  prompt: zod.string().describe('The prompt to send to Opera AI.'),
  model: zod.string().optional().describe('Model ID to use. Omit for browser default.'),
}
```

Handler passes `model` through to CDP:

```typescript
handler: async (request, response) => {
  const session = getCDPSession(request.page.pptrPage);
  const result = await dispatchAction(session, {
    action: 'chat',
    prompt: request.params.prompt,
    ...(request.params.model && { model: request.params.model }),
  });
  response.appendResponseLine(result);
}
```

### New `opera_list_models` tool

```typescript
definePageTool({
  name: 'opera_list_models',
  description: 'List available AI models for Opera chat.',
  blockedByDialog: false,
  annotations: {
    category: ToolCategory.OPERA,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response) => {
    const session = getCDPSession(request.page.pptrPage);
    const result = await session.send('Opera.getAvailableModels');
    response.appendResponseLine(JSON.stringify(result));
  },
});
```

## CLI Layer Changes (opera-browser-cli)

### Updated `handleChat`

1. Parse `--model <id>` from args before joining remaining tokens as prompt
2. Pass `{ prompt, model }` (model omitted if not specified) to `callTool("opera_chat", ...)`
3. On `MODEL_NOT_AVAILABLE` error, format a helpful message with hint to run `models`

### New `handleModels` command

1. Call `callTool("opera_list_models", {})`
2. Parse JSON response
3. Format as bulleted list: `* <name> (default)` for default model, `  <name>` for others
4. Register as top-level command in the command dispatch map

### Command registration

```typescript
models: handleModels,
```

### CLI help text

The `chat` command help is updated to include the `--model` flag:

```
usage: opera-browser-cli chat [--model <model-id>] <prompt>

Send a chat message to the Opera AI.

args:
  <prompt>  Message to send (required)

options:
  --model <model-id>  AI model to use (run "opera-browser-cli models" to list)

examples:
  opera-browser-cli chat "Hello, who are you?"
  opera-browser-cli chat --model claude-sonnet-4 "Summarize this page"
```

The `models` command help:

```
usage: opera-browser-cli models

List available AI models for chat.

examples:
  opera-browser-cli models
```

Both commands are listed in the top-level help alongside existing AI commands.

## Scope boundaries

- `--model` applies to `chat` only (not `invoke-do`, `make`, `research`) — extensible later
- No client-side model persistence — each invocation is stateless
- No interactive model picker — discovery via `models` command, selection via `--model` flag
- Graceful degradation when connected browser doesn't support the new CDP methods

## Future extensions

- Extend `--model` to other AI commands (`invoke-do`, `make`, `research`)
- Add `--model` to the `research` command's `researchType`-style options
- Persist a default model preference client-side (e.g. `opera-browser-cli config set model <id>`)
