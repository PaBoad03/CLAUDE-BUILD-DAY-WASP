/**
 * MAGENTA agent process. Connects to Pablo's hub (docs/CONTRACT.md).
 *
 *   WASP_HUB_URL=ws://<pablo-ip>:7331 npm run agent -w @wasp/researcher
 *
 * Env:
 *   WASP_HUB_URL          hub address (default ws://localhost:7331)
 *   ANTHROPIC_API_KEY     enables live web research; without it the curated catalog is used
 *   WASP_CHECK_URLS=1     HEAD-check catalog URLs to add reachability evidence
 */
import os from "node:os";
import { connectHub } from "@wasp/event-bus";
import { ResearchEngine } from "../research/ResearchEngine";
import { CatalogSource } from "../research/sources/CatalogSource";
import { ClaudeWebSource, hasCredentials } from "../research/sources/ClaudeWebSource";
import { ResearcherAgent } from "./ResearcherAgent";

const log = (msg: string) => console.log(`[magenta ${new Date().toISOString().slice(11, 19)}] ${msg}`);

const web = new ClaudeWebSource();
const catalog = new CatalogSource({ checkReachability: process.env.WASP_CHECK_URLS === "1" });
const engine = new ResearchEngine({ sources: [web, catalog], log });
const researchMode = engine.plannedMode();

log(
  hasCredentials()
    ? "Claude API credentials found — live web research enabled (catalog as fallback)"
    : "no Claude API credentials — running in CATALOG mode (honest, offline)",
);

const hub = await connectHub({
  agent: "researcher",
  mode: "real",
  meta: { host: os.hostname(), research_mode: researchMode, version: "0.1.0" },
  log,
});
log(`connected to hub ${hub.url} (session ${hub.session_id})`);

const agent = new ResearcherAgent({ hub, engine, log });
agent.start();
log("researcher online");

hub.onAny((e) => {
  if (e.from === "researcher" || e.type === "context_updated") return;
  log(`<- ${e.type} from ${e.from}${e.to !== "all" ? ` to ${e.to}` : ""}${e.type === "agent_message" ? ` "${e.payload.message}"` : ""}`);
});
hub.on("hub_error", (e) => log(`HUB REJECTED: ${e.payload.message}`));

function shutdown() {
  log("shutting down");
  agent.stop();
  hub.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
