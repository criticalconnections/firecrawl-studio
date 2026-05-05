# Firecrawl Studio

A local Vite + React UI for Firecrawl v2. Point it at a self-hosted Firecrawl API, or switch the base URL to the hosted cloud endpoint.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## macOS

This UI runs on macOS, Windows, and Linux. Install Node.js 22 or a current LTS release, then use the same commands above.

For a free local Firecrawl API on a Mac, install Docker Desktop, clone the upstream Firecrawl backend, create its `.env`, and run:

```bash
docker compose up -d --build
```

Then set this UI's base URL to `http://localhost:3002/v2` and leave the API key blank.

## Notes

- The default base URL is `http://localhost:3002/v2`.
- API keys are only stored in local storage when `Remember key` is enabled.
- Crawl and Agent requests can auto-poll their returned job IDs.
- If a browser request cannot reach your self-hosted API, enable CORS on the Firecrawl host or serve this UI from the same origin.
- The self-hosted Firecrawl stack is heavier than this UI. On a MacBook, give Docker enough memory for the API, browser worker, Redis, RabbitMQ, and Postgres.
- Do not commit local `.env` files or the generated `dist/` and `node_modules/` folders.
