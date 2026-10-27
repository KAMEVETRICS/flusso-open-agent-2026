# Demo script (target 3:30, hard limit 4:00)

Track 03, Reasoning Architecture. The story: Flusso's evidence agent turns data (Zetaris), knowledge (World Model), and memory (H-MEM) into campaign decisions that code checks before any content is written.

Record at 1920x1080. Before you start, close every window that shows `.env.local`, tokens, or the Nightshift Providers tab. Never scroll a terminal past a line with a key in it.

## Prepare (before recording)

1. Start Zetaris (Docker) and Nightshift. Check both: `curl http://127.0.0.1:8088/v1/models` (with the token header) and the Zetaris UI on port 8888.
2. `npm run dev -- --port 3207` in this repo and open http://localhost:3207.
3. Run one full Allbirds campaign in the app beforehand, so a finished result is ready. A full run takes 8 to 12 minutes; the video cuts that wait.
4. Open three terminal tabs: one for `npm run agent`, one with `logs/` open, one spare.
5. Open the Zetaris UI on the `lightning.metastore.flusso.brand_evidence` USL.

## Shot list

| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00-0:20 | Flusso workbench | "Marketing teams ship AI-written campaigns full of claims nobody checked. Flusso reads a brand's site, builds a verified fact sheet, and writes a campaign where every claim carries a checked quote. For the hackathon we added a reasoning layer that decides what the campaign should do before anything is written." |
| 0:20-0:40 | Type `allbirds.com` and the goal "Grow email newsletter signups ahead of a new running shoe launch". Start. Show Discovery finishing. | "Discovery reads the site and extracts facts. Each fact's quote is checked against the page." |
| 0:40-1:30 | Terminal: `npm run agent -- samples/allbirds-newsletter`. Let the stdout trace scroll. Pause on: the DQ line, the plan line, a Zetaris USL query, the `CREATE REST SESSION TABLE` lines, a `verifier decision.rejected` line, and `revise`. | "The evidence agent runs on Nemotron through Meterless Nightshift. First Zetaris runs two data-quality rules on our semantic layer: three old campaigns have no domain, so they are excluded. Nemotron picks which evidence to pull. Zetaris federates three sources: our Neon campaign store through a unified semantic layer, Hacker News, and Wikipedia pageviews, which the agent registers as live REST tables and drops when it is done. Then the important part: code verifies every decision. A decision that cites evidence that does not exist, the wrong kind of evidence, or a number that is not in its evidence is rejected and sent back once for revision." |
| 1:30-2:15 | App: Pipeline view, Evidence Agent card done; Results, Evidence Agent tab. Point at accepted and rejected rows, the evidence IDs, the "Model: nvidia/nemotron..." pill, the DQ rows. | "Accepted decisions become binding instructions for every writing stage. Here the agent found that past Allbirds sustainability claims were risky, so the campaign leads with material facts it can quote." |
| 2:15-2:45 | Results, Proof Report, then Content Pack. Show one asset that follows a decision and its supported claims. | "The campaign that comes out follows those decisions, and the proof report shows each claim with its verified quote." |
| 2:45-3:15 | Terminal: run the agent for the same brand again. Show the `h-mem recall` line with memory IDs, and a decision that cites `mem-` evidence. Then open `logs/provenance.jsonl` and expand one record. | "After each campaign, Meterless H-MEM stores which claims failed and which decisions held, with provenance. The next run for the same brand recalls them. Every decision's evidence chain is in the provenance log, down to the Zetaris query ID." |
| 3:15-3:35 | Zetaris UI: the brand_evidence USL tables and DQ rules. Nightshift Console: the request log showing Nemotron answering `flusso`. | "This is the USL in Zetaris, and this is Nightshift routing Flusso's requests to Nemotron on NVIDIA's hosted endpoints." |
| 3:35-3:50 | README sample mode command | "Judges can replay all three sample runs with no credentials: `npm run agent:sample`." |

## If something fails while recording

- Zetaris slow on the first query: Neon wakes its compute. The client retries; wait or cut.
- Nightshift unavailable: say it on camera, and use `npm run agent:sample`, whose output labels the model that produced the recorded run.
