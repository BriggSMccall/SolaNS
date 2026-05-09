/**
 * SOLANS transaction → index events (Technical Concept §13 indexer).
 *
 * **Why an indexer exists:** a `NameRecord` stores the name *hash*, not the
 * plaintext label — but the **instruction data** carries the label
 * (`register_name(name, tld, …)`). So parsing transactions recovers the labels the
 * on-chain account hides, which powers search, owner pages, and the keeper's
 * watchlist. Decoding reuses the program-pinned generated client
 * (`identifySolansInstruction` + the `parse*Instruction` decoders), so it never
 * drifts from the on-chain layout. Pure + transport-free → unit-testable; `app.ts`
 * feeds it instructions extracted from a Helius webhook.
 */
import { AccountRole, type Address, type AccountMeta, type ReadonlyUint8Array } from "@solana/kit";
import {
  identifySolansInstruction,
  parseBurnNameInstruction,
  parseRegisterNameInstruction,
  parseRegisterWithSolansInstruction,
  parseRenewNameInstruction,
  parseRenewWithSolansInstruction,
  parseTransferNameInstruction,
  parseWrapSubdomainInstruction,
  SolansInstruction,
  SOLANS_PROGRAM_ADDRESS,
} from "@solans/sdk";

/** A program instruction normalized to the kit `Instruction` shape the decoders need. */
export interface RawInstruction {
  programAddress: Address;
  accounts: AccountMeta[];
  data: Uint8Array;
}

/** A decoded, label-bearing SOLANS action. */
export type IndexEvent =
  | { kind: "register"; nameRecord: Address; fullName: string; name: string; tld: string; owner: Address; nameHash: string; years: number }
  | { kind: "renew"; nameRecord: Address; name: string; tld: string; years: number }
  | { kind: "subdomain"; nameRecord: Address; parent: Address; owner: Address; label: string; nameHash: string }
  | { kind: "transfer"; nameRecord: Address; newOwner: Address }
  | { kind: "burn"; nameRecord: Address };

const hex = (b: ReadonlyUint8Array): string => Buffer.from(b as Uint8Array).toString("hex");

/** Build an `AccountMeta` list (roles don't matter to the decoders — only order/address). */
export function metasFromAddresses(addresses: Address[]): AccountMeta[] {
  return addresses.map((address) => ({ address, role: AccountRole.READONLY }));
}

/**
 * Decode one SOLANS instruction into an {@link IndexEvent}, or `null` if it isn't a
 * SOLANS instruction or isn't one the indexer tracks.
 */
export function parseSolansInstruction(ix: RawInstruction): IndexEvent | null {
  if (ix.programAddress !== SOLANS_PROGRAM_ADDRESS) return null;
  let kind: SolansInstruction;
  try {
    kind = identifySolansInstruction(ix);
  } catch {
    return null; // unknown discriminator
  }

  switch (kind) {
    case SolansInstruction.RegisterName: {
      const p = parseRegisterNameInstruction(ix as never);
      return {
        kind: "register",
        nameRecord: p.accounts.nameRecord.address,
        owner: p.accounts.owner.address,
        name: p.data.name,
        tld: p.data.tld,
        fullName: `${p.data.name}.${p.data.tld}`,
        nameHash: hex(p.data.nameHash),
        years: p.data.years,
      };
    }
    case SolansInstruction.RegisterWithSolans: {
      const p = parseRegisterWithSolansInstruction(ix as never);
      return {
        kind: "register",
        nameRecord: p.accounts.nameRecord.address,
        owner: p.accounts.owner.address,
        name: p.data.name,
        tld: p.data.tld,
        fullName: `${p.data.name}.${p.data.tld}`,
        nameHash: hex(p.data.nameHash),
        years: p.data.years,
      };
    }
    case SolansInstruction.RenewName: {
      const p = parseRenewNameInstruction(ix as never);
      return { kind: "renew", nameRecord: p.accounts.nameRecord.address, name: p.data.name, tld: p.data.tld, years: p.data.years };
    }
    case SolansInstruction.RenewWithSolans: {
      const p = parseRenewWithSolansInstruction(ix as never);
      return { kind: "renew", nameRecord: p.accounts.nameRecord.address, name: p.data.name, tld: p.data.tld, years: p.data.years };
    }
    case SolansInstruction.WrapSubdomain: {
      const p = parseWrapSubdomainInstruction(ix as never);
      return {
        kind: "subdomain",
        nameRecord: p.accounts.nameRecord.address,
        parent: p.accounts.parentName.address,
        owner: p.accounts.subdomainOwner.address,
        label: p.data.label,
        nameHash: hex(p.data.nameHash),
      };
    }
    case SolansInstruction.TransferName: {
      const p = parseTransferNameInstruction(ix as never);
      return { kind: "transfer", nameRecord: p.accounts.nameRecord.address, newOwner: p.data.newOwner };
    }
    case SolansInstruction.BurnName: {
      const p = parseBurnNameInstruction(ix as never);
      return { kind: "burn", nameRecord: p.accounts.nameRecord.address };
    }
    default:
      return null;
  }
}
