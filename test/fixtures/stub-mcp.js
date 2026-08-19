/**
 * A minimal MCP server over stdio, standing in for opera-devtools-mcp.
 *
 * Speaks just enough of the protocol for the bridge to complete `connect()`
 * and `listTools()`, so the real bridge lifecycle can be tested end to end
 * without launching a browser. Point OPERA_CLI_MCP_BIN at this file.
 *
 * Note: the MCP SDK's stdio transport passes the child a filtered allowlist of
 * environment variables, not the parent's full environment — so this stub
 * cannot be configured through env vars from a test. Failure paths are tested
 * by pointing OPERA_CLI_MCP_BIN somewhere else instead.
 */

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue; // notification — nothing to answer

    switch (message.method) {
      case "initialize":
        reply(message.id, {
          // Echo the client's protocol version so we never fail its check.
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {}, logging: {} },
          serverInfo: { name: "stub-mcp", version: "0.0.0" },
        });
        break;
      case "tools/list":
        reply(message.id, {
          tools: [
            {
              name: "take_snapshot",
              description: "stub",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
        break;
      case "tools/call": {
        const name = message.params?.name ?? "";
        const result = { content: [{ type: "text", text: `stub:${name}` }] };
        // Opera AI tools are slow in reality. Holding the response open lets a
        // test kill the bridge *during* a call rather than before it.
        if (name.startsWith("opera_")) {
          setTimeout(() => reply(message.id, result), 3_000);
        } else {
          reply(message.id, result);
        }
        break;
      }
      default:
        reply(message.id, {});
    }
  }
});

// Stay alive until the bridge closes our stdin.
process.stdin.on("end", () => process.exit(0));
