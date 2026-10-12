# Flusso

Flusso is a source-backed content campaign engine.

Give it a website and a campaign goal. Flusso reads the site with Firecrawl, infers the brand, industry, audience, tone, and competitors, and turns that into:

- campaign strategy and audience territories
- a content calendar
- platform-native assets for X, LinkedIn, Medium, newsletters, Discord, and Mirror
- visual briefs and generated visual assets
- claim verification and a proof report
- strategy, calendar, and content-pack exports

Every inferred field can be overridden under **Optional details** in the intake form. Inferred fields are treated as working assumptions, not as evidence for claims.

## Local development

1. Copy **.env.example** to **.env.local**.
2. Set **OPENAI_API_KEY**, **FIRECRAWL_API_KEY**, and **DATABASE_URL** (a Neon pooled connection string).
3. Install and run:

~~~bash
npm ci
npm run dev
~~~

The local application uses port 3107 in the current development workflow.

## Discovery

Before generation, Flusso:

1. scrapes the website homepage, including its brand identity (colors, fonts, logo)
2. maps the site and scrapes up to three key pages (about, product, use cases, pricing, or docs)
3. scrapes any docs URLs or competitor URLs supplied in the brief
4. when no competitors are supplied, runs a Firecrawl web search for competitors and alternatives
5. asks the model to fill only the brief fields the user left blank

All fetching happens through Firecrawl, so the engine never requests user-supplied URLs from its own network.

The extracted brand identity steers visual briefs and generated images toward the brand's palette and typography. Logos are shown for reference only and are never reproduced in generated images.

## Web verification

After governance marks claims against the fetched sources, a final stage uses OpenAI web search on up to 15 claims that still have no source. A claim becomes supported or conflicting only when the model cites a page it actually consulted during the search; anything else stays unsupported. Web pages count as secondary evidence, so their confidence is capped at 90%. If web search is unavailable for the configured model, the stage is skipped and the campaign still completes.

See [deploy/README.md](deploy/README.md) for the GitHub-to-VPS production workflow.
