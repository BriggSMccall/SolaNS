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

/**
 * An allowed emoji / pictograph code point (§9.2). MUST mirror `is_emoji_char` in
 * `programs/solans/src/utils.rs` exactly. Unicode *letters* stay banned (the
 * homograph vector); emoji are the only non-ASCII characters accepted on-chain.
 */
export function isEmojiChar(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    cp === 0x200d ||
    cp === 0x20e3 ||
    cp === 0xfe0f
  );
}

const byteLen = (s: string) => new TextEncoder().encode(s).length;

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

/**
 * Validate a bare label to the program's canonical form: each char is lowercase
 * ASCII `[a-z0-9-]` or an allowed emoji (§9.2); 1..=63 **bytes**; no leading/
 * trailing/double hyphen. Mirrors `validate_name` in `programs/solans/src/utils.rs`.
 * The caller has already trimmed + NFKC-normalized + lowercased.
 */
function validateLabel(label: string, input: string): string {
  if (byteLen(label) < 1 || byteLen(label) > NAME_MAX_LEN) {
    throw new Error(`Invalid name length (must be 1-${NAME_MAX_LEN} bytes): "${input}"`);
  }
  const chars = [...label]; // code points
  if (chars[0] === "-" || chars[chars.length - 1] === "-") {
    throw new Error(`Invalid hyphen position (no leading/trailing/double): "${input}"`);
  }
  let prevHyphen = false;
  for (const c of chars) {
    const asciiOk = c === "-" || (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
    if (!asciiOk && !isEmojiChar(c.codePointAt(0)!)) {
      throw new Error(`Name has invalid characters (allowed: a-z 0-9 - and emoji): "${input}"`);
    }
    if (c === "-") {
      if (prevHyphen) throw new Error(`Invalid hyphen position (no leading/trailing/double): "${input}"`);
      prevHyphen = true;
    } else {
      prevHyphen = false;
    }
  }
  return label;
}

/**
 * Parse `"name"` or `"name.tld"` into a normalized `{ name, tld }`. An allowed
 * TLD suffix in the input is honored; `tldOverride` (if given) wins; otherwise
 * the TLD defaults to `sol`. Mirrors the program's name/TLD validation: the label
 * is NFKC-normalized + lowercased to ASCII `[a-z0-9-]` or emoji (§9.2); a non-TLD
 * dot makes the label invalid. Throws on invalid input.
 */
export function parseName(input: string, tldOverride?: string): { name: string; tld: Tld } {
  const trimmed = input.trim().normalize("NFKC").toLowerCase();
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
  const trimmed = input.trim().normalize("NFKC").toLowerCase();
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
