import { describe, it, expect } from "vitest";
import {
  countRefs,
  extractRefs,
  extractTitle,
  isInputType,
  truncateSnapshot,
  truncateText,
  compactSnapshot,
  refToDisplay,
  refToMcp,
  cleanUrl,
  extractPageOrigin,
  applyUrlLut,
  resolveUrl,
  collapseLandmarks,
  extractSubtree,
  diffSnapshots,
  rootLineOf,
  windowSnapshot,

} from "../src/snapshot.js";

describe("countRefs", () => {
  it("counts uid= occurrences in raw form", () => {
    const snapshot = `RootWebArea "Example"
  uid=1 button "Submit"
  uid=2 textbox "Name"
  uid=3 link "Home"`;
    expect(countRefs(snapshot)).toBe(3);
  });

  it("counts @X.Y refs in compact form", () => {
    const snapshot = `@1.0 root "Example"
  @1.1 button "Submit"
  @1.2 textbox "Name"`;
    expect(countRefs(snapshot)).toBe(3);
  });

  it("returns 0 for no refs", () => {
    expect(countRefs('RootWebArea "Empty"')).toBe(0);
  });
});

describe("extractRefs", () => {
  it("extracts ref info from raw uid= lines", () => {
    const snapshot = `  uid=1 button "Submit"
  uid=2 textbox "Name"`;
    const refs = extractRefs(snapshot);
    expect(refs).toEqual([
      { ref: "1", type: "button", label: "Submit" },
      { ref: "2", type: "textbox", label: "Name" },
    ]);
  });

  it("extracts ref info from compact @X.Y lines and normalises to display form", () => {
    const snapshot = `  @2.1 button "Submit"
  @2.2 textbox "Name"`;
    const refs = extractRefs(snapshot);
    expect(refs).toEqual([
      { ref: "2.1", type: "button", label: "Submit" },
      { ref: "2.2", type: "textbox", label: "Name" },
    ]);
  });

  it("normalises uid=X_Y refs to display form", () => {
    const refs = extractRefs('  uid=2_4 button "Go"');
    expect(refs[0].ref).toBe("2.4");
  });
});

describe("extractTitle", () => {
  it("extracts title from RootWebArea", () => {
    expect(extractTitle('RootWebArea "My Page"')).toBe("My Page");
  });

  it("extracts title from compact root", () => {
    expect(extractTitle('@1.0 root "My Page" url="https://example.com"')).toBe("My Page");
  });

  it("extracts title from compact markdown heading", () => {
    expect(extractTitle("@1.1 # Welcome")).toBe("Welcome");
    expect(extractTitle("@1.2 ## Section")).toBe("Section");
  });

  it("falls back to heading", () => {
    expect(extractTitle('  heading "Welcome"')).toBe("Welcome");
  });

  it("returns empty for no title", () => {
    expect(extractTitle("div")).toBe("");
  });
});

describe("isInputType", () => {
  it("recognizes input types", () => {
    expect(isInputType("textbox")).toBe(true);
    expect(isInputType("searchbox")).toBe(true);
    expect(isInputType("textarea")).toBe(true);
  });

  it("rejects non-input types", () => {
    expect(isInputType("button")).toBe(false);
    expect(isInputType("link")).toBe(false);
  });
});

describe("truncateSnapshot", () => {
  it("returns snapshot unchanged when under limit", () => {
    const snapshot = 'RootWebArea "Short"\n  uid=1 button "OK"';
    const result = truncateSnapshot(snapshot, false, 4000);
    expect(result.text).toBe(snapshot);
    expect(result.truncated).toBe(false);
  });

  it("truncates at last newline before limit", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `  uid=${i} button "Btn ${i}"`,
    );
    const snapshot = `RootWebArea "Big"\n${lines.join("\n")}`;
    const result = truncateSnapshot(snapshot, false, 200);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.text).not.toMatch(/\n$/);
    expect(result.totalLength).toBe(snapshot.length);
  });

  it("returns full snapshot when full=true regardless of limit", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `  uid=${i} button "Btn ${i}"`,
    );
    const snapshot = `RootWebArea "Big"\n${lines.join("\n")}`;
    const result = truncateSnapshot(snapshot, true, 200);
    expect(result.text).toBe(snapshot);
    expect(result.truncated).toBe(false);
  });

  it("reports accurate totalLength", () => {
    const snapshot = "x".repeat(5000);
    const result = truncateSnapshot(snapshot, false, 100);
    expect(result.totalLength).toBe(5000);
  });
});

describe("truncateText", () => {
  it("returns text unchanged when under limit", () => {
    const text = "short text here";
    const result = truncateText(text, 8000);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  it("keeps head and tail when over limit", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `line ${i}: ${"x".repeat(50)}`,
    );
    const text = lines.join("\n");
    const result = truncateText(text, 500);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("line 0:");
    expect(result.text).toContain("line 99:");
    expect(result.text).toContain("chars omitted");
    expect(result.totalLength).toBe(text.length);
  });

  it("preserves tail content for grading visibility", () => {
    const head = "Year 1901\tAlice\nYear 1902\tBob\n";
    const middle = Array.from(
      { length: 100 },
      (_, i) => `Year ${1903 + i}\tPerson${i}`,
    ).join("\n");
    const tail = "\nYear 2023\tRecent Winner\nYear 2024\tLatest Winner";
    const text = head + middle + tail;
    const result = truncateText(text, 500);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("Year 2024");
    expect(result.text).toContain("Latest Winner");
  });

  it("reports accurate totalLength", () => {
    const text = "x".repeat(20000);
    const result = truncateText(text, 1000);
    expect(result.totalLength).toBe(20000);
  });

  it("skips truncation when result would be longer than original", () => {
    // Text barely over the limit — marker overhead would make it longer
    const text = "x".repeat(120);
    const result = truncateText(text, 100);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
    expect(result.totalLength).toBe(120);
  });
});

// --- refToDisplay / refToMcp ---

describe("refToDisplay / refToMcp", () => {
  it("converts MCP underscore refs to dot display form", () => {
    expect(refToDisplay("2_4")).toBe("2.4");
    expect(refToDisplay("12_181")).toBe("12.181");
    expect(refToDisplay("1")).toBe("1");
  });

  it("converts display refs back to MCP underscore form", () => {
    expect(refToMcp("2.4")).toBe("2.4".replace(/\./g, "_"));
    expect(refToMcp("12.181")).toBe("12_181");
    expect(refToMcp("@2.4")).toBe("2_4");
    expect(refToMcp("@2_4")).toBe("2_4");
    expect(refToMcp("2_4")).toBe("2_4");
  });

  it("round-trips correctly", () => {
    expect(refToMcp(refToDisplay("2_4"))).toBe("2_4");
    expect(refToMcp(refToDisplay("12_181"))).toBe("12_181");
  });
});

// --- compactSnapshot ---

describe("compactSnapshot", () => {
  it("drops LineBreak nodes", () => {
    const tree = `uid=1_0 root "Page"\n  uid=1_1 button "OK"\n  uid=1_2 LineBreak "\n"\n  uid=1_3 link "Home"`;
    const result = compactSnapshot(tree);
    expect(result).not.toContain("LineBreak");
    expect(result).toContain("button");
    expect(result).toContain("link");
  });

  it("drops whitespace-only StaticText nodes", () => {
    const tree = `uid=1_0 root "Page"\n  uid=1_1 StaticText " "\n  uid=1_2 button "OK"`;
    const result = compactSnapshot(tree);
    expect(result).not.toMatch(/StaticText "\s+"/);
    expect(result).toContain("button");
  });

  it("drops StaticText children that duplicate the parent label", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 link "Home" url="/"`,
      `    uid=1_2 StaticText "Home"`,
      `  uid=1_3 button "Submit"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    // StaticText "Home" should be gone; the link and button should remain
    expect(result).not.toMatch(/text "Home"/);
    expect(result).toContain('link "Home"');
    expect(result).toContain('button "Submit"');
  });

  it("keeps StaticText children whose label differs from the parent", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 link "Click here" url="/"`,
      `    uid=1_2 StaticText "go"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain("go");
  });

  it("collapses consecutive text siblings and drops when merged label echoes parent", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 link "[13]" url="/wiki/cite-13"`,
      `    uid=1_2 StaticText "["`,
      `    uid=1_3 StaticText "13"`,
      `    uid=1_4 StaticText "]"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain('link "[13]"');
    expect(result).not.toMatch(/text "\[/);
    expect(result).not.toMatch(/text "13"/);
    expect(result).not.toMatch(/text "\]"/);
    expect(result).not.toMatch(/text "\[13\]"/);
  });

  it("collapses consecutive text siblings and keeps when merged label differs from parent", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 link "World" url="/"`,
      `    uid=1_2 StaticText "Hel"`,
      `    uid=1_3 StaticText "lo"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain('link "World"');
    expect(result).toMatch(/text "Hello"/);
    expect(result).not.toMatch(/@1\.3/);
  });

  it("does not collapse text nodes at different indent levels", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 StaticText "A"`,
      `    uid=1_2 StaticText "B"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toMatch(/text "A"/);
    expect(result).toMatch(/text "B"/);
  });

  it("drops empty valuetext attribute", () => {
    const tree = `uid=1_0 slider "Volume" value="50" valuemax="100" valuemin="0" valuetext=""`;
    expect(compactSnapshot(tree)).not.toContain('valuetext=""');
  });

  it("drops disableable when disabled is present", () => {
    const tree = `uid=1_0 button "Go" disableable disabled`;
    expect(compactSnapshot(tree)).not.toContain("disableable");
    expect(compactSnapshot(tree)).toContain("disabled");
  });

  it("drops selectable on option and tab roles", () => {
    const tree = [
      `uid=1_0 option "Alpha" selectable value="a"`,
      `uid=1_1 tab "Home" selectable`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).not.toContain("selectable");
  });

  it("drops relevant='additions text'", () => {
    const tree = `uid=1_0 status live="polite" relevant="additions text"`;
    expect(compactSnapshot(tree)).not.toContain('relevant="additions text"');
  });

  it("drops atomic and default live= on alert/status", () => {
    const tree = [
      `uid=1_0 status atomic live="polite" relevant="additions text"`,
      `uid=1_1 alert atomic live="assertive" relevant="additions text"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).not.toContain("atomic");
    expect(result).not.toContain('live="polite"');
    expect(result).not.toContain('live="assertive"');
  });

  it("drops implied combobox attributes", () => {
    const tree = `uid=1_0 combobox "Country" expandable haspopup="menu" value="Poland"`;
    const result = compactSnapshot(tree);
    expect(result).not.toContain("haspopup");
    expect(result).not.toContain("expandable");
    expect(result).toContain('combobox "Country"');
  });

  it("drops orientation='horizontal'", () => {
    const tree = `uid=1_0 slider "Volume" orientation="horizontal" value="50"`;
    expect(compactSnapshot(tree)).not.toContain("orientation");
  });

  it("drops autocomplete attribute", () => {
    const tree = `uid=1_0 combobox "Search" autocomplete="both"`;
    expect(compactSnapshot(tree)).not.toContain("autocomplete");
  });

  it("renames PascalCase role names to compact lowercase forms", () => {
    const tree = [
      `uid=1_0 RootWebArea "Page"`,
      `  uid=1_1 StaticText "Hello"`,
      `  uid=1_2 DisclosureTriangle "Details" expandable`,
      `  uid=1_3 ColorWell "Colour" value="#ff0000"`,
      `  uid=1_4 InputTime "Appt"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain("root");
    expect(result).toContain("text");
    expect(result).toContain("disclosure");
    expect(result).toContain("color");
    expect(result).toContain("time");
    expect(result).not.toContain("RootWebArea");
    expect(result).not.toContain("StaticText");
    expect(result).not.toContain("DisclosureTriangle");
    expect(result).not.toContain("ColorWell");
    expect(result).not.toContain("InputTime");
  });

  it("strips quotes from numeric attribute values", () => {
    const tree = `uid=1_0 spinbutton "Qty" value="3" valuemin="1" valuemax="10"`;
    const result = compactSnapshot(tree);
    expect(result).toContain("value=3");
    expect(result).toContain("valuemin=1");
    expect(result).toContain("valuemax=10");
    expect(result).not.toContain('value="3"');
  });

  it("converts headings to markdown style", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 heading "Section One" level="1"`,
      `  uid=1_2 heading "Subsection" level="2"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain("# Section One");
    expect(result).toContain("## Subsection");
    expect(result).not.toContain('heading "');
    expect(result).not.toContain("level=");
  });

  it("rewrites uid=PAGE_ELEM refs to @PAGE.ELEM display form", () => {
    const tree = `uid=2_4 button "Submit"`;
    const result = compactSnapshot(tree);
    expect(result).toContain("@2.4");
    expect(result).not.toContain("uid=");
  });

  it("processes a realistic multi-element tree and is shorter than the original", () => {
    const tree = [
      `uid=2_0 RootWebArea "Test Page" url="file:///test.html"`,
      `  uid=2_1 heading "Test Page" level="1"`,
      `  uid=2_2 region "Links"`,
      `    uid=2_3 link "Home" url="/"`,
      `      uid=2_4 StaticText "Home"`,
      `    uid=2_5 StaticText " "`,
      `    uid=2_6 LineBreak "\n"`,
      `  uid=2_7 region "Form"`,
      `    uid=2_8 combobox "Country" expandable haspopup="menu" value="Poland"`,
      `      uid=2_9 option "Poland" selectable selected value="Poland"`,
      `      uid=2_10 option "Germany" selectable value="Germany"`,
      `    uid=2_11 status atomic live="polite" relevant="additions text"`,
      `      uid=2_12 StaticText "Ready."`,
    ].join("\n");

    const result = compactSnapshot(tree);

    // Ref format
    expect(result).not.toContain("uid=");
    expect(result).toContain("@2.0");

    // Role renames
    expect(result).not.toContain("RootWebArea");
    expect(result).not.toContain("StaticText");
    expect(result).not.toContain("LineBreak");

    // Noise removal
    expect(result).not.toContain("selectable");
    expect(result).not.toContain("atomic");
    expect(result).not.toContain("expandable");
    expect(result).not.toContain('live="polite"');
    expect(result).not.toContain('relevant=');

    // Markdown headings
    expect(result).toContain("# Test Page");

    // Shorter overall
    expect(result.length).toBeLessThan(tree.length);
  });
});

// --- cleanUrl ---

describe("cleanUrl", () => {
  it("returns null for javascript: URLs", () => {
    expect(cleanUrl("javascript:void(0)", null)).toBeNull();
    expect(cleanUrl("javascript:doStuff()", "https://x.com")).toBeNull();
  });

  it("returns null for data: URLs", () => {
    expect(cleanUrl("data:image/png;base64,abc123", null)).toBeNull();
    expect(cleanUrl("data:text/html,<h1>hi</h1>", "https://x.com")).toBeNull();
  });

  it("strips matching page origin", () => {
    expect(cleanUrl("https://example.com/foo", "https://example.com")).toBe("/foo");
  });

  it("returns / when URL is exactly the origin", () => {
    expect(cleanUrl("https://example.com", "https://example.com")).toBe("/");
  });

  it("does not strip a different origin", () => {
    expect(cleanUrl("https://other.com/foo", "https://example.com")).toBe(
      "https://other.com/foo",
    );
  });

  it("leaves absolute URL unchanged when origin is null", () => {
    expect(cleanUrl("https://example.com/foo?q=bar", null)).toBe(
      "https://example.com/foo?q=bar",
    );
  });

  it("drops Google Analytics UTM params", () => {
    expect(cleanUrl("/p?id=1&utm_source=nl&utm_medium=email&utm_campaign=spring", null)).toBe(
      "/p?id=1",
    );
  });

  it("drops Google Ads click IDs (gclid, gbraid, wbraid, dclid, gad_source)", () => {
    expect(cleanUrl("/p?q=x&gclid=abc&gbraid=def&wbraid=ghi&dclid=jkl&gad_source=1", null)).toBe(
      "/p?q=x",
    );
  });

  it("drops social platform click IDs (fbclid, msclkid, yclid, igshid, ttclid, twclid)", () => {
    expect(
      cleanUrl("/p?id=1&fbclid=a&msclkid=b&yclid=c&igshid=d&ttclid=e&twclid=f", null),
    ).toBe("/p?id=1");
  });

  it("drops LinkedIn, Google Shopping, and Klaviyo click IDs", () => {
    expect(cleanUrl("/p?id=1&li_fat_id=a&srsltid=b&_ke=c", null)).toBe("/p?id=1");
  });

  it("drops Mailchimp mc_ params", () => {
    expect(cleanUrl("/p?id=1&mc_cid=abc&mc_eid=xyz", null)).toBe("/p?id=1");
  });

  it("preserves functional params (q, id, node, page, etc.)", () => {
    expect(cleanUrl("/search?q=keyboard&page=2&node=42", null)).toBe(
      "/search?q=keyboard&page=2&node=42",
    );
  });

  it("preserves ie= and _encoding= (site-specific, not generic tracking)", () => {
    expect(cleanUrl("/p?ie=UTF8&_encoding=UTF8&node=42", null)).toBe(
      "/p?ie=UTF8&_encoding=UTF8&node=42",
    );
  });

  it("drops the ? entirely when all params are noise", () => {
    expect(cleanUrl("/p?gclid=abc&utm_source=google", null)).toBe("/p");
  });

  it("preserves the fragment", () => {
    expect(cleanUrl("https://example.com/s?q=x&gclid=y#section", "https://example.com")).toBe(
      "/s?q=x#section",
    );
  });

  it("preserves the fragment when there is no query", () => {
    expect(cleanUrl("https://example.com/foo#bar", "https://example.com")).toBe("/foo#bar");
  });

  it("preserves percent-encoded values in non-noise params", () => {
    expect(cleanUrl("/p?q=hello%20world&gclid=x", null)).toBe("/p?q=hello%20world");
  });
});

// --- extractPageOrigin ---

describe("extractPageOrigin", () => {
  it("returns origin from RootWebArea url= attribute", () => {
    const tree = `uid=1_0 RootWebArea "Page" url="https://www.amazon.com/s?k=x"`;
    expect(extractPageOrigin(tree)).toBe("https://www.amazon.com");
  });

  it("returns origin from compact root + @ref form", () => {
    const tree = `@1.0 root "Page" url="https://example.com:8080/foo"`;
    expect(extractPageOrigin(tree)).toBe("https://example.com:8080");
  });

  it("returns null when there is no root url=", () => {
    expect(extractPageOrigin(`uid=1_0 RootWebArea "Page"`)).toBeNull();
  });

  it("returns null for a tree without a root node", () => {
    expect(extractPageOrigin(`uid=1_1 button "Click"`)).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(
      extractPageOrigin(`uid=1_0 RootWebArea "Page" url="not a url"`),
    ).toBeNull();
  });
});

// --- compactSnapshot Layer 1 (URL + description cleanup) ---

describe("compactSnapshot URL cleanup", () => {
  it("drops javascript: url= attributes but keeps the element", () => {
    const tree = [
      `uid=1_0 root "Page" url="https://x.com/"`,
      `  uid=1_1 link "Search" url="javascript:void(0)"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).not.toContain("javascript:");
    // Link line should have no url= attribute at all (root keeps its url= for origin lookup)
    const linkLine = result.split("\n").find((l) => l.includes('link "Search"'))!;
    expect(linkLine).not.toContain("url=");
    expect(linkLine).toContain('link "Search"');
  });

  it("strips the page origin from same-site URLs", () => {
    const tree = [
      `uid=1_0 root "Page" url="https://www.amazon.com/s?k=x"`,
      `  uid=1_1 link "Logo" url="https://www.amazon.com/ref_logo"`,
      `  uid=1_2 link "Other" url="https://other.com/foo"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain('url="/ref_logo"');
    expect(result).toContain('url="https://other.com/foo"');
  });

  it("drops tracking query params from URLs", () => {
    const tree = [
      `uid=1_0 root "Page" url="https://example.com/"`,
      `  uid=1_1 link "News" url="https://example.com/news?utm_source=nl&utm_medium=email&gclid=abc"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    expect(result).toContain('url="/news"');
  });

  it("dedups boilerplate description repeated >= threshold times", () => {
    const boilerplate = "use arrow keys to navigate";
    const tree = [
      `uid=1_0 root "Page" url="https://x.com/"`,
      `  uid=1_1 link "A" description="${boilerplate}"`,
      `  uid=1_2 link "B" description="${boilerplate}"`,
      `  uid=1_3 link "C" description="${boilerplate}"`,
      `  uid=1_4 link "D" description="${boilerplate}"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    const matches = result.match(/description=/g) ?? [];
    expect(matches.length).toBe(1);
    expect(result).toContain(`description="${boilerplate}"`);
    expect(result).toContain('link "D"');
  });

  it("keeps descriptions that occur fewer times than the threshold", () => {
    const tree = [
      `uid=1_0 root "Page" url="https://x.com/"`,
      `  uid=1_1 link "A" description="hint one"`,
      `  uid=1_2 link "B" description="hint one"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    const matches = result.match(/description=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("strips tracking params even when page origin is unknown", () => {
    const tree = [
      `uid=1_0 root "Page"`,
      `  uid=1_1 link "News" url="https://example.com/news?utm_source=nl&gclid=abc"`,
    ].join("\n");
    const result = compactSnapshot(tree);
    // No origin stripping (root has no url=), but tracking params are removed
    expect(result).toContain('url="https://example.com/news"');
  });
});

// --- applyUrlLut ---

describe("applyUrlLut", () => {
  it("returns body unchanged and empty trailer when no URLs are present", () => {
    const text = `@1.0 root "Page"\n  @1.1 button "Click"`;
    const { body, trailer, urlMap } = applyUrlLut(text);
    expect(body).toBe(text);
    expect(trailer).toBe("");
    expect(urlMap.size).toBe(0);
  });

  it("leaves a short URL that appears once untouched", () => {
    const text = `@1.0 root "Page"\n  @1.1 link "Home" url="/home"`;
    const { body, trailer } = applyUrlLut(text);
    expect(body).toContain('url="/home"');
    expect(trailer).toBe("");
  });

  it("tokenises a URL that appears 2+ times (dedup)", () => {
    const repeated = "/s?k=rgb+mechanical+keyboards&category=electronics";
    const text = [
      `@1.0 root "Page" url="${repeated}"`,
      `  @1.1 link "A" url="${repeated}"`,
      `  @1.2 link "B" url="${repeated}"`,
    ].join("\n");
    const { body, trailer, urlMap } = applyUrlLut(text);
    expect(body).not.toContain(`url="${repeated}"`);
    expect(body).toMatch(/url=\$u\d/);
    expect(urlMap.size).toBe(1);
    const [token, url] = [...urlMap.entries()][0];
    expect(url).toBe(repeated);
    expect(trailer).toContain(`${token} ${repeated}`);
    // Full URL in trailer — not hidden form
    expect(trailer).not.toContain("[hidden");
  });

  it("assigns tokens in tree-walk (first-occurrence) order", () => {
    const urlA = "/page-a?x=1&y=2&z=3&lots=of&params=here";
    const urlB = "/page-b?x=1&y=2&z=3&lots=of&params=here";
    const text = [
      `@1.0 root "Page"`,
      `  @1.1 link "A" url="${urlA}"`,
      `  @1.2 link "B" url="${urlB}"`,
      `  @1.3 link "A2" url="${urlA}"`,
      `  @1.4 link "B2" url="${urlB}"`,
    ].join("\n");
    const { urlMap } = applyUrlLut(text);
    const tokens = [...urlMap.keys()];
    expect(tokens[0]).toBe("$u1");
    expect(urlMap.get("$u1")).toBe(urlA);
    expect(tokens[1]).toBe("$u2");
    expect(urlMap.get("$u2")).toBe(urlB);
  });

  it("tokenises a long URL appearing once as a whale (hidden in trailer)", () => {
    const whale = "/sspa/click?" + "x".repeat(200);
    const text = `@1.0 root "Page"\n  @1.1 link "Ad" url="${whale}"`;
    const { body, trailer, urlMap } = applyUrlLut(text);
    expect(body).toMatch(/url=\$u\d/);
    expect(urlMap.get("$u1")).toBe(whale);
    // Hidden form in trailer
    expect(trailer).toContain("[hidden");
    expect(trailer).toContain(`${whale.length}b`);
    expect(trailer).not.toContain(whale);
  });

  it("whale trailer includes a path-stem preview", () => {
    const whale = "/sspa/click?spc=" + "A".repeat(200);
    const text = `@1.0 root "Page"\n  @1.1 link "Ad" url="${whale}"`;
    const { trailer } = applyUrlLut(text);
    expect(trailer).toContain("→ /sspa/click?spc=");
    expect(trailer).toContain("…");
  });

  it("cross-host whale includes host in the preview (no scheme)", () => {
    const whale = "https://aax-us-east.amazon.com/x/c/" + "B".repeat(200);
    const text = `@1.0 root "Page"\n  @1.1 link "Ad" url="${whale}"`;
    const { trailer } = applyUrlLut(text);
    // Preview should start with host, not https://
    expect(trailer).toMatch(/→ aax-us-east\.amazon\.com/);
  });

  it("dedup wins over whale when URL is both long and repeated", () => {
    const url = "/long?" + "x".repeat(200);
    const text = [
      `@1.0 root "Page"`,
      `  @1.1 link "A" url="${url}"`,
      `  @1.2 link "B" url="${url}"`,
    ].join("\n");
    const { trailer } = applyUrlLut(text);
    // Full URL printed in trailer — not the hidden form
    expect(trailer).toContain(url);
    expect(trailer).not.toContain("[hidden");
  });

  it("body + trailer length does not exceed input length", () => {
    const repeated = "/s?k=rgb+mechanical+keyboards";
    const text = [
      `@1.0 root "Page" url="${repeated}"`,
      `  @1.1 link "A" url="${repeated}"`,
      `  @1.2 link "B" url="${repeated}"`,
      `  @1.3 link "C" url="https://other.com/` + "x".repeat(200) + `"`,
    ].join("\n");
    const { body, trailer } = applyUrlLut(text);
    expect(body.length + trailer.length).toBeLessThanOrEqual(text.length);
  });

  it("trailer only lists URLs visible in the supplied text (truncation interaction)", () => {
    const urlInBody = "/visible?k=keyboard";
    const urlTruncated = "/hidden?k=mouse";
    // Simulate: body text was already truncated to contain only the first URL
    const truncatedText = `@1.0 root "Page"\n  @1.1 link "A" url="${urlInBody}"\n  @1.2 link "A" url="${urlInBody}"`;
    const { trailer } = applyUrlLut(truncatedText);
    expect(trailer).toContain(urlInBody);
    expect(trailer).not.toContain(urlTruncated);
  });
});

// --- resolveUrl ---

describe("resolveUrl", () => {
  it("resolves a $uN token via urlMap", () => {
    const urlMap = new Map([["$u1", "https://example.com/foo"]]);
    expect(resolveUrl("", urlMap, "$u1")).toBe("https://example.com/foo");
  });

  it("resolves $uN with leading @ stripped", () => {
    const urlMap = new Map([["$u2", "/bar"]]);
    expect(resolveUrl("", urlMap, "$u2")).toBe("/bar");
  });

  it("returns null for an unknown token", () => {
    expect(resolveUrl("", new Map(), "$u99")).toBeNull();
  });

  it("resolves a plain ref to its url= attribute in the body", () => {
    const body = `@1.0 root "Page"\n  @1.1 link "Home" url="/home"`;
    expect(resolveUrl(body, new Map(), "1.1")).toBe("/home");
    expect(resolveUrl(body, new Map(), "@1.1")).toBe("/home");
  });

  it("resolves a ref whose url= was tokenised, via urlMap", () => {
    const urlMap = new Map([["$u1", "/the-real-url"]]);
    const body = `@1.0 root "Page"\n  @1.1 link "Ad" url=$u1`;
    expect(resolveUrl(body, urlMap, "@1.1")).toBe("/the-real-url");
  });

  it("returns null when the ref has no url= attribute", () => {
    const body = `@1.0 root "Page"\n  @1.1 button "Click"`;
    expect(resolveUrl(body, new Map(), "@1.1")).toBeNull();
  });

  it("returns null when the ref does not exist in the body", () => {
    const body = `@1.0 root "Page"`;
    expect(resolveUrl(body, new Map(), "@9.9")).toBeNull();
  });
});

describe("collapseLandmarks", () => {
  it("collapses a large nav subtree into a summary line naming the expand ref", () => {
    const lines = [`root "Page"`, "  @1.0 nav"];
    for (let i = 1; i <= 12; i++) lines.push(`    @1.${i} link "Item ${i}"`);
    const out = collapseLandmarks(lines.join("\n"));
    expect(out.split("\n")).toContain(
      '  @1.0 nav [collapsed: 12 lines, 12 links — snapshot @1.0 to expand]',
    );
  });

  it("leaves small subtrees untouched", () => {
    const tree = 'root "Page"\n  @1.0 nav\n    @1.1 link "Home"';
    expect(collapseLandmarks(tree)).toBe(tree);
  });
});

describe("extractSubtree", () => {
  it("extracts and dedents a node's subtree by ref", () => {
    const tree = 'root "Page"\n  @1.0 nav\n    @1.0.1 link "Home"\n  @2.0 main';
    const sub = extractSubtree(tree, "1.0");
    expect(sub).toContain('@1.0 nav');
    expect(sub).toContain('@1.0.1 link "Home"');
    expect(sub).not.toContain('@2.0 main');
  });

  it("returns null for a missing ref", () => {
    expect(extractSubtree('root "Page"', "9.9")).toBeNull();
  });
});

describe("diffSnapshots", () => {
  it("pairs same-ref lines as changed, and reports added/removed", () => {
    const oldT = 'root "Page"\n  @1.1 button "Submit"\n  @1.2 link "Old"';
    const newT = 'root "Page"\n  @1.1 button "Go"\n  @1.3 link "New"';
    const d = diffSnapshots(oldT, newT);
    expect(d.changed).toEqual([{ before: '  @1.1 button "Submit"', after: '  @1.1 button "Go"' }]);
    expect(d.added).toEqual(['  @1.3 link "New"']);
    expect(d.removed).toEqual(['  @1.2 link "Old"']);
  });

  it("is empty for identical trees", () => {
    const t = 'root "Page"\n  @1.1 button "Go"';
    const d = diffSnapshots(t, t);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
    expect(d.changeRatio).toBe(0);
  });
});

describe("rootLineOf", () => {
  it("returns the root/title line as document identity", () => {
    expect(rootLineOf('root "Home"\n  @1.1 button "Go"')).toBe('root "Home"');
  });
  it("returns null when there is no root line", () => {
    expect(rootLineOf('  @1.1 button "Go"')).toBeNull();
  });
});

describe("windowSnapshot", () => {
  it("cuts at line boundaries and reports positions", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`line ${i}-${"x".repeat(60)}`);
    const text = lines.join("\n"); // ~7000 chars
    const w = windowSnapshot(text, 0, 3000);
    expect(w.start).toBe(0);
    expect(w.text.endsWith("\n")).toBe(false);
    expect(w.text.length).toBeLessThanOrEqual(3000);
    expect(w.end).toBeGreaterThan(0);
    expect(w.atEnd).toBe(false);
    expect(windowSnapshot(text, 0, 1_000_000).atEnd).toBe(true);
  });
});
