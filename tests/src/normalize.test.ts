import { describe, expect, it } from "vitest";
import { computeNameHash, isValidName, nameHashFor, normalizeName } from "@solans/client";

describe("client name normalization (mirrors the program)", () => {
  it("lowercases and strips a trailing .sol", () => {
    expect(normalizeName("Alex.SOL")).toBe("alex");
    expect(normalizeName("  BoB  ")).toBe("bob");
    expect(normalizeName("web3-dev")).toBe("web3-dev");
  });

  it("rejects invalid names", () => {
    for (const bad of ["a--b", "-ab", "ab-", "Aö", "a b", "", "a".repeat(64), "under_score"]) {
      expect(isValidName(bad)).toBe(false);
    }
  });

  it("accepts valid names", () => {
    for (const ok of ["a", "a-b-c", "web3dev", "0", "alex"]) {
      expect(isValidName(ok)).toBe(true);
    }
  });

  it("hashes the canonical input (normalized name + tld)", () => {
    const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
    expect(hex(nameHashFor("Alex.sol"))).toBe(hex(computeNameHash("alex", "sol")));
    expect(hex(nameHashFor("alex"))).toBe(hex(computeNameHash("alex", "sol")));
  });
});
