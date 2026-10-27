# Slide deck outline

Ten slides. It covers the eight required points (problem and users, solution, workflow or architecture, technical stack, how Zetaris and Meterless were used, what was unique about that use, product visuals, future enhancements) plus a pre-existing versus new slide, which the rules ask for.

## 1. Title
Flusso: campaigns that check their own claims. Track 03, Reasoning Architecture. One screenshot of the Evidence Agent tab.

## 2. The problem and who has it
- Small marketing teams and agencies now draft campaigns with AI, and the drafts assert things nobody checked: invented stats, wrong capabilities, stale prices.
- Fixing that after the fact costs more than writing it. Reviewers do not know which claims failed last time, and nothing remembers.
- Target users: in-house marketers at startups and scale-ups, and agencies running campaigns for several brands.

## 3. The solution
- Website plus goal in, evidence-checked campaign out.
- New: before anything is written, an evidence agent decides what the campaign must do and avoid. Code verifies each decision against the data it cites.
- Every claim in the output carries a verified quote. Every decision carries an evidence chain.

## 4. Agent workflow
Diagram (use the mermaid chart from the README): Discovery, then the Evidence Agent loop (observe, plan, act through Zetaris, decide, verify, revise once), then Foundation through Verification, then H-MEM learns from the outcome.
Callouts: bounded loop (6 tools, 1 revision), code-side verifier (existing IDs, kind-appropriate evidence, no numbers missing from the evidence).

## 5. Architecture and stack
Next.js 15 and TypeScript; Neon Postgres; Firecrawl; Zetaris Lightning (JDBC datasource, datasource views, the brand_evidence USL, DQ rules, REST tables); Meterless H-MEM and World Model (reference engines, vendored); Meterless Nightshift as the OpenAI-compatible provider; NVIDIA Nemotron 3 Ultra; OpenRouter as fallback and for images. JSONL logs in logs/.

## 6. Zetaris: the agent's data layer
- Three sources: the Neon campaign store (JDBC), Hacker News (REST), Wikimedia pageviews (REST, session tables per run).
- brand_evidence USL: campaign, claim_outcome, performance, evidence_section, keyed on campaign_id.
- DQ rules run before the agent trusts its evidence. Real result: 3 of 18 campaigns have no domain and are excluded.
- The agent never writes SQL. It picks from 8 parameterised tools, and every row gets an evidence ID it must cite.
- Screenshot: the USL in the Zetaris UI, and one query's output from docs/zetaris/exploration.md.

## 7. Meterless: memory and world state
- World Model: the verified fact sheet and live signals land in one event-sourced model with provenance on every write. The context builder picks goal-relevant facts.
- H-MEM: after each campaign, failed claims, the editorial outcome, and accepted decisions become tiered memories with provenance; the next run recalls them; cited memories get trust feedback in the ledger.
- Nightshift: the primary provider for every text model call, with the model that answered logged per request.
- Tests: tests/meterless-engines.test.mjs and tests/evidence-agent.test.mjs.

## 8. What is unique about our use
- Zetaris is used as an evidence ledger for reasoning: every Zetaris row becomes a citable ID, and code refuses decisions that cite rows they cannot see.
- The agent onboards live REST sources into Zetaris for the duration of a run and drops them afterwards.
- H-MEM learns from governance outcomes, not chat: the memory is "this kind of claim failed for this brand, and why".
- Nemotron plans and decides; deterministic code verifies. The model is never the judge of its own evidence.

## 9. Product visuals
Pipeline view with the Evidence Agent card; the Evidence Agent tab (accepted and rejected decisions); the Proof Report; a provenance.jsonl record.

## 10. Before and after, and what is next
- Pre-existing (declared): Flusso's discovery, fact sheet, six-stage pipeline, proof checks, and UI, built before 22 October.
- New in the build window: everything on slides 4 to 8. See the README's "Pre-existing vs new" table.
- Next: performance feedback from real platform APIs into the USL; a shared multi-brand world model for agencies; Markovian chunking for long campaigns; Scout Intent routing for the intake form; a USL change feed so H-MEM updates when the source data changes.
