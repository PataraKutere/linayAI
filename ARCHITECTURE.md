# LinayAI — server architecture

## Deployed components

- Frontend: GitHub Pages (index.html, config.js, sw.js).
- API: Cloudflare Worker snowy-meadow-02d9.
- Main model: Cloudflare Workers AI @cf/openai/gpt-oss-120b.
- Model fallback: @cf/qwen/qwen3.8-27b, then Gemini Flash Lite.
- Vision: @cf/qwen/qwen3.8-27b.
- Memory and document text: Cloudflare D1 database linayai-memory (EU jurisdiction).
- Semantic retrieval: Cloudflare Vectorize index linayai-knowledge, 1,024 dimensions, cosine similarity, BGE-M3 embeddings, with a D1 keyword fallback while vector mutations propagate.
- Tests: GitHub Actions workflow .github/workflows/linay-ai-tests.yml.

## API routes

- GET /health — service and binding status.
- POST /chat — chat, model fallback, optional web search and agent mode.
- GET /search?q=... — independent search diagnostics.
- POST /memory and GET /memory?userId=... — explicit user memory.
- POST /documents — chunk, embed and index extracted text.
- GET /documents?userId=... — list a user's indexed documents.
- DELETE /documents/:id?userId=... — remove document chunks and vectors.
- GET /metrics — aggregate operational metrics for the last seven days.
- POST /image — image generation.

## Web search provider order

1. SearXNG, when SEARXNG_URL is configured as a Worker secret.
2. Brave Search, when BRAVE_SEARCH_API_KEY is configured as a Worker secret.
3. Bing HTML search.
4. DuckDuckGo HTML search (no API key).
5. Wikipedia search as a final independent fallback.
6. Gemini Google Search grounding is attempted by the chat route if independent providers fail.

A provider is not described as successful unless it returns actual results. The Worker reports failure if all providers fail.

## RAG and supported documents

The browser extracts text from PDF (PDF.js), DOCX (Mammoth), XLSX (SheetJS), and plain text / Markdown / CSV / JSON / source files. Extracted text is chunked, embedded with BGE-M3, and indexed in Vectorize with userId metadata. Original binary files are not retained; text chunks are stored in D1. R2 is currently not enabled on the Cloudflare account. Enabling R2 is only needed if original binary files should also be archived.

## Memory

The browser creates a random client identifier and sends it with chat and memory requests. Explicit memory is stored in D1. Recent user and assistant turns are also stored for server-side context. This is a per-browser identity, not a full login/account system.

## Agent tools

The optional agent mode can plan up to four tool steps using:
- web search,
- safe public URL reading,
- calculator,
- current time (Europe/Istanbul by default),
- private document knowledge search.

## Diagnostics and quality

/metrics aggregates model, chat, search, agent and document events. The GitHub Actions workflow runs live smoke tests for:
- service and storage bindings,
- logical entailment,
- race-position reasoning,
- arithmetic,
- persistent memory round-trip,
- document indexing,
- agent mode,
- web search,
- diagnostics.

Run it manually from GitHub Actions with workflow_dispatch.

## Optional provider secrets

Set these only in Cloudflare Worker secrets (never in config.js or browser code):
- SEARXNG_URL
- BRAVE_SEARCH_API_KEY

GEMINI_API_KEY is already retained as a Worker secret for backup and Google Search grounding.

## Important limitations

- Public free search endpoints can rate-limit or block automated requests. The independent search chain and Gemini fallback are designed to fail visibly rather than invent sources.
- D1 stores extracted text, not the original file binary. Enable R2 in the Cloudflare Dashboard if original uploads must be retained.
- The client identifier is not authentication. A future public release with multiple unrelated users should add a login/session system and stronger per-user authorization.
- Workers AI usage and model availability are subject to Cloudflare account quotas, model availability and pricing.
