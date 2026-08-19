/**
 * A stub MCP that always answers with opera-devtools-mcp's "no browser to
 * talk to" result — standing in for a bridge pointed at a dead/closed browser.
 * The bridge stays healthy (stdio up), but every tool reports unreachable.
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
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    switch (message.method) {
      case "initialize":
        reply(message.id, {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {}, logging: {} },
          serverInfo: { name: "stub-mcp-unreachable", version: "0.0.0" },
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
        const text =
          "Could not connect to Chrome. Check if Chrome is running. " +
          "Cause: Failed to fetch browser webSocket URL from http://127.0.0.1:59999/json/version: fetch failed";
        reply(message.id, { content: [{ type: "text", text }] });
        break;
      }
      default:
        reply(message.id, {});
    }
  }
});
process.stdin.on("end", () => process.exit(0));
