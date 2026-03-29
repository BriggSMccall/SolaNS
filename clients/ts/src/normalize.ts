/** Default TLD applied when the input has none. */
export const DEFAULT_TLD = "sol";

/** TLDs the program accepts (mirrors `ALLOWED_TLDS` in the program). */
export const ALLOWED_TLDS = ["sol", "chain", "web3"] as const;
export type Tld = (typeof ALLOWED_TLDS)[number];

/** Back-compat alias for the default TLD. */
export const TLD = DEFAULT_TLD;

/** DNS label cap, mirrors NAME_MAX_LEN in the program. */
export const NAME_MAX_LEN = 63;

/** Deepest subdomain level, mirrors MAX_SUBDOMAIN_DEPTH in the program. */
export const MAX_SUBDOMAIN_DEPTH = 4;

const LABEL = /^[a-z0-9-]+$/;

function isAllowedTld(t: string): t is Tld {
  return (ALLOWED_TLDS as readonly string[]).includes(t);
}

/** Validate (and normalize) a TLD against the allowlist; strips a leading dot. */
export function validateTld(tld: string): Tld {
  const t = tld.trim().toLowerCase().replace(/^\./, "");
  if (!isAllowedTld(t)) {
    throw new Error(`Unsupported TLD "${tld}" (allowed: ${ALLOWED_TLDS.join(", ")})`);
  }
  return t;
}

/** Validate a bare label (no TLD) to the program's canonical ASCII form. */
function validateLabel(label: string, input: string): string {
  if (label.length < 1 || label.length > NAME_MAX_LEN) {
    throw new Error(`Invalid name length (must be 1-${NAME_MAX_LEN}): "${input}"`);
  }
  if (!LABEL.test(label)) {
    throw new Error(`Name has invalid characters (allowed: a-z 0-9 -): "${input}"`);
  }
  if (label.startsWith("-") || label.endsWith("-") || label.includes("--")) {
    throw new Error(`Invalid hyphen position (no leading/trailing/double): "${input}"`);
  }
  return label;
}

/**
 * Parse `"name"` or `"name.tld"` into a normalized `{ name, tld }`. An allowed
 * TLD suffix in the input is honored; `tldOverride` (if given) wins; otherwise
 * the TLD defaults to `sol`. Mirrors the program's name/TLD validation, so the
 * MVP rules apply (lowercase ASCII label; a non-TLD dot makes the label invalid).
 * Throws on invalid input.
 */
export function parseName(input: string, tldOverride?: string): { name: string; tld: Tld } {
  const trimmed = input.trim().toLowerCase();
  let label = trimmed;
  let tld: string = DEFAULT_TLD;
  const dot = trimmed.lastIndexOf(".");
  if (dot > 0 && isAllowedTld(trimmed.slice(dot + 1))) {
    label = trimmed.slice(0, dot);
    tld = trimmed.slice(dot + 1);
  }
  if (tldOverride) tld = validateTld(tldOverride);
  return { name: validateLabel(label, input), tld: tld as Tld };
}

/**
 * Parse a possibly-dotted name (`"pay.alex.sol"`, `"alex.sol"`, `"alex"`) into
 * **leaf-first** labels + tld. A single label is a top-level name; 2+ labels are
 * a subdomain path. Each label is validated; the path depth is capped to
 * {@link MAX_SUBDOMAIN_DEPTH}. Used for subdomain ops and multi-label resolution.
 */
export function parsePath(input: string, tldOverride?: string): { labels: string[]; tld: Tld } {
  const trimmed = input.trim().toLowerCase();
  let rest = trimmed;
  let tld: string = DEFAULT_TLD;
  const dot = trimmed.lastIndexOf(".");
  if (dot > 0 && isAllowedTld(trimmed.slice(dot + 1))) {
    rest = trimmed.slice(0, dot);
    tld = trimmed.slice(dot + 1);
  }
  if (tldOverride) tld = validateTld(tldOverride);
  const labels = rest.split("."); // leaf-first (e.g. ["pay", "alex"])
  if (labels.length - 1 > MAX_SUBDOMAIN_DEPTH) {
    throw new Error(`Subdomain too deep (max ${MAX_SUBDOMAIN_DEPTH} levels): "${input}"`);
  }
  for (const l of labels) validateLabel(l, input);
  return { labels, tld: tld as Tld };
}

/** Normalize raw input to its canonical label (drops any allowed TLD suffix). */
export function normalizeName(input: string): string {
  return parseName(input).name;
}

/** True if `input` is a valid registrable name (does not throw). */
export function isValidName(input: string): boolean {
  try {
    parseName(input);
    return true;
  } catch {
    return false;
  }
}
