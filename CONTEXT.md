# WASP — SHARED MASTER CONTEXT v1.0

## READ THIS FIRST

You are one of four AI-assisted developers building the same project.

This document is the shared context for the entire team.

You are NOT building an isolated project.

You are NOT building a standalone chatbot.

You are NOT building four independent agents.

You are contributing to one shared system called:

# WASP

---

# 1. PROJECT VISION

WASP is a multi-agent AI system powered by the Claude API.

The goal of today's MVP is to create a live demonstration where humans can communicate naturally with WASP through voice, while multiple specialized AI agents collaborate, share context, research information, request permissions, operate controlled tools, validate results, and communicate their activity through a futuristic visual interface.

The system should feel like an actual AI operations system.

The audience should be able to SEE and HEAR the agents working.

The core experience is:

USER
↓
VOICE
↓
WASP
↓
MULTIPLE SPECIALIZED AGENTS
↓
SHARED CONTEXT
↓
RESEARCH
↓
TOOLS
↓
PERMISSION
↓
SANDBOX
↓
VALIDATION
↓
AUDIT
↓
VOICE RESPONSE

---

# 2. THIS IS AN MVP

We are NOT trying to build the final version of WASP today.

We are building a spectacular, functional vertical slice.

The MVP must prioritize:

1. Working end-to-end flow
2. Shared context
3. Real agent communication
4. Voice
5. Human authorization
6. Real tool execution
7. Controlled sandbox
8. Auditability
9. Visual quality
10. Reliability during the live demo

Do not spend today's time building:

* enterprise infrastructure
* production authentication
* Kubernetes
* complex databases
* unnecessary microservices
* massive memory systems
* autonomous offensive cybersecurity
* unnecessary integrations
* unnecessary MCPs
* features that cannot be demonstrated

---

# 3. THE FOUR AGENTS

WASP has four specialized agents.

## 🩵 CYAN — ARCHITECT

Developer:
Pablo

Role:

* orchestration
* task decomposition
* coordination
* final synthesis
* shared state coordination
* user-facing high-level communication

The Cyan agent decides WHAT needs to happen next, but does not bypass security or authorization.

---

## 🩷 MAGENTA — RESEARCHER

Developer:
Andrea

Role:

* research
* documentation
* source collection
* technical knowledge
* evidence
* source verification state

The Magenta agent determines WHAT IS KNOWN.

It does not execute privileged actions.

---

## 🟠 ORANGE — OPERATOR

Developer:
Felipe

Role:

* tools
* Docker
* sandbox
* networking
* controlled execution
* technical validation

The Orange agent determines WHAT CAN ACTUALLY BE EXECUTED.

It cannot authorize itself.

---

## 🟢 GREEN — SECURITY / AUDITOR

Developer:
Juanda

Role:

* security
* permission management
* risk classification
* authorization
* auditing
* adversarial testing
* failure analysis

The Green agent determines WHAT REQUIRES AUTHORIZATION and records WHAT ACTUALLY HAPPENED.

---

# 4. IMPORTANT: FOUR PCS, ONE SYSTEM

Each developer may run their own WASP agent on their own PC.

The PCs should visually represent the agents.

Each PC has:

🩵 CYAN face
🩷 MAGENTA face
🟠 ORANGE face
🟢 GREEN face

Each face should have:

* original geometric design
* white/light base
* colored neon glow
* CRT aesthetic
* subtle scanlines
* glitch effects
* animated state
* eyes/details matching the agent color

Do NOT directly reproduce Marvel's Arnim Zola artwork or copyrighted assets.

The visual inspiration is:

* retro-futuristic computers
* CRT terminals
* surveillance systems
* geometric masks
* phosphor displays
* cyberpunk interfaces

---

# 5. THE MOST IMPORTANT ARCHITECTURAL RULE

The four PCs are NOT four independent applications with separate memories.

They are four clients/agents connected to a common WASP system.

Conceptually:

```
                     WASP HUB
                        |
      +-----------------+----------------+
      |                 |                |
   CYAN              MAGENTA          ORANGE
   Pablo              Andrea           Felipe
      |                 |                |
      +-----------------+----------------+
                        |
                      GREEN
                      Juanda
```

The exact implementation may differ.

The principle must NOT change:

# ONE SHARED CONTEXT

---

# 6. SHARED CONTEXT

The system needs a central/shared source of truth.

It must contain enough information for any agent to understand the current task.

At minimum:

```json
{
  "session_id": "...",
  "user_request": "...",
  "current_task": "...",

  "workshop": {},

  "research": [],

  "tools": [],

  "permissions": [],

  "sandbox": {},

  "agent_messages": [],

  "decisions": [],

  "audit": [],

  "current_state": ""
}
```

The actual schema may be improved.

However:

# DO NOT create four independent memories.

If an agent knows something important, that information must become available to the shared system.

---

# 7. AGENT COMMUNICATION

Agents must communicate through structured events/messages.

Do NOT make the system depend exclusively on agents talking to each other through audio.

Audio is the EXPERIENCE.

Structured events are the SYSTEM.

Correct:

Agent A
↓
structured event
↓
shared context/event bus
↓
Agent B
↓
TTS
↓
audience hears Agent B

Incorrect:

Agent A
↓
microphone
↓
speech-to-text
↓
Agent B

The second approach may be visually impressive but is unnecessarily fragile.

---

# 8. AGENT COMMUNICATION SHOULD FEEL LIKE VOICE-TO-VOICE

Although communication should be structured internally, the audience should experience it as natural agent-to-agent conversation.

Example:

🩵 CYAN:

> "Magenta, investigate beginner-friendly network reconnaissance exercises."

🩷 MAGENTA:

> "Understood. I'll research the relevant procedures and identify reliable sources."

Later:

🩷 MAGENTA:

> "Cyan, I found four relevant sources. Two provide detailed procedures, but they have not been experimentally validated in our environment."

🩵 CYAN:

> "Orange, can you validate the required activity in our sandbox?"

🟠 ORANGE:

> "I can. Docker is available, but this operation requires controlled network access."

🟢 GREEN:

> "Human authorization is required for that operation."

🩵 CYAN:

> "Pablo, may I proceed?"

Human:

> "Yes."

🟢 GREEN:

> "Authorization confirmed."

🟠 ORANGE:

> "Starting sandbox."

This conversation must be backed by structured events and shared state.

---

# 9. HUMAN IS ALWAYS PART OF THE LOOP

WASP can reason.

WASP can research.

WASP can propose.

WASP can request actions.

WASP can execute approved actions.

But WASP must NOT silently authorize its own risky operations.

The core principle is:

# THE MODEL PROPOSES.

# THE APPLICATION AUTHORIZES.

# THE TOOL EXECUTES.

# THE SYSTEM OBSERVES.

# THE AUDIT RECORDS.

---

# 10. PERMISSION FLOW

For an action requiring approval:

```text
Agent
↓
Tool request
↓
Security evaluation
↓
Permission request
↓
Human
↓
YES / NO
↓
Permission recorded
↓
Tool execution
↓
Result
↓
Audit
```

The model must never be able to skip this flow.

---

# 11. VOICE

Voice is a first-class interface.

Human → WASP:

```text
Microphone
↓
Speech-to-text
↓
WASP
```

WASP → Human:

```text
WASP response
↓
Text-to-speech
↓
Speaker
```

The user should be able to authorize actions through voice.

Examples:

YES
NO
STOP
CANCEL

Ambiguous speech must not automatically grant permission.

If uncertain, ask again.

---

# 12. VISUAL SYSTEM

Each agent's PC should have its own face.

The main face should change state.

Possible states:

IDLE
LISTENING
THINKING
RESEARCHING
COMMUNICATING
WAITING_FOR_PERMISSION
EXECUTING
SUCCESS
WARNING
ERROR
OFFLINE

The UI should display floating windows representing actual activity.

Examples:

RESEARCH

```text
┌─────────────────────────────┐
│ MAGENTA / RESEARCH          │
│                             │
│ Searching sources...        │
│                             │
│ ✓ 5 sources found           │
│ ✓ 2 official               │
│ ⚠ 1 contradictory          │
└─────────────────────────────┘
```

SANDBOX

```text
┌─────────────────────────────┐
│ ORANGE / SANDBOX            │
│                             │
│ Docker: RUNNING             │
│ Network: CONTROLLED         │
│                             │
│ > ping 127.0.0.1            │
│ ✓ 0% packet loss            │
└─────────────────────────────┘
```

SECURITY

```text
┌─────────────────────────────┐
│ GREEN / SECURITY             │
│                             │
│ ACTION: CREATE SANDBOX      │
│ RISK: MEDIUM                │
│                             │
│ APPROVAL REQUIRED           │
└─────────────────────────────┘
```

COMMUNICATION

```text
┌─────────────────────────────┐
│ AGENT COMMUNICATION          │
│                             │
│ CYAN → MAGENTA              │
│ "Research this procedure."  │
│                             │
│ MAGENTA → CYAN              │
│ "Research complete."        │
└─────────────────────────────┘
```

---

# 13. SHARED EVENT BUS

The system should expose structured events.

Examples:

```text
session_started
user_message
agent_started
agent_message
agent_finished
research_started
research_result
tool_requested
permission_requested
permission_granted
permission_denied
tool_started
tool_finished
sandbox_started
sandbox_test
sandbox_result
audit_event
warning
error
session_completed
```

The UI should consume these events.

The voice system should consume these events.

The audit system should consume these events.

The shared context should consume these events.

This creates a common backbone for the entire project.

---

# 14. CLAUDE API

Claude is the remote intelligence layer.

We are NOT running a local Claude model.

Use the official Anthropic API/SDK.

Use structured tool calling.

Use streaming where useful.

Do not fake tool execution by asking Claude to produce pretend command output.

Separate:

MODEL DECISION

from

APPLICATION LOGIC

from

AUTHORIZATION

from

TOOL EXECUTION

from

OBSERVATION

from

AUDIT

---

# 15. TOOLS

Potential tools include:

* web research
* browser/page retrieval
* filesystem operations
* Docker
* Linux sandbox
* ping
* DNS
* route/interface inspection
* HTTP connectivity
* controlled local port checks

The exact list may change.

Every tool must have a clear interface.

Do not give the model unrestricted Windows shell access.

---

# 16. SANDBOX

The MVP should have a real Docker-based Linux sandbox.

Kali Linux is acceptable if it is practical.

Another Linux distribution is acceptable if it makes the MVP significantly more reliable.

Initial safe demonstrations may include:

* ping localhost
* DNS resolution
* route inspection
* interface inspection
* HTTP request to local target
* controlled local service checks

The sandbox should be isolated and controlled.

External network access requires explicit authorization.

Do not implement:

* malware
* credential theft
* persistence
* destructive commands
* autonomous exploitation
* arbitrary external scanning
* bypassing security controls

---

# 17. RESEARCH

Research results must distinguish:

FOUND

from

VERIFIED

Example:

A webpage describing a command means:

FOUND

It does NOT mean:

VERIFIED

VERIFIED requires actual successful execution/testing.

Possible states:

FOUND
VERIFIED
CONTRADICTED
UNKNOWN

---

# 18. WORKSHOP

The main demo scenario is:

Human:

> "WASP, create a two-hour beginner network reconnaissance workshop."

The system should produce a structured workshop.

Minimum fields:

```json
{
  "title": "",
  "level": "",
  "duration_minutes": 120,
  "objectives": [],
  "agenda": [],
  "concepts": [],
  "challenges": [],
  "tools": [],
  "prerequisites": [],
  "network_dependencies": [],
  "risks": [],
  "fallbacks": [],
  "research": [],
  "lab": {
    "description": "",
    "validated": false
  }
}
```

IMPORTANT:

`validated` must remain false until an actual validation step succeeds.

---

# 19. AUDIT

Important actions must be auditable.

At minimum:

```json
{
  "timestamp": "",
  "agent": "",
  "action": "",
  "tool": "",
  "reason": "",
  "input": {},
  "result": {},
  "status": "",
  "risk_level": "",
  "approval_required": true,
  "approval_status": ""
}
```

The audit must allow someone to answer:

WHO did it?

WHAT did they do?

WHY?

WHEN?

WITH WHICH TOOL?

WAS AUTHORIZATION REQUIRED?

WAS IT GRANTED?

WHAT ACTUALLY HAPPENED?

---

# 20. FAILURE IS A FEATURE

WASP must be honest when something cannot be done.

Example:

Docker is unavailable.

The user asks:

> "Validate the laboratory."

Correct:

> "I can design and research the workshop, but I cannot validate the laboratory because the Docker capability is unavailable."

Incorrect:

> "The laboratory is ready."

The system must never claim successful execution without actual evidence.

---

# 21. MULTI-AGENT FAILURE

Agents can disconnect.

The system must handle:

* Researcher offline
* Operator offline
* Security offline
* Claude API timeout
* STT failure
* TTS failure
* Docker unavailable
* network failure
* permission denied
* tool failure

An agent being offline must not cause another agent to hallucinate that the missing agent completed the task.

---

# 22. MCP

MCPs are OPTIONAL.

Do NOT install MCPs just because they are available.

If you discover an MCP that materially improves the system, report:

* name
* purpose
* setup
* credentials
* security implications
* whether it is actually worth using today

Prefer simple local tools when they are faster and more reliable.

---

# 23. TEAM OWNERSHIP

PABLO / CYAN:

* orchestration
* Claude API integration
* shared context
* event bus
* task lifecycle
* final integration

ANDREA / MAGENTA:

* research
* sources
* research UI
* voice experience
* visual polish

FELIPE / ORANGE:

* Docker
* sandbox
* tools
* networking
* controlled execution

JUANDA / GREEN:

* security
* permissions
* audit
* adversarial testing
* failure testing

These are ownership boundaries, NOT separate projects.

---

# 24. SHARED REPOSITORY RULE

All four agents work in ONE repository.

Before creating a new file:

1. Inspect the repository.
2. Search for an existing implementation.
3. Search for shared types/interfaces.
4. Search for existing event definitions.
5. Search for existing configuration.
6. Reuse shared infrastructure.

DO NOT duplicate:

* event buses
* context stores
* API clients
* permission engines
* voice systems
* schemas
* UI primitives

If another developer owns the relevant component, integrate through its public interface.

---

# 25. COORDINATION RULE

If you need another agent's functionality:

DO NOT reimplement it.

Create or use an interface.

Example:

If ORANGE needs permission:

```text
ORANGE
→ permission.request(...)
→ GREEN
```

If CYAN needs research:

```text
CYAN
→ research.request(...)
→ MAGENTA
```

If MAGENTA needs validation:

```text
MAGENTA
→ validation.request(...)
→ ORANGE
```

If ORANGE needs authorization:

```text
ORANGE
→ security.request(...)
→ GREEN
```

---

# 26. DEVELOPMENT BEHAVIOR

Before coding:

* inspect
* understand
* identify existing work
* identify dependencies
* identify interfaces

While coding:

* keep changes modular
* write tests
* use shared interfaces
* avoid unnecessary rewrites
* avoid duplicated infrastructure

After coding:

* run tests
* inspect integration
* test failure cases
* document important decisions

---

# 27. SELF-IMPROVEMENT

At every milestone ask:

1. What is currently working?
2. What is fragile?
3. What can fail during the live demo?
4. What can be simplified?
5. What should be improved?
6. What should be removed because it is unnecessary?
7. What is missing from the shared context?
8. What integration point is unclear?

Improve the system incrementally.

Do NOT rewrite working components merely for style.

---

# 28. LIVE DEMO

The target experience:

The audience sees four PCs.

Each PC has a different neon WASP face.

The user says:

> "WASP, necesito un workshop de reconocimiento de red para principiantes."

CYAN wakes up.

CYAN speaks.

CYAN delegates to MAGENTA.

MAGENTA's face wakes up.

MAGENTA speaks.

MAGENTA researches.

MAGENTA sends information to CYAN.

ORANGE receives a validation request.

ORANGE speaks.

GREEN detects that an operation requires permission.

GREEN speaks.

CYAN asks the human.

Human:

> "Sí."

GREEN authorizes.

ORANGE starts Docker.

The sandbox executes a safe test.

ORANGE reports the result.

CYAN synthesizes everything.

WASP speaks the final result.

The audit window shows what happened.

The audience can see the entire chain.

---

# 29. DEMO MUST FEEL LIKE ONE INTELLIGENCE

Even though there are four specialized agents, the user should experience:

# ONE WASP SYSTEM

Not four unrelated chatbots.

The agents have different personalities/roles, but share:

* session
* context
* task
* state
* events
* permissions
* results
* audit

---

# 30. VISUAL PERSONALITY

The colors are functional identifiers.

🩵 CYAN = Architecture / Coordination

🩷 MAGENTA = Knowledge / Research

🟠 ORANGE = Execution / Tools

🟢 GREEN = Security / Authorization

Use the same color consistently across:

* face
* borders
* glow
* status
* messages
* event lines
* windows
* voice indicators

---

# 31. DO NOT OVER-ENGINEER

We have limited build time but abundant Claude API/Claude Code credits.

Use the credits aggressively for:

* implementation
* debugging
* testing
* architecture review
* adversarial review
* UI polish
* integration
* documentation

But do not turn the MVP into an unnecessarily complex distributed system.

Prefer:

simple
observable
testable
modular
reliable

over:

complex
distributed
fragile
over-engineered

---

# 32. CURRENT PRIORITY ORDER

Priority 1:

Shared context + event communication.

Priority 2:

Claude API + tool loop.

Priority 3:

Permissions.

Priority 4:

Sandbox.

Priority 5:

Agent-to-agent communication.

Priority 6:

Voice.

Priority 7:

Visual interface.

Priority 8:

Polish.

Priority 9:

Adversarial testing.

---

# 33. DEFINITION OF DONE

The MVP is successful when:

[ ] Four agents can connect to the same session.

[ ] Four agents have distinct identities/colors.

[ ] All agents share the same task context.

[ ] Agents can communicate through structured events.

[ ] Agent communication can be spoken aloud.

[ ] Human can speak to WASP.

[ ] WASP can speak to human.

[ ] Claude API drives the intelligence.

[ ] Tools can be requested through structured calls.

[ ] Risky tools require authorization.

[ ] Authorization can happen through voice.

[ ] Docker sandbox works.

[ ] Safe network test works.

[ ] Results are real.

[ ] Research distinguishes found vs verified.

[ ] Audit records meaningful actions.

[ ] UI displays live activity.

[ ] Floating windows reflect actual system events.

[ ] At least one failure scenario works.

[ ] WASP does not claim actions it did not perform.

[ ] The entire demo can be run reliably.

---

# 34. THE GOLDEN RULE

Always remember:

# FOUR AGENTS.

# ONE WASP.

# ONE CONTEXT.

# ONE EVENT STREAM.

# ONE HUMAN IN CONTROL.

Build your component so that the other three agents can use it.

If you are unsure whether something belongs to your component or the shared system:

STOP.

Inspect the repository.

Look for existing interfaces.

Then coordinate rather than duplicating.

---

# 35. FIRST ACTION

Before implementing your role:

1. Inspect the repository.
2. Read this shared context.
3. Identify the current architecture.
4. Identify existing shared infrastructure.
5. Identify what the other agents appear to be building.
6. Identify integration points.
7. State your proposed changes.
8. Then implement only your assigned responsibility.

The objective is not to create the most code.

The objective is to create a coherent WASP system that four computers can operate together during a live demonstration.
