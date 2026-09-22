import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ClaudeWebSource } from "../src/research/sources/ClaudeWebSource";
import { ResearchSourceError } from "../src/research/types";

/** Build a fake Anthropic client exposing just the two methods the source uses. */
function fakeClient(opts: { search: unknown; parse?: unknown }) {
  return {
    beta: { messages: { create: vi.fn(async () => opts.search) } },
    messages: { parse: vi.fn(async () => opts.parse) },
  } as unknown as Anthropic;
}

const searchMessage = {
  stop_reason: "end_turn",
  content: [
    {
      type: "web_search_tool_result",
      tool_use_id: "t1",
      content: [
        { type: "web_search_result", url: "https://man7.org/ping", title: "ping(8)", encrypted_content: "", page_age: null },
        { type: "web_search_result", url: "https://example.com/blog", title: "Blog", encrypted_content: "", page_age: null },
      ],
    },
    { type: "text", text: "ping sends ICMP echo requests. The blog claims -c is not supported, which contradicts the man page." },
  ],
};

describe("ClaudeWebSource", () => {
  it("is unavailable without credentials or an injected client", () => {
    const prev = { key: process.env.ANTHROPIC_API_KEY, tok: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      expect(new ClaudeWebSource().isAvailable()).toBe(false);
    } finally {
      if (prev.key) process.env.ANTHROPIC_API_KEY = prev.key;
      if (prev.tok) process.env.ANTHROPIC_AUTH_TOKEN = prev.tok;
    }
  });

  it("maps search + extraction into FOUND / CONTRADICTED findings and drops uncited URLs", async () => {
    const client = fakeClient({
      search: searchMessage,
      parse: {
        stop_reason: "end_turn",
        parsed_output: {
          findings: [
            { source_url: "https://man7.org/ping", title: "ping(8)", kind: "technical_reference", claim: "ping sends ICMP echo requests", procedure: "ping -c 4 127.0.0.1", evidence: "man page", confidence: "high", contradicts_other_sources: false },
            { source_url: "https://example.com/blog", title: "Blog", kind: "community", claim: "-c is not supported", procedure: "none", evidence: "blog post", confidence: "low", contradicts_other_sources: true },
            { source_url: "https://not-in-search.example", title: "Hallucinated", kind: "unknown", claim: "x", procedure: "none", evidence: "x", confidence: "low", contradicts_other_sources: false },
          ],
        },
      },
    });
    const src = new ClaudeWebSource({ client });
    expect(src.isAvailable()).toBe(true);
    const out = await src.search({ question: "how does ping work" });
    expect(out).toHaveLength(2);
    expect(out[0]!.verification_status).toBe("FOUND");
    expect(out[1]!.verification_status).toBe("CONTRADICTED");
    expect(out.some((f) => f.source.includes("not-in-search"))).toBe(false);
  });

  it("returns UNKNOWN findings when structured extraction fails to parse", async () => {
    const client = fakeClient({ search: searchMessage, parse: { stop_reason: "end_turn", parsed_output: null } });
    const out = await new ClaudeWebSource({ client }).search({ question: "ping" });
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.verification_status === "UNKNOWN")).toBe(true);
  });

  it("surfaces a refusal as a ResearchSourceError so the engine can fall back", async () => {
    const client = fakeClient({ search: { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] } });
    await expect(new ClaudeWebSource({ client }).search({ question: "ping" })).rejects.toBeInstanceOf(ResearchSourceError);
  });

  it("returns an empty list when the search found nothing", async () => {
    const client = fakeClient({ search: { stop_reason: "end_turn", content: [{ type: "text", text: "nothing" }] } });
    const out = await new ClaudeWebSource({ client }).search({ question: "ping" });
    expect(out).toEqual([]);
  });
});
