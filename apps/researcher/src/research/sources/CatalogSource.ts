import type { RawFinding, ResearchQuery, ResearchSource } from "../types";

/**
 * Curated, offline catalog of well-known reference material.
 *
 * Why this exists: the live demo must not depend on the Claude API being
 * reachable. Everything here is DOCUMENTED knowledge => status FOUND, never
 * VERIFIED. Only ORANGE's sandbox can turn FOUND into VERIFIED.
 *
 * Optional reachability check: a HEAD request adds "URL reachable" evidence.
 * It is off by default so tests stay offline.
 */

interface CatalogEntry {
  tags: string[];
  finding: Omit<RawFinding, "verification_status">;
}

const CATALOG: CatalogEntry[] = [
  {
    tags: ["ping", "icmp", "connectivity", "network", "reconnaissance", "beginner"],
    finding: {
      source: "https://man7.org/linux/man-pages/man8/ping.8.html",
      title: "ping(8) — Linux manual page",
      kind: "technical_reference",
      claim: "ping sends ICMP ECHO_REQUEST packets to a host and reports round-trip time and packet loss.",
      procedure: "ping -c 4 127.0.0.1  (send 4 echo requests to localhost and report loss)",
      evidence: "Official man page describes -c count flag and output format.",
      confidence: "high",
    },
  },
  {
    tags: ["dns", "dig", "resolution", "name", "network", "reconnaissance", "beginner"],
    finding: {
      source: "https://man7.org/linux/man-pages/man1/dig.1.html",
      title: "dig(1) — DNS lookup utility",
      kind: "technical_reference",
      claim: "dig queries DNS name servers and prints the answer section for a given record type.",
      procedure: "dig +short example.com A  (resolve an A record against the configured resolver)",
      evidence: "Man page documents +short and record type arguments.",
      confidence: "high",
    },
  },
  {
    tags: ["dns", "protocol", "rfc", "resolution", "network"],
    finding: {
      source: "https://datatracker.ietf.org/doc/html/rfc1035",
      title: "RFC 1035 — Domain Names: Implementation and Specification",
      kind: "official",
      claim: "Defines the DNS message format, record types and resolver behaviour.",
      procedure: "Conceptual reference; no command. Use to explain what dig output means.",
      evidence: "IETF standards-track document.",
      confidence: "high",
    },
  },
  {
    tags: ["interface", "route", "ip", "address", "network", "reconnaissance", "beginner"],
    finding: {
      source: "https://man7.org/linux/man-pages/man8/ip.8.html",
      title: "ip(8) — show / manipulate routing, devices, policy routing and tunnels",
      kind: "technical_reference",
      claim: "ip addr and ip route list interfaces, addresses and the routing table.",
      procedure: "ip -brief addr; ip route  (inspect interfaces and default route, read-only)",
      evidence: "Man page documents addr/route subcommands and -brief output.",
      confidence: "high",
    },
  },
  {
    tags: ["nmap", "port", "scan", "reconnaissance", "network", "discovery"],
    finding: {
      source: "https://nmap.org/book/man.html",
      title: "Nmap Reference Guide",
      kind: "official",
      claim: "Nmap performs host discovery and port scanning; scanning requires authorization for any target you do not own.",
      procedure: "nmap -sT -p 22,80 127.0.0.1  (TCP connect scan of two ports on localhost only)",
      evidence: "Official reference guide; legal section stresses authorization.",
      confidence: "high",
    },
  },
  {
    tags: ["wireshark", "capture", "packet", "analysis", "network", "beginner"],
    finding: {
      source: "https://www.wireshark.org/docs/wsug_html_chunked/",
      title: "Wireshark User's Guide",
      kind: "official",
      claim: "Wireshark captures and dissects live traffic; capture filters limit what is recorded.",
      procedure: "Capture on loopback while running ping to observe ICMP echo request/reply pairs.",
      evidence: "User guide chapters on capturing and display filters.",
      confidence: "high",
    },
  },
  {
    tags: ["http", "curl", "connectivity", "web", "network", "beginner"],
    finding: {
      source: "https://curl.se/docs/manpage.html",
      title: "curl.1 — the man page",
      kind: "official",
      claim: "curl issues HTTP requests and can print response headers and status codes.",
      procedure: "curl -sI http://127.0.0.1:8080/  (HEAD request to a local test service)",
      evidence: "Man page documents -I (head) and -s (silent) flags.",
      confidence: "high",
    },
  },
  {
    tags: ["traceroute", "route", "hops", "path", "network", "reconnaissance"],
    finding: {
      source: "https://man7.org/linux/man-pages/man8/traceroute.8.html",
      title: "traceroute(8) — print the route packets trace to network host",
      kind: "technical_reference",
      claim: "traceroute reveals the sequence of hops between the host and a destination.",
      procedure: "traceroute -m 5 127.0.0.1  (limit to 5 hops; loopback returns in one hop)",
      evidence: "Man page documents -m max_ttl.",
      confidence: "medium",
    },
  },
  {
    tags: ["kali", "linux", "sandbox", "docker", "tools", "distribution"],
    finding: {
      source: "https://www.kali.org/docs/containers/",
      title: "Kali Linux — Containers documentation",
      kind: "official",
      claim: "Kali publishes official Docker images that ship without most tools preinstalled; metapackages add them.",
      procedure: "docker pull kalilinux/kali-rolling  (image is minimal; install kali-tools-top10 as needed)",
      evidence: "Official Kali docs on container images and metapackages.",
      confidence: "medium",
    },
  },
  {
    tags: ["workshop", "curriculum", "teaching", "beginner", "reconnaissance", "ethics", "authorization"],
    finding: {
      source: "https://owasp.org/www-project-web-security-testing-guide/",
      title: "OWASP Web Security Testing Guide",
      kind: "community",
      claim: "Reconnaissance/information gathering is the first testing phase and must be scoped and authorised.",
      procedure: "Use as a syllabus reference for the 'why authorization matters' segment of a workshop.",
      evidence: "Community-maintained guide; widely cited but not an academic source.",
      confidence: "medium",
    },
  },
];

export interface CatalogSourceOptions {
  /** Perform a HEAD request per result to add reachability evidence. Default false. */
  checkReachability?: boolean;
  /** Per-request timeout for reachability checks, ms. Default 4000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CatalogSource implements ResearchSource {
  readonly name = "catalog";
  readonly mode = "catalog" as const;

  constructor(private readonly opts: CatalogSourceOptions = {}) {}

  isAvailable(): boolean {
    return true;
  }

  async search(query: ResearchQuery): Promise<RawFinding[]> {
    const terms = tokenize(`${query.question} ${(query.focus ?? []).join(" ")}`);
    const max = query.max_results ?? 6;

    const scored = CATALOG.map((entry) => ({
      entry,
      score: entry.tags.reduce((acc, tag) => acc + (terms.has(tag) ? 1 : 0), 0),
    }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max);

    // If the question matched nothing, return the beginner networking basics
    // rather than an empty list — but say so in the evidence.
    const generic = scored.length === 0;
    const chosen = generic ? CATALOG.filter((e) => e.tags.includes("beginner")).slice(0, max) : scored.map((s) => s.entry);

    const findings: RawFinding[] = [];
    for (const entry of chosen) {
      let evidence = entry.finding.evidence;
      let confidence = entry.finding.confidence;
      if (generic) {
        evidence += " (No direct keyword match; returned as general beginner material.)";
        confidence = "low";
      }
      if (this.opts.checkReachability) {
        const reach = await this.reachable(entry.finding.source);
        evidence += reach.ok
          ? ` URL reachable (HTTP ${reach.status}) at ${new Date().toISOString()}.`
          : ` URL not confirmed reachable (${reach.reason}).`;
        if (!reach.ok && confidence === "high") confidence = "medium";
      }
      findings.push({ ...entry.finding, evidence, confidence, verification_status: "FOUND" });
    }
    return findings;
  }

  private async reachable(url: string): Promise<{ ok: boolean; status?: number; reason?: string }> {
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 4000);
    try {
      const res = await f(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
      return res.ok ? { ok: true, status: res.status } : { ok: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.name : "network error" };
    } finally {
      clearTimeout(timer);
    }
  }
}

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set<string>(words);
  // Light Spanish -> English bridging for the demo prompt ("reconocimiento de red para principiantes").
  const bridge: Record<string, string[]> = {
    reconocimiento: ["reconnaissance"],
    red: ["network"],
    redes: ["network"],
    principiantes: ["beginner"],
    principiante: ["beginner"],
    taller: ["workshop"],
    puertos: ["port"],
    puerto: ["port"],
    escaneo: ["scan"],
    interfaz: ["interface"],
    interfaces: ["interface"],
    ruta: ["route"],
    rutas: ["route"],
    contenedor: ["docker"],
    reconnaissance: ["reconnaissance", "network"],
    recon: ["reconnaissance", "network"],
    networking: ["network"],
    ports: ["port"],
    scanning: ["scan"],
    routes: ["route"],
    beginners: ["beginner"],
  };
  for (const w of words) for (const t of bridge[w] ?? []) set.add(t);
  return set;
}
