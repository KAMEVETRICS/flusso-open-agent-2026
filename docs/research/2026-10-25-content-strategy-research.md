# Content strategy research for Flusso

Researched October 25, 2026. Scope: content architecture, AI retrieval, publishing, and audience growth. The user supplied 15 starting links and requested additional useful references.

## Recommendation

Build Flusso around a reusable relationship between audience needs, approved knowledge, campaign decisions, and published assets. Its strongest opportunity is to make the path from research to a publishable campaign inspectable: why an item exists, who it helps, which evidence it uses, and what happened after publication.

The sources support content modeling, taxonomy, reuse, editorial operations, and retrieval techniques. The publishing experiments and Flusso priorities below are my synthesis. They are proposals to test, rather than evidence that a particular channel, cadence, or positioning will grow the business.

The organizing sequence is:

**Audience need → campaign decision → supported content units → channel adaptations → review and publication → measured learning.**

Keep two linked paths through this system:

- **Evidence:** source version → evidence passage → claim → asset version.
- **Purpose:** audience need → content territory → series → asset → outcome.

These relationships can start in the existing application and database. A dedicated graph database or a new CMS is not a prerequisite for testing them.

## What each supplied resource contributes

Priority means relevance to Flusso's next decisions, rather than an assessment of overall source quality.

| Resource | Findings from the material reviewed | Application and priority |
| --- | --- | --- |
| [1. Rachel Lovinger: Content Modelling: A Master Skill](https://alistapart.com/article/content-modelling-a-master-skill/) | A content model specifies types, their attributes, relationships, and how items assemble into deliverables. The article also cautions against introducing fields without a functional reason. | **Foundation.** Agree on the relationships among claims, sources, audiences, campaigns, and assets. Give each field a purpose in retrieval, review, reuse, delivery, or measurement. |
| [2. Sanity: Structured Content 101](https://www.sanity.io/structured-content-101) | Structured content represents meaningful information in reusable pieces. The guide distinguishes modeling the subject from merely dividing a page into presentation components. The supplied URL redirects here. | **Foundation.** Model a customer problem, proof point, product capability, or case study independently of a post layout. Sanity is an implementation example; the approach does not depend on adopting its product. |
| [3. Anthropic: Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval) | The method adds short document-specific context to chunks before indexing them for semantic and lexical retrieval. Anthropic reports a relative reduction in top-20 retrieval failures from 5.7% to 2.9% with contextual embeddings and contextual BM25. | **Evaluate after a baseline.** Test whether retrieved passages retain their subject, dates, and scope. The reported improvement concerns their benchmark and retrieval metric, rather than Flusso's factual accuracy or expected business results. |
| [4. Pinecone: Chunking Strategies](https://www.pinecone.io/learn/chunking-strategies/) | Chunking trades off specificity, coherence, model limits, and downstream context. The article recommends a simple starting point and evaluation of alternatives, including structure-aware splitting and expansion around retrieved chunks. | **Engineering reference.** Compare a simple splitter with structure-preserving chunks on actual campaign questions. Preserve the parent document and location of each chunk. Choose boundaries and sizes through evaluation. |
| [5. The llms.txt proposal](https://llmstxt.org/) | The fetched page is version 2, modified August 10, 2026. It proposes a concise Markdown entry point with context and links to detailed, agent-friendly content, including Markdown alternatives. | **Optional distribution experiment.** Generate an index from maintained public content. Keep it aligned with the website and docs. Treat it as a proposed access convention rather than proof of search visibility or a substitute for the content model. |
| [6. Designing Connected Content — Carrie Hane and Mike Atherton](https://www.peachpit.com/store/designing-connected-content-plan-and-model-digital-9780134763385) | The publisher description and contents lay out a progression from subject research to domain models, content models, and publishing. They frame content structure as a shared concern of strategy, design, and engineering. | **Foundation.** Map what the customer's world contains before deciding how pages and posts should represent it. Review scope: publisher description and table of contents, rather than the complete book. |
| [7. The Accidental Taxonomist — Heather Hedden](https://www.hedden-information.com/accidental-taxonomist/) | The author's page and [third-edition contents](https://www.hedden-information.com/accidental-taxonomist/table-of-contents/) cover concepts, preferred and alternative labels, hierarchical and associative relationships, tagging, and taxonomy maintenance. | **Foundation.** Give important concepts stable identities and controlled labels. Keep audience, topic, content purpose, and format as separate facets. Review scope: author description and contents, rather than the complete book. |
| [8. DeepLearning.AI: Retrieval Augmented Generation](https://www.deeplearning.ai/courses/retrieval-augmented-generation-rag/) | The supplied site returned 403. Its [official Coursera course listing](https://www.coursera.org/learn/retrieval-augmented-generation-rag) describes retrieval methods, vector databases, generation, evaluation, monitoring, and production tradeoffs. | **Learning reference.** Particularly useful for evaluating retrieval separately from generation and balancing quality, cost, and latency. Review scope: public syllabus; course lessons and assignments were not completed. |
| [9. Brain Traffic: The Content Strategy Podcast](https://www.braintraffic.com/podcast) | The archive covers strategy and content operations. [Episode 66 with Jeff Eaton](https://www.braintraffic.com/podcast/episode-66-jeff-eaton---the-importance-of-observability-in-assessing-content) discusses observing content quality, health, and effectiveness, and using small pilots to guide investment. | **Operating model.** Maintain separate measures for editorial quality, maintenance health, and audience or business outcomes. Review scope: archive and selected episode material, including transcript excerpts. |
| [10. Write the Docs](https://www.writethedocs.org/) | Its [documentation guide](https://www.writethedocs.org/guide/) connects writing, structure, accessibility, and maintenance. [Docs as code](https://www.writethedocs.org/guide/docs-as-code/) describes version control, review, plain text sources, and automated checks. | **Operating model.** Make revisions, ownership, review, and release history normal content operations. Provide an accessible editing experience for content staff; the useful principle is a reliable workflow. |
| [11. OASIS DITA](https://www.oasis-open.org/committees/dita/) | The supplied route timed out; the [committee home](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=dita) was accessible. The [topic specification](https://dita-lang.org/2.0/dita/archspec/base/topicdefined) explains typed topics and their assembly through maps. | **Reuse principles now; tooling when justified.** Borrow independent topics and explicit assembly relationships. Full DITA/XML adoption would need a customer requirement or a clear advantage for documentation, localization, or interchange. |
| [12. Schema.org](https://schema.org/) | A shared vocabulary for publicly describing entities and relationships. [Article](https://schema.org/Article) and [CreativeWork](https://schema.org/CreativeWork) expose relevant concepts such as authorship, dates, subject matter, and citations. | **Public publishing layer.** Map suitable internal fields to accurate public metadata. Schema.org does not define the entire internal campaign workflow or establish whether a claim is true. |
| [13. Unstructured](https://unstructured.io/) | The product addresses conversion of varied documents into usable data. Its [chunking documentation](https://docs.unstructured.io/open-source/core-functionality/chunking) distinguishes partitioning into document elements from grouping those elements for retrieval. | **Ingestion reference.** Test with messy PDFs and tables if these become important customer inputs. Preserve sections, table structure, and source locations. Vendor claims about superiority were not independently established in this review. |
| [14. Karen McGrane](https://karenmcgrane.com/) | Following her site to [Content Strategy for Mobile, chapter 3](https://contentstrategyformobile.com/chapter/chap03/) gives the substantive adaptive-content argument: reusable structure, meaningful metadata, presentation independence, variants, and usable authoring tools. | **Publishing foundation.** Maintain a common factual core while adapting the headline, length, sequencing, and media for each channel. The chapter supports intentional variants and equivalent experiences. |
| [15. Simple [A]](https://simplea.com/) | Its [personalization article](https://simplea.com/resources/articles/personalization-at-scale) connects reusable content, metadata, and publishing processes to personalization. It is a consultancy's explanation rather than independent proof of a growth effect. | **Positioning and workflow reference.** Tie an audience's need to eligible content and a delivery context. Begin with a few useful audience distinctions and observe whether they change outcomes. |

## Five additions that fill gaps

| Additional reference | Why it belongs in this research |
| --- | --- |
| [GOV.UK: Identify user needs](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/identify-user-needs/) | Provides a practical method for connecting content to users' tasks and evidence. For Flusso, use it to separate observed needs from inferred personas. Its government publishing constraints should be adapted to commercial campaigns. |
| [Diátaxis](https://diataxis.fr/) | Separates tutorials, how-to guides, reference, and explanation by user need. Useful for product education and documentation; it should sit alongside persuasion, comparison, and customer-story formats in marketing. |
| [W3C SKOS Primer](https://www.w3.org/TR/skos-primer/) | Supplies a precise foundation for concept identities, preferred labels, alternative labels, and broader/narrower/related relationships. Borrow the semantics before deciding whether RDF publication is necessary. |
| [Google: Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) | Adds an editorial check for originality, useful analysis, adequate evidence, and clear authorship. A campaign should contribute customer-specific examples or expertise beyond recombining existing pages. |
| [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) | Establishes an important boundary: Google says no special AI text file or special Schema.org markup is needed for its AI Search features. It recommends established SEO practices and metadata consistent with visible content. This guidance is specific to Google. |

## Architecture priorities for Flusso

This is a limited review of the project brief, README, and selected schemas, ingestion, editorial, and performance files. It is not a complete implementation audit.

### 1. Strengthen evidence records and source preservation

The inspected application already has source records, claims, audience segments, territories, series, assets, and performance records. Extend those existing concepts through stable relationships.

| Record | Proposed minimum information | Enables |
| --- | --- | --- |
| Source version | Stable source ID, canonical URL, fetched date, published/updated dates when known, full extracted content or snapshot reference, content hash, extraction status, access scope | Reproduce the research and identify source changes. |
| Evidence passage | Source-version ID, exact text, section or page, offsets or another resolvable locator, extraction caveats | Open the actual supporting passage. |
| Claim | Assertion, subject, scope and conditions, evidence IDs, support/conflict status, checked date, review trigger | Reuse a fact without dropping its qualifications. |
| Audience need | Audience ID, task or problem, desired outcome, observed evidence, inference status | Explain why the content deserves to exist. |
| Concept | Stable ID, preferred label, aliases, definition, relationships, owner | Keep terminology consistent across campaigns and retrieval. |
| Campaign decision | Goal, audience need, territory, distinctive contribution, channel role, production constraint, success measure | Make strategy inspectable before generation. |
| Asset version | Parent campaign/series, supported claim IDs, source unit IDs, channel, CTA, review status | Trace variants and identify affected assets when a fact changes. |
| Experiment/outcome | Hypothesis, asset version, change tested, audience/channel, observation window, numerator/denominator, result, next action | Turn performance into qualified learning. |

Use many-to-many evidence relationships: a claim may have multiple supporting or conflicting passages, and one passage may support multiple claims. Keep raw evidence separate from model-written summaries or contextual prefixes. An index aid should never silently become the source quotation.

Two concrete findings deserve early attention:

- [Source ingestion](C:/Users/THIS-PC/Documents/flusso/lib/source-ingestion.ts:6) currently caps normalized source text at 12,000 characters. Preserve the full captured source separately and use an explicit selection budget for generation, so later evidence remains discoverable.
- In that file, `sourceQuality` becomes `strong` at 250 words. That measures extracted text quantity. Separate extraction completeness from publisher authority, relevance, recency, and support for a specific claim.

The inspected [claim schema](C:/Users/THIS-PC/Documents/flusso/lib/schemas.ts:344) has an optional single `sourceId` and a string `contentUsedIn`. Structured passage, version, and asset relationships would make the proof layer more useful for revisions and reuse. These are proposed extensions, rather than a claim that every citation behavior has been audited.

### 2. Use a small, maintained taxonomy

Start with separate facets for audience, audience need, topic/concept, journey stage, editorial purpose, format, channel, and evidence status. A topic is what something concerns; a purpose is what it helps the reader do; a format is how it is expressed.

For example, a hypothetical item could concern **source verification**, help a **marketing lead approve claims**, serve a **product-evaluation** journey stage, and take the form of a **LinkedIn case walkthrough**. Those values should remain independently searchable.

Assign ownership and a vocabulary version. AI can propose tags and aliases; review new concepts before they enter the shared vocabulary. Measure whether editors and retrieval queries can find the intended items before adding more categories.

### 3. Evaluate retrieval as an experiment

An authored explanation or approved proof point is an editorial unit. A retrieval chunk is an indexing unit. Keep their identities and links separate, because the useful size and lifecycle can differ.

For a small source pack, begin with the existing approach and an explicit context budget. When retrieval becomes necessary, compare these candidates:

1. A simple chunking and retrieval baseline.
2. A variant that preserves document sections, tables, parent context, and source locators.
3. Hybrid lexical and semantic retrieval, then contextual prefixes or reranking where measured failures justify them.

Hold the questions and evaluation procedure fixed while changing one component. Include exact names, numbers, dates, qualifications, conflicting sources, source updates, and questions for which there is no supported answer. Test source-scoping rules as well.

My proposed starter set is 40–60 real campaign research questions, with expected supporting passages reviewed by a person. This size is an initial working choice, not a published benchmark. Track recall of the expected evidence, citation support, appropriate abstention, latency, and cost separately. A better retrieval score does not by itself establish better campaigns.

### 4. Give content a maintenance workflow

Use an explicit lifecycle such as draft → evidence review → editorial review → approved → published → refresh or retired. Capture the owner, approver, review reason, and relevant source versions.

When a source changes, identify the claims and assets that depend on it. Flag the affected material for re-review and regeneration. Previously published content needs a deliberate correction process; regenerating a local draft does not update a social post already in the world.

Give volatile facts event-based review triggers where possible. A dated product release, a new pricing page, or a changed policy can be more useful than applying the same expiry interval to all content.

## Publishing and growth strategy

### Begin with an evidenced audience problem

The project brief positions Flusso around source-backed campaigns. My initial audience hypothesis is small B2B teams selling AI or technical products that need useful content and credible claims with limited production capacity. Validate this with customers and prospect conversations before treating it as established positioning.

For each proposed series, record:

- The reader's task, question, or objection, and the evidence that it matters.
- The useful change the content should enable.
- The specific expertise, demonstration, or original evidence Flusso can contribute.
- The channel's role and the next action the reader can reasonably take.
- The available production effort and the primary success measure.

If a need comes only from an AI inference, retain that label. Competitor coverage can show what competitors publish; absence of coverage alone does not establish audience demand.

### Pilot three connected territories

These are proposed series for Flusso's own publishing. The same planning structure can support customer campaigns.

| Territory | Audience task | Candidate series | Primary signal |
| --- | --- | --- | --- |
| Evidence in practice | Decide whether an AI-generated asset is credible enough to use | A claim teardown showing the source, missing qualification, correction, and resulting asset | Qualified audit requests or relevant product trials |
| Campaign production | Turn research into a manageable publishing week | One research pack followed through a brief, calendar, adaptations, and editorial decisions | Template use and completion of a first campaign |
| Content engineering explained | Understand how the product preserves knowledge and context | Practical explanations of source packs, taxonomy, reusable content, and retrieval mistakes | Relevant product exploration and activation |

The first two territories demonstrate immediate buyer value. The third can serve technical evaluators and product education. Avoid assuming that interest in RAG engineering equals intent to buy a campaign product.

### Produce an anchor and purposeful adaptations

As an initial cadence experiment, produce one substantial, evidenced anchor each week and two or three adaptations. Adjust the volume to actual editorial capacity and results.

Illustrative anchor: **How to build a traceable source pack for a campaign.**

| Output | Distinct contribution | Suggested next action |
| --- | --- | --- |
| Website guide | Complete method, annotated example, limitations, downloadable worksheet | Use the worksheet or start a relevant workflow |
| LinkedIn post | One editorial decision from the example, explained for a marketing lead | Inspect the annotated example |
| X thread | A concise sequence illustrating a common verification mistake and its repair | Open the full guide |
| Newsletter | A worked example plus a practical exercise | Try the worksheet and reply with a problem |
| Product walkthrough | Show the claim-to-source trail in the actual product | Build a first source-backed campaign |

Select only the channels the audience actually uses. The facts and qualifications remain linked across adaptations, while the opening, sequence, level of detail, media, and CTA fit the reader's context. A source supporting a feature description does not establish an ROI claim or a customer result.

### Make distribution and learning explicit

For each anchor, identify its existing discovery route: a relevant website section, newsletter audience, social audience, customer question, or community context. Include contextual internal links and a useful next step. Where reach is missing, record that as a distribution constraint rather than compensating with a larger calendar.

Test one meaningful variable at a time when possible: the problem addressed, the example, the opening, or the CTA. Record observation windows and exposure. Small organic samples can suggest the next experiment; they do not establish causality or a universal winning hook.

The inspected [performance code](C:/Users/THIS-PC/Documents/flusso/lib/performance.ts:51) sorts patterns first by engagement rate, then click-through rate, then conversions. For a conversion campaign, the recommendation layer should consider its goal before selecting a winner. Use comparable channel, audience, format, and observation windows, and retain sample sizes.

## Measurement

| Dimension | Useful measures | Decision it supports |
| --- | --- | --- |
| Editorial quality | Supported-claim rate, correction rate, review acceptance, usefulness assessments | Whether material meets the publication standard |
| Content health | Stale evidence, overdue reviews, broken dependencies, terminology inconsistencies | What to repair or retire |
| Production | Editor minutes per approved asset, turnaround, factual consistency across variants | Whether reuse is reducing useful work |
| Retrieval | Expected evidence recall, citation support, unsupported-answer behavior, latency, cost | Which retrieval changes to retain |
| Audience response | Qualified engagement, relevant replies, clicks with denominators | Which needs and presentations merit another test |
| Business results | Qualified inquiries, trial activation, completed campaigns, paid conversion where measurable | Whether publishing supports the commercial goal |

Set numerical targets after establishing a baseline. Compare rates with their denominators, distinguish missing data from zero results, and avoid combining unlike platform metrics into one unexplained score.

## Suggested four-week pilot

This is a proposed sequence, rather than an estimate or a commitment to implementation.

| Week | Architecture work | Publishing work | Reviewable result |
| --- | --- | --- | --- |
| 1 | Inventory one existing campaign, trace its claims, and identify extraction and provenance gaps | Validate the audience problem and review existing content and distribution | Baseline, audience hypotheses, initial decision records |
| 2 | Model a small set of claims, passages, source versions, and vocabulary terms | Create one anchor and a few purposeful variants | A source-to-asset example with editorial review notes |
| 3 | Compare retrieval candidates against the fixed question set where retrieval is needed | Run a focused publishing experiment on selected channels | Retrieval results, publication records, production time |
| 4 | Review freshness, corrections, reuse, and measured failures | Assess audience and business signals and choose the next series | A decision to extend, revise, or stop each experiment |

First concrete deliverable: one campaign whose strategy decisions, factual claims, source passages, variants, and outcomes can be inspected together. That pilot gives a basis for deciding which larger investments are justified.

## Reading order and research limits

For immediate strategy work: Lovinger → Sanity → the Designing Connected Content outline → Hedden and SKOS → McGrane → Brain Traffic and Write the Docs. For retrieval decisions: Pinecone → Anthropic → the RAG course syllabus → Unstructured's technical documentation. Use Schema.org, llms.txt, and Google's guidance when designing public delivery.

All 15 supplied links were checked. The DeepLearning.AI page blocked direct access, so the provider's Coursera syllabus was used. The supplied DITA route failed, so the accessible committee home and topic specification were used. Books were assessed through public descriptions and contents, the course through its syllabus, and the podcast through the archive and a selected episode. This research does not claim complete reading of books, course attendance, or a survey of the entire podcast archive.

Vendor documentation establishes the documented method or product behavior described here. It does not independently establish performance on Flusso's corpus. Proposed audiences, cadences, series, and commercial effects need first-party validation.
