import { describe, expect, it } from "vitest";
import { CatalogSource } from "../src/research/sources/CatalogSource";

describe("CatalogSource", () => {
  it("returns FOUND results relevant to the demo question (English)", async () => {
    const src = new CatalogSource();
    const results = await src.search({ question: "beginner network reconnaissance workshop: ping, DNS, interfaces, routes" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.verification_status === "FOUND")).toBe(true);
    expect(results.some((r) => r.source.includes("ping"))).toBe(true);
    expect(results.some((r) => r.source.includes("dig") || r.source.includes("rfc1035"))).toBe(true);
  });

  it("understands the Spanish demo phrasing", async () => {
    const src = new CatalogSource();
    const results = await src.search({ question: "workshop de reconocimiento de red para principiantes" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.confidence !== "low")).toBe(true);
  });

  it("falls back to beginner material with low confidence when nothing matches", async () => {
    const src = new CatalogSource();
    const results = await src.search({ question: "quantum chromodynamics lattice" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.confidence === "low")).toBe(true);
    expect(results[0]!.evidence).toMatch(/No direct keyword match/);
  });

  it("adds reachability evidence without ever claiming VERIFIED", async () => {
    const fakeFetch: typeof fetch = async () => new Response(null, { status: 200 });
    const src = new CatalogSource({ checkReachability: true, fetchImpl: fakeFetch });
    const results = await src.search({ question: "ping", max_results: 1 });
    expect(results[0]!.evidence).toMatch(/URL reachable \(HTTP 200\)/);
    expect(results[0]!.verification_status).toBe("FOUND");
  });

  it("downgrades confidence when the URL cannot be reached", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const src = new CatalogSource({ checkReachability: true, fetchImpl: failing });
    const results = await src.search({ question: "ping", max_results: 1 });
    expect(results[0]!.evidence).toMatch(/not confirmed reachable/);
    expect(results[0]!.confidence).toBe("medium");
  });
});
