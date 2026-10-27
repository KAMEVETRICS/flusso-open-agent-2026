# Demo script (target 3:30, hard limit 4:00)

Wildcard [Tinkerer] track, so show the before and after. Before: Flusso already wrote evidence-checked campaigns. During the hackathon it gained a reasoning layer. The evidence agent turns data (Zetaris), knowledge (Meterless World Model) and memory (Meterless H-MEM) into campaign decisions. It reasons with NVIDIA Nemotron through Meterless Nightshift, and code verifies every decision.

Record at 1920x1080. Before you start, close every window that shows `.env.local`, the Nightshift KEYS tab, or any token.

## Prepare (before recording)

1. Docker Desktop must be running with the Zetaris containers up, including `zetaris-driver-1`. Nightshift must show "daemon online".
2. Run `npm run dev -- --port 3207` in this repo. Open http://localhost:3207/agent (the Evidence Console), and http://localhost:3207 in a second tab.
3. In Nightshift, click **Open Meterless** so its home screen is ready to show traffic.
4. Open the Zetaris UI (http://localhost:8888) on the `lightning.metastore.flusso.brand_evidence` USL.
5. Do one warm-up live run in the console. The first Zetaris query after a pause is slow while Neon wakes up.

## Shot list

| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00-0:25 | Campaign studio (http://localhost:3207), a finished campaign's Proof Report | "This is Flusso before the hackathon. Give it a website and a goal, and it writes a campaign where every claim carries a verified quote. But it wrote every campaign from scratch: no memory of which claims failed before, no data beyond the brand's own pages, and no reasoning about what the campaign should avoid." |
| 0:25-0:40 | Evidence Console hero. Pick **Linear**, select **Live: Zetaris + Nightshift**. | "So we built an evidence agent. Before anything is written, it decides what the campaign must do and avoid, and code checks each decision." |
| 0:40-1:40 | Press **Run the evidence agent**. Let the stream run. Point at the phase rail, the DQ bars, the hypothesis, the teal Zetaris SQL lines, the green Nightshift calls, and the amber verifier lines. | "It observes first. The verified fact sheet goes into the Meterless World Model, H-MEM recalls past lessons for this brand, and Zetaris runs data-quality rules. Three old campaigns have no domain, so they're excluded. Nemotron 3 Ultra, through Meterless Nightshift, picks which evidence to pull. Zetaris federates our Neon campaign store through a unified semantic layer, plus Hacker News, which the agent registers as a live REST table and drops afterwards. Then Nemotron proposes decisions, and code checks every one. A citation that doesn't exist, the wrong kind of evidence, or a number missing from the evidence gets rejected and sent back once." |
| 1:40-2:30 | Decision cards. Click an evidence chip on a verified card (for example `audience_signals#1`) to open its provenance. Then show a rejected card and its verifier note. | "Here's what came out. Lead on LinkedIn with links to posts that already drew Hacker News engagement. Click the evidence and you see the exact row and the Zetaris query it came from. This one was rejected: it stated numbers its evidence didn't contain. The rejection stays visible." |
| 2:30-3:00 | Switch to Nightshift's home screen (traffic from `flusso`), then the Zetaris UI showing the USL tables and DQ rules. | "Every model call went through Nightshift to Nemotron on NVIDIA's endpoints, and the console logs which model answered each one. This is the semantic layer in Zetaris that the agent queries." |
| 3:00-3:25 | Console: pick **Allbirds**, choose **Replay**, run. Point at the H-MEM card ("2 recalled"). | "Memory: after each campaign, H-MEM stores which claims failed and why. Allbirds already has a campaign, so its next plan starts from those lessons." |
| 3:25-3:45 | README: the sample-mode command and the `logs/` folder | "Everything you saw is in the JSONL logs, with provenance for every decision. And judges can replay all three runs with no credentials using `npm run agent:sample`." |

## If something fails while recording

- **The first Zetaris query is slow.** Neon is waking up, and the client retries. Wait, or cut the pause in editing.
- **Zetaris queries hang.** Check that `zetaris-driver-1` is running in Docker Desktop, and start it if it isn't.
- **Nightshift shows offline in the console pills.** Use **Replay**, which shows Nemotron as the model that produced the recorded run, and say on camera that you're replaying.
