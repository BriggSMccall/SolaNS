/**
 * Standard record keys (Technical Concept §2.2). The on-chain store is a generic
 * key→value map; these are the conventional keys clients agree on. `custom.*` and
 * `address.<CHAIN>` keys are also valid.
 */
export const RecordKeys = {
  addressSol: "address.SOL",
  addressEth: "address.ETH",
  addressBtc: "address.BTC",
  url: "url",
  avatar: "avatar",
  content: "content",
  twitter: "twitter",
  github: "github",
  email: "email",
  notice: "notice",
  keywords: "keywords",
} as const;

export type RecordKey =
  | (typeof RecordKeys)[keyof typeof RecordKeys]
  | `address.${string}`
  | `custom.${string}`;
