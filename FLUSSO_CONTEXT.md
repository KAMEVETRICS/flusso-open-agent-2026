# Flusso Context

## Source

- ChatGPT share: https://chatgpt.com/share/6a4e6eb3-b344-83ea-933c-fdb0828f1355
- Raw exported chat: `raw gpt chat.txt`
- Prompt library link from the share: https://docs.google.com/spreadsheets/d/17xLFR5nnXu5nLrczPzMP0ZEPQ5zaunwjBKoGpgwo2r0/edit?usp=sharing
- Note: the prompt library spreadsheet has not yet been inspected directly in this workspace.

Use this file as the concise project brief. Use `raw gpt chat.txt` when the full source discussion is needed.

## Product Thesis

Build Flusso as an AI Content Engineer, not a generic AI writer.

The core pitch:

> An autonomous content engineering studio that researches a market, discovers content opportunities, models audiences, architects campaigns, creates platform-native content, and verifies factual claims before delivery.

The user-facing promise is "legit content": content that is brand-aware, audience-specific, source-backed, platform-native, and production-realistic.

## Positioning

Flusso produces auditable deliverables. Customers need customized strategy, scoped deliverables, reviewable outputs, and clear quality standards. It is more valuable than a simple per-call text-generation tool because it produces a complete content system.

## Content Engineering Pipeline

1. Context ingestion
2. Research and competitive gap analysis
3. Audience micro-segmentation
4. Positioning and content territories
5. Hook engineering
6. Content architecture
7. Calendar engineering
8. Content production
9. Fact and source verification
10. Quality control
11. Delivery pack
12. Performance feedback loop

## Input Schema

Required from the user:

- Website
- Campaign goal

Inferred from the website and web search unless the user overrides them:

- Brand or project name
- Industry or category
- Existing audience
- Preferred tone
- Competitors

Optional, with defaults:

- Documentation links
- Target platforms
- Campaign duration
- Publishing frequency
- Team size
- Available production hours
- Content restrictions

## Internal Brand Context Object

The system should maintain a reusable context object that later stages inherit from.

```json
{
  "brand": {},
  "product": {},
  "audiences": [],
  "voice": {},
  "competitors": [],
  "verified_claims": [],
  "prohibited_claims": [],
  "content_goals": [],
  "platforms": []
}
```

## Proof Layer

The strongest differentiator is proof-backed content.

Every factual claim should track:

- Claim text
- Source URL
- Source type
- Confidence level
- Last verified date
- Content items where the claim is used

Delivery should include a factual QA report, such as:

- Claims checked
- Primary sources used
- Secondary sources used
- Unsupported claims
- Conflicting claims
- Time-sensitive claims that need monitoring

## MVP Demo Flow

The MVP should focus on one convincing end-to-end path:

1. Project input
2. Document ingestion
3. Competitive gap analysis
4. Audience micro-segments
5. Content territories
6. Hook library
7. Campaign architecture
8. 30-day calendar
9. Generate selected content
10. Verify claims
11. Deliver strategy, content, source report, and production plan

## Service Modules

### Content Strategy Audit

Inputs: website, competitors, audience, goals, platforms.

Outputs: competitive landscape, gap analysis, audience segments, content territories, communication recommendations.

### Campaign Engineer

Inputs: brand context, campaign goal, duration, platforms, team resources.

Outputs: campaign architecture, content series, hooks, calendar, production workflow, KPIs.

### Publish-Ready Content Pack

Outputs may include X posts, threads, article outlines, visual briefs, newsletter copy, source pack, and QA report.

### Content Repurposing Engine

Input: article, podcast, video, research report, documentation, or long-form source material.

Outputs: X thread, LinkedIn post, short posts, video scripts, carousel outline, newsletter summary, community prompts.

### Content Audit and Repair

Input: existing content archive.

Outputs: repetitive topics, weak hooks, voice inconsistencies, unsupported claims, missed audience segments, repurposing opportunities, and recommended next campaign.

## Internal Agent Modules

The MVP can be one orchestrator with modular stages:

- Researcher
- Strategist
- Brand analyst
- Audience mapper
- Hook engineer
- Series architect
- Content producer
- Fact checker
- Editorial reviewer
- Production planner

These do not need to be separately deployed agents for the first version.

## Demo Scenario

Use a Web3 or AI protocol as the sample customer.

The agent should produce:

- Competitor analysis
- Saturated narratives
- High-opportunity content gaps
- Audience micro-segments
- Content territories
- Classified hooks
- Connected content series
- 30-day campaign calendar
- Week 1 publish-ready content
- Source package
- Production schedule

## Build Direction

Start with complete campaign deliverables. Later, expose smaller MCP-style tools such as:

- `verify_content`
- `generate_hooks`
- `extract_brand_voice`
- `score_content`
- `repurpose_content`
- `build_content_brief`
