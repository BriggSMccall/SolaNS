/**
 * Binary DNS-over-HTTPS (RFC 8484, `application/dns-message`) codec for the resolver
 * (Technical Concept §5.1 / §13 "DoH RFC 8484"). SOLANS records (crypto addresses,
 * URIs, social handles) are carried as **TXT** answers (`key=value`); there's no IP
 * behind a `.sol`, so `A`/`AAAA` queries get an empty answer. Pure + transport-free
 * so it's unit-testable; the route in `app.ts` wires it to HTTP.
 */
import dnsPacket from "dns-packet";
import type { Record as SolansRecord } from "@solans/sdk";

const AA = dnsPacket.AUTHORITATIVE_ANSWER;
const RCODE_NXDOMAIN = 3; // the response rcode lives in the low nibble of `flags`

export interface DohQuery {
  id: number;
  name: string;
  type: string;
}

/** Decode a binary RFC-8484 DNS query → its first question (id / name / type). */
export function decodeDohQuery(bytes: Uint8Array): DohQuery {
  const msg = dnsPacket.decode(Buffer.from(bytes));
  const q = msg.questions?.[0];
  return { id: msg.id ?? 0, name: q?.name ?? "", type: String(q?.type ?? "TXT") };
}

/** Encode a binary RFC-8484 DNS query (for clients / tests). */
export function encodeDohQuery(name: string, type = "TXT", id = 0): Uint8Array {
  return dnsPacket.encode({ type: "query", id, questions: [{ type: type as never, name }] });
}

/** Decode a binary DNS response → its rcode + TXT answer strings (for clients / tests). */
export function decodeDohResponse(bytes: Uint8Array): {
  rcode: string;
  answers: { name: string; data: string[] }[];
} {
  const msg = dnsPacket.decode(Buffer.from(bytes));
  const answers = (msg.answers ?? []).map((a) => {
    const d = (a as unknown as { data: unknown }).data;
    const arr = Array.isArray(d) ? d : [d];
    return { name: (a as unknown as { name: string }).name, data: arr.map((x) => String(x)) };
  });
  return { rcode: String((msg as { rcode?: string }).rcode ?? "NOERROR"), answers };
}

/**
 * Encode a binary RFC-8484 DNS response carrying the name's records as TXT answers.
 * Empty records → `NXDOMAIN` (mirrors the JSON DoH path, which can't tell an
 * unregistered name from one with no records).
 */
export function encodeDohResponse(query: DohQuery, records: SolansRecord[]): Uint8Array {
  const answers =
    query.type === "TXT"
      ? records.map((r) => ({ type: "TXT" as const, name: query.name, ttl: 60, data: [`${r.key}=${r.value}`] }))
      : [];
  return dnsPacket.encode({
    type: "response",
    id: query.id,
    flags: AA | (records.length === 0 ? RCODE_NXDOMAIN : 0),
    questions: [{ type: query.type as never, name: query.name }],
    answers: answers as never,
  });
}
