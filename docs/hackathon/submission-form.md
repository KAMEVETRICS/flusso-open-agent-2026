# Submission form text

Paste-ready answers for the HackOS form. Each one matches what the code does. The README has the detail and links.

## Project name
Flusso

## One-line description
An evidence agent that turns data (Zetaris), knowledge (Meterless World Model), and memory (Meterless H-MEM) into campaign decisions that code verifies, so AI-written marketing campaigns only say what their sources support.

## Track
Track 03, Reasoning Architecture

## Sponsor technology explanation

**Zetaris (data layer).** Zetaris federates three sources the agent reasons over:
- Flusso's campaign store on Neon Postgres: a JDBC datasource plus four datasource views that unpack the campaign JSON at the source.
- Hacker News: Lightning REST tables, and REST session tables per run.
- Wikimedia pageviews: REST session tables per run.

A unified semantic layer, `brand_evidence`, models campaigns, claim outcomes, performance, and evidence sections, keyed on campaign_id and aligned on domain. Two data-quality rules run at the start of every agent run. On our data, 3 of 18 campaigns fail `campaign_has_domain` and are kept out of brand evidence. The agent never writes SQL: it picks from eight parameterised tools, and every row Zetaris returns gets an evidence ID that decisions must cite. Every query is logged with its Zetaris query ID, SQL, row count, and timing.

**Meterless engines.** We mounted two of Meterless's reference engines.
- **World Model** holds the brand's verified fact sheet and the live Zetaris signals as one event-sourced model, with provenance on every write. Its context builder ranks facts by the campaign goal for the planner.
- **H-MEM** keeps a tiered memory per brand. After each campaign it stores which claims failed verification and why, the campaign outcome, and the decisions that were accepted. The next campaign for that brand recalls them. Cited memories get trust feedback in H-MEM's ledger.

Feature powered: the Evidence Agent step and the Evidence Agent tab in the app. Tests: `tests/meterless-engines.test.mjs` (H-MEM learn and recall across restarts; World Model provenance and context ranking), `tests/evidence-agent.test.mjs`, and `tests/sample-mode.test.mjs`. All 126 tests pass with `npm test`.

**Meterless Nightshift (primary AI provider).** Every text model call goes to Nightshift through its OpenAI-compatible Runtime 0.90 contract when it is configured:
- `METERLESS_BASE_URL` and `METERLESS_RUNTIME_TOKEN`
- `meterless-app: flusso` and `meterless-scope: user` headers
- the `meterless/auto` routing mode
- a 180 s timeout

The health endpoint reports online, unauthorized, or offline from `GET /v1/models`. The model that answered each request is logged.

**NVIDIA.** The evidence agent's plan, decide, and revise steps run on NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`). We picked it after testing Nemotron 3 Super, 3.5 Lightning, and 3 Ultra on the same input: Ultra at low reasoning effort gave a valid structured answer in 15 s with the most specific decisions. `logs/telemetry.jsonl` records which model answered each request, with a `nemotron` flag.

**Cursor.** Not used; built with Claude Code.

**What was unique.**
- Zetaris works as an evidence ledger: code rejects any decision that cites a row the agent never received, or a number its rows do not contain.
- The agent onboards live REST sources into Zetaris for one run and drops them afterwards.
- H-MEM learns from governance outcomes (which claims failed for this brand), not from chat.
- Nemotron plans and proposes, while deterministic code verifies.

## Pre-existing components (declare all of these)

- **Flusso core product, built before 22 Oct 2026** (37 commits, last on 15 Oct 2026): Firecrawl discovery, the campaign pipeline (Foundation, Architecture, Execution, Editorial, Governance, Verification), claim governance and the proof report, the Neon campaign store, exports, image generation, the Next.js UI, and the VPS deployment scripts.
- **Pre-existing data:** 8 of the 18 campaigns in the Neon store were created between 9 July and 15 October 2026. The agent reads their claim outcomes through Zetaris.
- **Third-party open source:** Meterless H-MEM and World Model reference implementations (Apache-2.0, vendored from Meterless/Meterless at commit 1742dec, with mechanical edits for Node type stripping). The Zetaris REST contract and SQL syntax follow zetaris/getting-started.

**Built during the window (22 to 27 Oct):** Phases 1 to 3 of Flusso (evidence-checked claims, source sections, the verified fact sheet, strategy and hook review, the brand model, the voice guide, document upload). Also all hackathon integration work: the evidence agent, the Zetaris objects and client, the Meterless engine integration, the Nightshift provider, the Evidence Agent UI, samples, tests, and docs.
