export interface RefInfo {
  ref: string;
  label: string;
  type: string;
}

/** Convert a canonical MCP ref ("2_4") to display form ("2.4"). */
export function refToDisplay(mcpRef: string): string {
  return mcpRef.replace(/_/g, ".");
}

/** Convert any ref form — "@2.4", "@2_4", "2.4", "2_4" — to MCP wire form "2_4". */
export function refToMcp(ref: string): string {
  return ref.replace(/^@/, "").replace(/\./g, "_");
}

/** Count interactive refs in snapshot text (accepts both uid= and compact @X.Y form). */
export function countRefs(snapshot: string): number {
  const matches = snapshot.match(/^\s*(?:uid=\S+|@\d[\d.]*)\b/gm);
  return matches ? matches.length : 0;
}

/** Extract ref IDs with labels and types from snapshot text. */
export function extractRefs(snapshot: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of snapshot.split("\n")) {
    // Accept both uid=X_Y (raw MCP) and @X.Y (compact) forms;
    // avoid \b before @ since @ is a non-word character
    const m = line.match(/(?:uid=(\S+)|(?:^|[ \t])@([\d.]+))\s+([\w]+)\s+"([^"]*)"/);
    if (!m) continue;
    const rawRef = m[1] ?? m[2];
    // Always return in display form so suggestion strings emit @X.Y refs
    const ref = m[1] ? refToDisplay(rawRef) : rawRef;
    refs.push({ ref, type: m[3], label: m[4] });
  }
  return refs;
}

/** Extract page title from snapshot (RootWebArea/root root node or first heading). */
export function extractTitle(snapshot: string): string {
  const rootMatch = snapshot.match(/(?:RootWebArea|root)\s+"([^"]+)"/);
  if (rootMatch) return rootMatch[1];
  // Compact markdown heading after compactSnapshot: `@X.Y ## Title`
  const mdMatch = snapshot.match(/^(?:@\S+\s+)?#{1,6}\s+(.+)$/m);
  if (mdMatch) return mdMatch[1].trim();
  const headingMatch = snapshot.match(/\bheading\s+"([^"]+)"/);
  if (headingMatch) return headingMatch[1];
  return "";
}

// Query-string keys issued by external ad/analytics platforms that carry no functional
// meaning for the destination page — safe to drop on any site.
const NOISE_PARAM_EXACT = new Set([
  // Google Ads click IDs
  "gclid", "gbraid", "wbraid", "dclid", "gad_source",
  // Social / messaging platform click IDs
  "fbclid",    // Meta/Facebook
  "msclkid",   // Microsoft Ads
  "yclid",     // Yandex
  "igshid",    // Instagram
  "ttclid",    // TikTok
  "twclid",    // Twitter/X
  "li_fat_id", // LinkedIn
  "srsltid",   // Google Shopping
  "_ke",       // Klaviyo
]);
// Prefix-matched families (all members are tracking-only)
const NOISE_PARAM_PREFIXES = [
  "utm_", // Google Analytics UTM parameters
  "mc_",  // Mailchimp
];

function isNoiseParam(key: string): boolean {
  if (NOISE_PARAM_EXACT.has(key)) return true;
  return NOISE_PARAM_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Clean a URL value to reduce token bloat without losing addressability:
 *  - returns null for javascript: and data: URLs so the caller drops the attribute entirely
 *  - strips a matching page origin → relative path
 *  - removes cross-site tracking query params (utm_*, gclid, fbclid, etc.)
 *
 * Preserves fragment, parameter order, and percent-encoding of remaining values.
 */
export function cleanUrl(url: string, origin: string | null): string | null {
  if (url.startsWith("javascript:") || url.startsWith("data:")) return null;

  let working = url;
  if (origin && working.startsWith(origin)) {
    working = working.slice(origin.length) || "/";
  }

  // Pull the fragment off first so query-param parsing can't accidentally consume it
  let fragment = "";
  const hashIdx = working.indexOf("#");
  if (hashIdx >= 0) {
    fragment = working.slice(hashIdx);
    working = working.slice(0, hashIdx);
  }

  const qIdx = working.indexOf("?");
  if (qIdx < 0) return working + fragment;

  const path = working.slice(0, qIdx);
  const query = working.slice(qIdx + 1);
  if (!query) return path + fragment;

  const kept = query.split("&").filter((part) => {
    if (!part) return false;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    return !isNoiseParam(key);
  });

  if (kept.length === 0) return path + fragment;
  return `${path}?${kept.join("&")}${fragment}`;
}

/** Extract scheme://host from the root node's url= attribute, if present. */
export function extractPageOrigin(tree: string): string | null {
  const m = tree.match(
    /^\s*(?:uid=\S+|@\S+)\s+(?:RootWebArea|root)\b[^\n]*\burl="([^"]+)"/m,
  );
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// Repeat a description value this many times before we treat it as boilerplate worth deduping.
// Below this, the bytes saved by dropping repeats don't beat the risk of hiding meaningful copy.
const DESCRIPTION_DEDUP_THRESHOLD = 3;

// Chrome a11y tree uses PascalCase for some internal role names; map them to compact lowercase.
const ROLE_RENAMES: Record<string, string> = {
  RootWebArea: "root",
  StaticText: "text",
  DisclosureTriangle: "disclosure",
  ColorWell: "color",
  InputTime: "time",
  Date: "date",
};

/**
 * Compact an accessibility snapshot tree to reduce token usage (~30% fewer tokens).
 * Removes noise nodes, strips ARIA default attributes, normalises role names,
 * de-quotes numeric attributes, converts headings to markdown, and rewrites
 * refs to the @PAGE.ELEM display format.
 *
 * Operates on the raw tree text (after MCP preamble has been stripped).
 */
export function compactSnapshot(tree: string): string {
  const lines = tree.split("\n");
  const out: string[] = [];
  let dropDanglingQuote = false;

  // Pre-pass: find page origin (for relative-URL rewriting) and count description values
  // so we know which ones cross the dedup threshold.
  const origin = extractPageOrigin(tree);
  const descriptionCounts = new Map<string, number>();
  for (const line of lines) {
    const re = / description="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      descriptionCounts.set(m[1], (descriptionCounts.get(m[1]) ?? 0) + 1);
    }
  }
  const seenDescription = new Set<string>();

  for (const raw of lines) {
    let line = raw;

    // <br> elements appear as LineBreak nodes; they're never useful in the a11y tree.
    // Their label is a literal newline, so splitting on \n leaves a dangling `"` on the
    // next line — skip that too.
    if (/^\s*uid=\S+ LineBreak "/.test(line)) {
      dropDanglingQuote = true;
      continue;
    }
    if (dropDanglingQuote) {
      dropDanglingQuote = false;
      if (/^\s*"\s*$/.test(line)) continue;
    }

    // Whitespace-only text nodes between elements are structural artifacts, not content
    if (/^\s*uid=\S+ StaticText "\s*"\s*$/.test(line)) continue;

    // StaticText children that just echo the parent's accessible name are redundant —
    // links, headings, buttons etc. already carry the label on their own line
    {
      const m = line.match(/^(\s*)uid=\S+ StaticText "([^"]+)"\s*$/);
      if (m) {
        const childIndent = m[1].length;
        const label = m[2];
        let drop = false;
        for (let i = out.length - 1; i >= 0; i--) {
          if (!out[i].trim()) continue;
          // Previous lines may already be in compact @X.Y form (B1 runs per-line before push)
          const pm = out[i].match(/^(\s*)(?:uid=\S+|@\S+) \w+ "([^"]+)"/);
          if (pm && pm[1].length === childIndent - 2 && pm[2] === label) drop = true;
          break;
        }
        if (drop) continue;
      }
    }

    // Empty valuetext is the same as having no valuetext
    line = line.replace(/ valuetext=""/g, "");

    // `disableable` is redundant when `disabled` is already present
    if (/ disabled\b/.test(line)) line = line.replace(/ disableable\b/g, "");

    // Every option and tab is selectable by definition; the attribute adds nothing
    if (/ (?:option|tab) "/.test(line)) line = line.replace(/ selectable\b/g, "");

    // `relevant="additions text"` is the ARIA default for live regions; omit it
    line = line.replace(/ relevant="additions text"/g, "");

    // `atomic` is implicit for alert and status by the ARIA spec
    if (/ (?:alert|status) /.test(line)) line = line.replace(/ atomic\b/g, "");

    // `live=` defaults are mandated by ARIA for these roles; no need to repeat them
    if (/ status /.test(line)) line = line.replace(/ live="polite"/g, "");
    if (/ alert /.test(line)) line = line.replace(/ live="assertive"/g, "");

    // combobox is always expandable with a popup; both attributes are implied by the role
    if (/ combobox /.test(line)) {
      line = line.replace(/ haspopup="(?:menu|listbox)"/g, "");
      line = line.replace(/ expandable\b/g, "");
    }

    // Horizontal is the default orientation for sliders and listboxes
    line = line.replace(/ orientation="horizontal"/g, "");

    // Autocomplete mode is an implementation detail rarely useful for navigation
    line = line.replace(/ autocomplete="(?:both|list)"/g, "");

    // Drop javascript: URLs entirely (no agent-actionable info), strip the page origin
    // from same-site links, and remove tracking/encoding query params
    line = line.replace(/ url="([^"]+)"/g, (_full, rawUrl) => {
      const cleaned = cleanUrl(rawUrl, origin);
      return cleaned == null ? "" : ` url="${cleaned}"`;
    });

    // Boilerplate descriptions (e.g. "use arrow keys to navigate" repeated on every link)
    // are recoverable from the first occurrence; drop the rest
    line = line.replace(/ description="([^"]*)"/g, (full, value) => {
      if ((descriptionCounts.get(value) ?? 0) < DESCRIPTION_DEDUP_THRESHOLD) return full;
      if (seenDescription.has(value)) return "";
      seenDescription.add(value);
      return full;
    });

    // Normalise known PascalCase Chrome-internal role names to short lowercase forms.
    // The uid= or @X.Y prefix is optional to handle simplified test fixtures.
    line = line.replace(
      /^(\s*(?:(?:uid=|@)\S+\s+)?)([A-Za-z][a-zA-Z]*)( )/,
      (_, pre, role, post) => pre + (ROLE_RENAMES[role] ?? role) + post,
    );

    // Numeric attribute values don't need quotes — saves two tokens per attribute
    line = line.replace(/(\w+)="(-?\d+)"/g, "$1=$2");

    // `heading "Label" level=N` → `## Label` — markdown is shorter and familiar to models
    {
      const m = line.match(/^(\s*uid=\S+) heading "([^"]+)" level=(\d+)(.*)/);
      if (m) {
        const hashes = "#".repeat(parseInt(m[3], 10));
        const extra = m[4].trim();
        line = `${m[1]} ${hashes} ${m[2]}${extra ? " " + extra : ""}`;
      }
    }

    // Rewrite refs last so all earlier transforms still match the uid= form;
    // dot separator tokenises better than underscore in BPE encodings
    line = line.replace(/\buid=(\d+)_(\d+)\b/g, (_, page, elem) => `@${page}.${elem}`);

    out.push(line);
  }

  return collapseTextRuns(out).join("\n");
}

/**
 * Merge consecutive text nodes at the same indent into one, then re-apply
 * the echo-dedup: if the merged label exactly matches the parent's label,
 * the collapsed line is dropped entirely (parent already carries the content).
 *
 * Only runs when 2+ text nodes were actually merged; single text nodes that
 * already survived the per-line echo-dedup are passed through unchanged.
 */
function collapseTextRuns(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(@\S+) text "([^"]*)"\s*$/);
    if (!m) {
      result.push(lines[i]);
      continue;
    }

    const [, indent, ref, firstLabel] = m;
    let j = i + 1;
    let merged = firstLabel;
    while (j < lines.length) {
      const next = lines[j].match(/^(\s*)@\S+ text "([^"]*)"\s*$/);
      if (!next || next[1] !== indent) break;
      merged += next[2];
      j++;
    }

    if (j === i + 1) {
      // Only one text node — pass through (already echo-deduped in main loop)
      result.push(lines[i]);
      continue;
    }

    // Multiple nodes merged — advance past consumed lines and echo-dedup the result
    i = j - 1;
    const childIndent = indent.length;
    let drop = false;
    for (let k = result.length - 1; k >= 0; k--) {
      if (!result[k].trim()) continue;
      const pm = result[k].match(/^(\s*)(?:uid=\S+|@\S+) \w+ "([^"]+)"/);
      if (pm && pm[1].length === childIndent - 2 && pm[2] === merged) drop = true;
      break;
    }
    if (!drop) result.push(`${indent}${ref} text "${merged}"`);
  }

  return result;
}

export interface TruncationResult {
  text: string;
  truncated: boolean;
  totalLength: number;
}

export function truncateSnapshot(
  snapshot: string,
  full: boolean,
  limit = 16000,
): TruncationResult {
  const totalLength = snapshot.length;
  if (full || totalLength <= limit) {
    return { text: snapshot, truncated: false, totalLength };
  }
  const cut = snapshot.lastIndexOf("\n", limit);
  const text = cut > 0 ? snapshot.slice(0, cut) : snapshot.slice(0, limit);
  return { text, truncated: true, totalLength };
}

/**
 * Truncate arbitrary text keeping both head and tail so recent/trailing data is preserved.
 * Used for eval output where the end of the result is often as important as the beginning.
 */
const MARKER_OVERHEAD = 50;

export function truncateText(text: string, limit = 8000): TruncationResult {
  const totalLength = text.length;
  if (totalLength <= limit) {
    return { text, truncated: false, totalLength };
  }
  // The omission marker adds overhead; skip truncation when
  // the text is short enough that truncating would produce a longer result.
  if (totalLength <= limit + MARKER_OVERHEAD) {
    return { text, truncated: false, totalLength };
  }
  const headBudget = Math.floor(limit * 0.4);
  const tailBudget = limit - headBudget;
  // Cut at line boundaries when possible
  const headCut = text.lastIndexOf("\n", headBudget);
  const head = headCut > 0 ? text.slice(0, headCut) : text.slice(0, headBudget);
  const tailStart = text.indexOf("\n", totalLength - tailBudget);
  const tail =
    tailStart > 0 && tailStart < totalLength
      ? text.slice(tailStart + 1)
      : text.slice(totalLength - tailBudget);
  const omitted = totalLength - head.length - tail.length;
  const result = `${head}\n\n... (${omitted} chars omitted, ${totalLength} total) ...\n\n${tail}`;
  return { text: result, truncated: true, totalLength };
}

const INPUT_TYPES = ["textbox", "searchbox", "input", "combobox", "textarea"];

/** Check if a ref type is an input/form field. */
export function isInputType(type: string): boolean {
  return INPUT_TYPES.includes(type);
}

// --- URL LUT (Layer 2) ---

const MIN_DEDUP_LEN = 15;
const WHALE_THRESHOLD = 200;
const WHALE_PREVIEW_CAP = 60;

export interface UrlLutResult {
  body: string;
  trailer: string; // empty string when no tokens were assigned
  urlMap: Map<string, string>; // token ($u1) → full cleaned URL
}

// Produce a short human-readable hint for a whale URL (no full value echoed).
// Relative paths are already concise; absolute URLs strip the scheme first.
function whalePreview(url: string): string {
  const target = url.startsWith("/") ? url : url.replace(/^https?:\/\//, "");
  return target.length <= WHALE_PREVIEW_CAP
    ? target
    : target.slice(0, WHALE_PREVIEW_CAP - 1) + "…";
}

/**
 * Apply a URL lookup table to a compacted, already-truncated snapshot.
 *
 * Two classes of URL are replaced with short $uN tokens:
 *   dedup  — appears ≥2× and length ≥ MIN_DEDUP_LEN → full URL printed in trailer
 *   whale  — length ≥ WHALE_THRESHOLD and not already a dedup URL
 *            → hidden in trailer with byte-size + path-stem preview only
 *
 * Must run AFTER truncation so the trailer only references URLs the agent can
 * actually see in the body.  Token IDs are assigned in tree-walk (top-down)
 * order and are therefore deterministic for identical input.
 */
export function applyUrlLut(text: string): UrlLutResult {
  // Count occurrences of each URL value (Layer 1 has already cleaned them)
  const urlCounts = new Map<string, number>();
  const scanRe = / url="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = scanRe.exec(text)) !== null) {
    urlCounts.set(m[1], (urlCounts.get(m[1]) ?? 0) + 1);
  }

  const isDedup = (u: string) => (urlCounts.get(u) ?? 0) >= 2 && u.length >= MIN_DEDUP_LEN;
  // Dedup wins when both conditions hold — URL gets full entry in trailer, not hidden.
  const isWhale = (u: string) => u.length >= WHALE_THRESHOLD && !isDedup(u);

  const urlToToken = new Map<string, string>();
  const urlMap = new Map<string, string>();
  let counter = 0;

  const body = text.replace(/ url="([^"]+)"/g, (_full, url: string) => {
    if (!isDedup(url) && !isWhale(url)) return _full;
    if (!urlToToken.has(url)) {
      const token = `$u${++counter}`;
      urlToToken.set(url, token);
      urlMap.set(token, url);
    }
    return ` url=${urlToToken.get(url)!}`;
  });

  if (urlMap.size === 0) return { body, trailer: "", urlMap };

  const trailerLines = ["urls:"];
  for (const [token, url] of urlMap) {
    if (isWhale(url)) {
      trailerLines.push(`  ${token} [hidden ${url.length}b → ${whalePreview(url)}]`);
    } else {
      trailerLines.push(`  ${token} ${url}`);
    }
  }

  return { body, trailer: trailerLines.join("\n"), urlMap };
}

/**
 * Resolve a URL from a LUT-applied snapshot body.
 *
 * target is either "$u3" (a LUT token) or "11.57" / "@11.57" (an element ref).
 * For ref resolution the body is searched for the element's url= attribute;
 * if it was tokenised, the token is further resolved via urlMap.
 *
 * Returns the full URL string, or null if not found.
 */
export function resolveUrl(
  body: string,
  urlMap: Map<string, string>,
  target: string,
): string | null {
  const normalised = target.replace(/^@/, "");
  if (normalised.startsWith("$u")) {
    return urlMap.get(normalised) ?? null;
  }
  // ref → find line and extract url= (quoted plain value or unquoted token)
  const escaped = normalised.replace(/\./g, "\\.");
  const re = new RegExp(`@${escaped}\\b[^\\n]*? url=(?:"([^"]+)"|(\\$u\\d+))`);
  const hit = body.match(re);
  if (!hit) return null;
  if (hit[1] !== undefined) return hit[1];
  if (hit[2] !== undefined) return urlMap.get(hit[2]) ?? null;
  return null;
}
