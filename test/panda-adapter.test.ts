/**
 * Unit tests for the panda adapter shim's pure logic: the semantic-tree parser
 * and the a11y-format serializer that back the whole `@X.Y` ref contract.
 */

import { describe, expect, it } from "vitest";
import {
  mapRole,
  parsePandaTree,
  parseTreeLine,
  serializeNodes,
  toPandaScript,
} from "../src/panda-mcp-adapter.js";

const SAMPLE_TREE = [
  "1 RootWebArea 'Test Page'",
  " 4 heading 'Welcome'",
  " 5 paragraph",
  "  6 'Some intro text.'",
  " 7 [i] link 'About us'",
  " 8 form",
  "  9 [i] textbox 'Search'",
  "  10 [i] checkbox value='on' [checked]",
  "  11 [i] combobox value='a' options=['a','b']",
  "  12 [i:disabled] button 'Go'",
].join("\n");

describe("parseTreeLine", () => {
  it("parses the root with a role and name", () => {
    const { depth, node } = parseTreeLine("1 RootWebArea 'Test Page'");
    expect(depth).toBe(0);
    expect(node).toMatchObject({
      backendNodeId: 1,
      role: "RootWebArea",
      name: "Test Page",
      value: null,
      interactive: false,
      checked: null,
    });
  });

  it("uses one space per depth level", () => {
    expect(parseTreeLine(" 4 heading 'Welcome'").depth).toBe(1);
    expect(parseTreeLine("  6 'text'").depth).toBe(2);
  });

  it("parses a text-only node (no role) as a bare quoted string", () => {
    const { node } = parseTreeLine("  6 'Some intro text.'");
    expect(node.role).toBe("");
    expect(node.name).toBe("Some intro text.");
  });

  it("parses an interactive node with flag", () => {
    const { node } = parseTreeLine(" 7 [i] link 'About us'");
    expect(node.role).toBe("link");
    expect(node.name).toBe("About us");
    expect(node.interactive).toBe(true);
    expect(node.disabled).toBe(false);
  });

  it("parses a disabled interactive node", () => {
    const { node } = parseTreeLine(" 12 [i:disabled] button 'Go'");
    expect(node.interactive).toBe(true);
    expect(node.disabled).toBe(true);
  });

  it("parses a checkbox with value and checked state", () => {
    const { node } = parseTreeLine("  10 [i] checkbox value='on' [checked]");
    expect(node.role).toBe("checkbox");
    expect(node.value).toBe("on");
    expect(node.checked).toBe(true);
  });

  it("parses a combobox with value and ignores its options list", () => {
    const { node } = parseTreeLine("  11 [i] combobox value='a' options=['a','b']");
    expect(node.role).toBe("combobox");
    expect(node.value).toBe("a");
    expect(node.checked).toBeNull();
  });

  it("parses an unchecked state", () => {
    const { node } = parseTreeLine(" 1 [i] checkbox [unchecked]");
    expect(node.checked).toBe(false);
  });
});

describe("parsePandaTree", () => {
  it("parses a full tree in document order", () => {
    const nodes = parsePandaTree(SAMPLE_TREE);
    expect(nodes.map((n) => n.backendNodeId)).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(nodes[0].depth).toBe(0);
    expect(nodes[1].depth).toBe(1);
    expect(nodes[3].depth).toBe(2);
  });
});

describe("mapRole", () => {
  it("maps text-only roles to StaticText", () => {
    for (const role of ["", "none", "generic", "StaticText"]) {
      expect(mapRole(role)).toBe("StaticText");
    }
  });

  it("passes through Chrome-style lowercase roles unchanged", () => {
    expect(mapRole("link")).toBe("link");
    expect(mapRole("textbox")).toBe("textbox");
    expect(mapRole("heading")).toBe("heading");
  });

  it("keeps the CamelCase root role", () => {
    expect(mapRole("RootWebArea")).toBe("RootWebArea");
  });
});

describe("serializeNodes", () => {
  it("assigns uids with page and element numbers, url only on the root", () => {
    const { text } = serializeNodes(parsePandaTree(SAMPLE_TREE), "https://example.com/", new Map(), 1, 1);
    const lines = text.split("\n");
    expect(lines[0]).toBe('uid=1_1 RootWebArea "Test Page" url="https://example.com/"');
    expect(lines[1]).toMatch(/^\s\suid=1_2 heading "Welcome"$/);
    // Only the root line carries url=.
    expect(lines.filter((l) => l.includes("url="))).toHaveLength(1);
  });

  it("emits value, checked, and focusable attributes", () => {
    const nodes = parsePandaTree(SAMPLE_TREE);
    const { text } = serializeNodes(nodes, null, new Map(), 1, 1);
    expect(text).toContain('value="on" checked focusable');
    expect(text).toContain('textbox "Search" focusable');
  });

  it("indents two spaces per depth", () => {
    const nodes = parsePandaTree(SAMPLE_TREE);
    const { text } = serializeNodes(nodes, null, new Map(), 1, 1);
    const textNode = text.split("\n").find((l) => l.includes("Some intro text"));
    expect(textNode).toBe('    uid=1_4 StaticText "Some intro text."');
  });

  it("reuses uids for stable backendNodeIds across refreshes", () => {
    const nodes = parsePandaTree(SAMPLE_TREE);
    const first = serializeNodes(nodes, null, new Map(), 1, 1);
    // Refresh with the same nodes: every backendNodeId must keep its uid.
    const second = serializeNodes(nodes, null, first.backendToUid, first.nextId, 1);
    expect(second.uidToBackend).toEqual(first.uidToBackend);
    expect(second.text).toBe(first.text);
  });

  it("returns the uid -> backendNodeId map for action resolution", () => {
    const nodes = parsePandaTree(SAMPLE_TREE);
    const { uidToBackend } = serializeNodes(nodes, null, new Map(), 1, 2);
    expect(uidToBackend.get("2_2")).toBe(4); // heading
    expect(uidToBackend.get("2_5")).toBe(7); // link
  });
});

describe("toPandaScript", () => {
  it("unwraps the CLI's `() => (EXPR)` expression wrapper", () => {
    expect(toPandaScript("() => (document.title)")).toBe("return (document.title)");
  });

  it("invokes real function literals", () => {
    expect(toPandaScript("function(){ return 42 }")).toBe("return (function(){ return 42 })()");
    expect(toPandaScript("(x) => x * 2")).toBe("return ((x) => x * 2)()");
  });

  it("runs bare calls and expressions as-is", () => {
    expect(toPandaScript("window.scrollBy(0, 500)")).toBe("return (window.scrollBy(0, 500))");
    expect(toPandaScript("new Promise(r => setTimeout(r, 300))")).toBe(
      "return (new Promise(r => setTimeout(r, 300)))",
    );
  });
});