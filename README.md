# Firecrawl Studio

A local Vite + React UI for Firecrawl v2. Point it at a self-hosted Firecrawl API, or switch the base URL to the hosted cloud endpoint.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Local Screenshots With Browserless

Self-hosted Firecrawl does not include Fire Engine, so this UI can use Browserless as a local screenshot sidecar. Start it with:

```bash
docker compose -f docker-compose.browserless.yml up -d
```

The UI defaults to:

```text
Browserless URL: http://localhost:3003
Browserless token: localdev
```

When the Screenshot format is enabled, Scrape and Crawl requests send normal scraping work to Firecrawl and capture the target URL image through Browserless. The screenshot is attached to the response and appears in the Media tab.

## Codex Handoff

The results viewer includes an Agent tab. After any run, it packages the Firecrawl prompt, request payload, extracted evidence, links, media references, and full JSON into a `CODEX_HANDOFF.md` prompt. Copy that into Codex, or export the file and run:

```bash
codex "Read CODEX_HANDOFF.md and continue from the Firecrawl handoff."
```

## Agent Runtime Connections

Connection settings include an Agent runtime picker:

- `Codex harness` uses a local bridge URL, defaulting to `http://127.0.0.1:8787`.
- `OpenAI key` stores an OpenAI API key and model for a direct provider bridge.
- `Claude key` stores an Anthropic API key and model for a direct provider bridge.

Secrets are only persisted when `Remember secrets` is enabled. The browser UI records provider settings and builds the handoff payload; a local bridge should perform actual model or harness execution so provider keys and command execution stay off the public browser surface.

Start the local bridge in a second terminal:

```bash
npm run agent-bridge
```

The bridge listens on `http://127.0.0.1:8787` and exposes:

```text
GET  /health
POST /api/agent/run
```

For `Codex harness`, the bridge writes `.firecrawl-studio/CODEX_HANDOFF.md` and returns the Codex command to run. For `OpenAI key` and `Claude key`, the bridge calls the provider API from localhost so API keys do not have to be sent directly from the browser to third-party APIs.

The Firecrawl `Agent` endpoint is different from the Agent runtime picker. In the self-hosted Firecrawl container, `/v2/agent` may return `Agent beta is not enabled` unless `EXTRACT_V3_BETA_URL` points at Firecrawl's beta extraction service. To keep local use working, Studio's Agent mode detects a localhost Firecrawl base URL, scrapes the listed URLs for evidence, and sends the generated handoff to the selected runtime instead of calling `/v2/agent`.

On Firecrawl Cloud or another API where `/v2/agent` is enabled, Agent mode still uses the Firecrawl endpoint directly.

Agent mode includes a mission builder before you run:

- Add one or more website sources with the `Add URL` control.
- Choose per-source behavior: exact page scrape, bounded crawl, or URL map.
- Set per-source page caps, depth, include/exclude paths, domain rules, sitemap use, and focus notes.
- Choose output shape, citations, evidence snippets, deduplication, and strict URL scope.

For an OpenClaw-style native Codex harness, enable the bundled `codex` plugin in OpenClaw and set the agent runtime to Codex:

```js
{
  plugins: {
    entries: {
      codex: { enabled: true },
    },
  },
  agents: {
    defaults: {
      model: "openai/gpt-5.5",
      agentRuntime: { id: "codex" },
    },
  },
}
```

## macOS

This UI runs on macOS, Windows, and Linux. Install Node.js 22 or a current LTS release, then use the same commands above.

For a free local Firecrawl API on a Mac, install Docker Desktop, clone the upstream Firecrawl backend, create its `.env`, and run:

```bash
docker compose up -d --build
```

Then set this UI's base URL to `http://localhost:3002/v2` and leave the API key blank.

## Notes

- The default base URL is `http://localhost:3002/v2`.
- The default screenshot engine is Browserless at `http://localhost:3003`.
- API keys are only stored in local storage when `Remember secrets` is enabled.
- Crawl and Agent requests can auto-poll their returned job IDs.
- If a browser request cannot reach your self-hosted API, enable CORS on the Firecrawl host or serve this UI from the same origin.
- If Browserless requests fail from the browser, keep CORS enabled on the Browserless sidecar or serve the UI and sidecar behind the same origin.
- The self-hosted Firecrawl stack is heavier than this UI. On a MacBook, give Docker enough memory for the API, browser worker, Redis, RabbitMQ, and Postgres.
- Do not commit local `.env` files or the generated `dist/` and `node_modules/` folders.
