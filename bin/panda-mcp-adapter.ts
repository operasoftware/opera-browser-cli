#!/usr/bin/env node
import { main } from "../src/panda-mcp-adapter.js";

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[panda-mcp-adapter] Fatal: ${message}\n`);
  process.exit(1);
});