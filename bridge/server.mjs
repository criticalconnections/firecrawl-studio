import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = Number(process.env.AGENT_BRIDGE_PORT || 8787);
const HOST = process.env.AGENT_BRIDGE_HOST || "127.0.0.1";
const BRIDGE_TOKEN = process.env.AGENT_BRIDGE_TOKEN || "";
const WORKSPACE = resolve(process.env.AGENT_BRIDGE_WORKSPACE || process.cwd());
const ALLOWED_ORIGINS = new Set(
  (process.env.AGENT_BRIDGE_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function json(res, status, payload, origin) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...corsHeaders(origin),
  });
  res.end(body);
}

function corsHeaders(origin) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://127.0.0.1:5173";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-agent-bridge-token",
    "access-control-max-age": "300",
  };
}

function getHeader(req, name) {
  return req.headers[name.toLowerCase()];
}

function isAuthorized(req) {
  if (!BRIDGE_TOKEN) {
    return true;
  }
  const auth = String(getHeader(req, "authorization") || "");
  const token = String(getHeader(req, "x-agent-bridge-token") || "");
  return auth === `Bearer ${BRIDGE_TOKEN}` || token === BRIDGE_TOKEN;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

async function runOpenAI({ apiKey, model, handoff }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requireString(apiKey, "OpenAI API key")}`,
    },
    body: JSON.stringify({
      model: model || "gpt-5.5",
      input: handoff,
    }),
  });

  const data = await response.json().catch(async () => ({
    error: { message: await response.text() },
  }));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}.`);
  }

  const text =
    typeof data.output_text === "string"
      ? data.output_text
      : Array.isArray(data.output)
        ? data.output
            .flatMap((item) => item.content ?? [])
            .map((part) => part.text ?? "")
            .filter(Boolean)
            .join("\n")
        : "";

  return {
    provider: "openai",
    model: data.model || model,
    id: data.id,
    text,
    raw: data,
  };
}

async function runClaude({ apiKey, model, handoff }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requireString(apiKey, "Claude API key"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-opus-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: handoff }],
    }),
  });

  const data = await response.json().catch(async () => ({
    error: { message: await response.text() },
  }));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude returned HTTP ${response.status}.`);
  }

  const text = Array.isArray(data.content)
    ? data.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";

  return {
    provider: "claude",
    model: data.model || model,
    id: data.id,
    text,
    raw: data,
  };
}

async function runCodexHarness({ handoff }) {
  const dir = resolve(WORKSPACE, ".firecrawl-studio");
  const handoffPath = resolve(dir, "CODEX_HANDOFF.md");
  await mkdir(dir, { recursive: true });
  await writeFile(handoffPath, handoff, "utf8");

  return {
    provider: "codex",
    status: "handoff_saved",
    handoffPath,
    command: 'codex "Read .firecrawl-studio/CODEX_HANDOFF.md and continue from the Firecrawl handoff."',
    text:
      "Saved CODEX_HANDOFF.md for Codex. Run the command from this repo, or point your OpenClaw Codex harness at the saved handoff.",
  };
}

async function handleRun(payload) {
  const provider = requireString(payload.provider, "provider");
  const handoff = requireString(payload.handoff, "handoff");

  if (provider === "openai") {
    return runOpenAI({
      apiKey: payload.apiKey,
      model: payload.model,
      handoff,
    });
  }
  if (provider === "claude") {
    return runClaude({
      apiKey: payload.apiKey,
      model: payload.model,
      handoff,
    });
  }
  if (provider === "codex") {
    return runCodexHarness({ handoff });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

const server = createServer(async (req, res) => {
  const origin = String(getHeader(req, "origin") || "");
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (!ALLOWED_ORIGINS.has(origin) && origin) {
    json(res, 403, { ok: false, error: "Origin is not allowed." }, origin);
    return;
  }

  if (!isAuthorized(req)) {
    json(res, 401, { ok: false, error: "Agent bridge token is invalid." }, origin);
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        providers: ["codex", "openai", "claude"],
        workspace: WORKSPACE,
        tokenRequired: Boolean(BRIDGE_TOKEN),
      }, origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      const payload = await readJson(req);
      const output = await handleRun(payload);
      json(res, 200, { ok: true, output }, origin);
      return;
    }

    json(res, 404, { ok: false, error: "Route not found." }, origin);
  } catch (error) {
    json(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Agent bridge failed.",
    }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Firecrawl Studio agent bridge listening on http://${HOST}:${PORT}`);
});
