/** The only TLD supported by the MVP program. */
export const TLD = "sol";

/** DNS label cap, mirrors NAME_MAX_LEN in the program. */
export const NAME_MAX_LEN = 63;

const ALLOWED = /^[a-z0-9-]+$/;

/**
 * Normalize + validate a name to the program's canonical on-chain form:
 * lowercase ASCII `[a-z0-9-]`, length 1..=63, no leading / trailing / consecutive
 * hyphen. Mirrors `validate_name` in `programs/solans/src/utils.rs`.
 *
 * The MVP program only accepts lowercase ASCII, so full Unicode / NFKC handling
 * is intentionally out of scope: anything outside the allowed set is rejected
 * (not transformed), guaranteeing exactly one byte string per registrable name.
 * Throws on invalid input.
 */
export function normalizeName(input: string): string {
  let name = input.trim().toLowerCase();
  if (name.endsWith(`.${TLD}`)) {
    name = name.slice(0, -(TLD.length + 1));
  }
  if (name.length < 1 || name.length > NAME_MAX_LEN) {
    throw new Error(`Invalid name length (must be 1-${NAME_MAX_LEN}): "${input}"`);
  }
  if (!ALLOWED.test(name)) {
    throw new Error(`Name has invalid characters (allowed: a-z 0-9 -): "${input}"`);
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    throw new Error(`Invalid hyphen position (no leading/trailing/double): "${input}"`);
  }
  return name;
}

/** True if `input` is a valid registrable name (does not throw). */
export function isValidName(input: string): boolean {
  try {
    normalizeName(input);
    return true;
  } catch {
    return false;
  }
}
