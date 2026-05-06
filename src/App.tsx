import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  CircleHelp,
  Clipboard,
  Clock3,
  Code2,
  Compass,
  Download,
  FileJson,
  Flame,
  Globe2,
  History,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  Map as MapIcon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { gsap } from "gsap";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type Mode = "scrape" | "crawl" | "map" | "search" | "agent";
type ResultTab = "summary" | "markdown" | "links" | "media" | "codex" | "json";
type JsonRecord = Record<string, unknown>;
type FirecrawlFormat = string | JsonRecord;
type AgentSourceMode = "scrape" | "crawl" | "map";
type AgentOutputMode = "brief" | "report" | "table" | "json" | "codex";

type Settings = {
  baseUrl: string;
  apiKey: string;
  rememberKey: boolean;
  autoPoll: boolean;
  pollEvery: number;
  agentProvider: "openai" | "claude" | "codex";
  openaiApiKey: string;
  openaiModel: string;
  claudeApiKey: string;
  claudeModel: string;
  codexHarnessUrl: string;
  codexHarnessToken: string;
  screenshotProvider: "browserless" | "firecrawl";
  browserlessUrl: string;
  browserlessToken: string;
};

type RunRecord = {
  id: string;
  mode: Mode;
  target: string;
  createdAt: string;
  status: string;
  detail: string;
};

type RequestRecord = {
  url: string;
  method: "POST" | "GET";
  payload?: JsonRecord;
};

type AgentSource = {
  id: string;
  url: string;
  label: string;
  mode: AgentSourceMode;
  limit: number;
  depth: number;
  includePaths: string;
  excludePaths: string;
  instruction: string;
  stayOnDomain: boolean;
  useSitemap: boolean;
};

type LinkItem = {
  url: string;
  title?: string;
  description?: string;
  source?: string;
};

type MediaItem = {
  url: string;
  label: string;
};

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="help-tooltip" tabIndex={0} aria-label={text} title={text}>
      <CircleHelp size={13} />
      <span className="tooltip-panel" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function SwitchControl({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`switch-card ${checked ? "checked" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span />
      </span>
      <span className="switch-copy">
        <strong>
          {label}
          <HelpTooltip text={description} />
        </strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

const SETTINGS_KEY = "firecrawl-studio-settings";
const HISTORY_KEY = "firecrawl-studio-history";
const legacyDefaultAgentPrompt =
  "Find the key self-hosting requirements and return a concise setup checklist.";

const defaultSettings: Settings = {
  baseUrl: "http://localhost:3002/v2",
  apiKey: "",
  rememberKey: false,
  autoPoll: true,
  pollEvery: 2500,
  agentProvider: "codex",
  openaiApiKey: "",
  openaiModel: "gpt-5.5",
  claudeApiKey: "",
  claudeModel: "claude-opus-4-6",
  codexHarnessUrl: "http://127.0.0.1:8787",
  codexHarnessToken: "",
  screenshotProvider: "browserless",
  browserlessUrl: "http://localhost:3003",
  browserlessToken: "localdev",
};

const agentProviderOptions: Array<{
  value: Settings["agentProvider"];
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    value: "codex",
    label: "Codex harness",
    detail: "Use a local app-server bridge.",
    icon: TerminalSquare,
  },
  {
    value: "openai",
    label: "OpenAI key",
    detail: "Use a direct OpenAI API key.",
    icon: Sparkles,
  },
  {
    value: "claude",
    label: "Claude key",
    detail: "Use an Anthropic API key.",
    icon: WandSparkles,
  },
];

const modeConfig: Record<
  Mode,
  { label: string; description: string; path: string; icon: LucideIcon }
> = {
  scrape: {
    label: "Scrape",
    description: "Capture one page as markdown, links, HTML, images, or JSON.",
    path: "/scrape",
    icon: Code2,
  },
  crawl: {
    label: "Crawl",
    description: "Start a site crawl and poll the job until results arrive.",
    path: "/crawl",
    icon: Layers3,
  },
  map: {
    label: "Map",
    description: "Discover URLs before deciding what deserves a full scrape.",
    path: "/map",
    icon: MapIcon,
  },
  search: {
    label: "Search",
    description: "Run web, news, or image search with optional scraping.",
    path: "/search",
    icon: Search,
  },
  agent: {
    label: "Agent",
    description: "Ask Firecrawl to navigate and extract using a prompt.",
    path: "/agent",
    icon: WandSparkles,
  },
};

const resultTabConfig: Record<ResultTab, { label: string; icon: LucideIcon }> = {
  summary: { label: "Summary", icon: Activity },
  markdown: { label: "Markdown", icon: Code2 },
  links: { label: "Links", icon: Link2 },
  media: { label: "Media", icon: ArrowDownToLine },
  codex: { label: "Agent", icon: WandSparkles },
  json: { label: "JSON", icon: Braces },
};

const tbsOptions = [
  { value: "", label: "Any time" },
  { value: "qdr:h", label: "Past hour" },
  { value: "qdr:d", label: "Past day" },
  { value: "qdr:w", label: "Past week" },
  { value: "qdr:m", label: "Past month" },
  { value: "qdr:y", label: "Past year" },
];

const agentSourceModeOptions: Array<{
  value: AgentSourceMode;
  label: string;
  detail: string;
}> = [
  { value: "scrape", label: "Exact page", detail: "Scrape only this URL." },
  { value: "crawl", label: "Crawl site", detail: "Follow pages within limits." },
  { value: "map", label: "Map URLs", detail: "Discover candidate pages first." },
];

const agentOutputOptions: Array<{ value: AgentOutputMode; label: string }> = [
  { value: "brief", label: "Brief" },
  { value: "report", label: "Research report" },
  { value: "table", label: "Comparison table" },
  { value: "json", label: "Structured JSON" },
  { value: "codex", label: "Agent handoff" },
];

const agentPromptProfiles: Record<
  AgentOutputMode,
  {
    role: string;
    description: string;
    example: string;
    workflow: string[];
    outputContract: string[];
    qualityBar: string[];
  }
> = {
  brief: {
    role: "a concise research analyst who turns messy crawl evidence into decision-ready notes",
    description: "Short synthesis with the most important facts, gaps, and next actions.",
    example: "Summarize what this company does, who it serves, and the clearest next-step recommendation.",
    workflow: [
      "Scan all sources before answering so the brief reflects the full evidence set.",
      "Group overlapping findings and keep only the strongest, most useful points.",
      "Call out uncertainty, missing information, and contradictions instead of smoothing them over.",
    ],
    outputContract: [
      "Start with a one-sentence answer.",
      "Use 5 to 9 bullets grouped by theme.",
      "End with a compact next-step recommendation.",
    ],
    qualityBar: [
      "No filler, no generic web-scraping advice, and no ungrounded claims.",
      "Prefer concrete details, thresholds, requirements, and URLs over broad summaries.",
    ],
  },
  report: {
    role: "a senior web research analyst building a cited, executive-quality research memo",
    description: "Full narrative memo with findings, evidence, tradeoffs, and recommendations.",
    example: "Research this business and produce a clear positioning memo with strengths, gaps, and recommendations.",
    workflow: [
      "Read the evidence as a set, then identify the core question, stakeholders, and decision pressure.",
      "Separate facts found in the crawl from inferences you make from those facts.",
      "Resolve duplicate pages, repeated claims, and source conflicts before writing the final answer.",
    ],
    outputContract: [
      "Use sections: Executive Summary, Key Findings, Evidence, Gaps/Risks, Recommendation.",
      "Keep paragraphs tight and scannable.",
      "Include citations or source URLs beside claims when citations are enabled.",
    ],
    qualityBar: [
      "Make the recommendation useful even if the evidence is incomplete.",
      "Name what you still do not know and what should be crawled next.",
    ],
  },
  table: {
    role: "a comparison analyst who converts crawl evidence into clean decision tables",
    description: "Structured comparison table with consistent criteria and source-backed notes.",
    example: "Compare the listed websites by offer, audience, proof points, pricing signals, and conversion paths.",
    workflow: [
      "Infer comparison dimensions from the user's objective and source focus notes.",
      "Normalize equivalent concepts across sites before filling the table.",
      "Leave unknown cells as unknown rather than guessing.",
    ],
    outputContract: [
      "Start with a concise takeaway.",
      "Return a Markdown table with stable, comparable columns.",
      "After the table, list the strongest differentiators and unresolved gaps.",
    ],
    qualityBar: [
      "Every row should be comparable across sources.",
      "Avoid oversized prose blocks inside table cells.",
    ],
  },
  json: {
    role: "a strict extraction engine that converts crawl evidence into validated structured data",
    description: "Machine-readable JSON response, especially useful with an attached schema.",
    example: "Extract the company name, services, audience, contact paths, proof points, and notable risks as JSON.",
    workflow: [
      "Identify the entities, fields, and relationships implied by the user's objective.",
      "Use null, empty arrays, or explicit confidence fields when evidence is missing.",
      "Do not include commentary outside the JSON unless the schema asks for it.",
    ],
    outputContract: [
      "Return valid JSON only.",
      "Conform to the attached schema when one is provided.",
      "Include source URLs or evidence references in fields when citations are enabled.",
    ],
    qualityBar: [
      "The output must parse without cleanup.",
      "Do not invent values to satisfy required fields.",
    ],
  },
  codex: {
    role: "an agent handoff architect who turns web evidence into an implementation-ready brief",
    description: "Developer-focused handoff with repo implications, tasks, and verification guidance.",
    example: "Turn this site evidence into a developer-ready implementation brief with tasks and verification steps.",
    workflow: [
      "Translate the user's objective and web evidence into concrete engineering intent.",
      "Separate product facts, implementation assumptions, and open questions.",
      "Prepare the next agent to inspect the repo before editing and to preserve unrelated user changes.",
    ],
    outputContract: [
      "Use sections: Goal, Evidence, Implementation Direction, Files To Inspect, Risks, Verification.",
      "Write precise tasks that another coding agent can execute.",
      "Include commands or checks that would prove the work is done.",
    ],
    qualityBar: [
      "Avoid vague implementation advice.",
      "Make the handoff actionable without requiring the next agent to reread every raw crawl artifact.",
    ],
  },
};

const defaultSchema = `{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "summary": { "type": "string" }
  },
  "required": ["title"]
}`;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as T;
    }
    if (isRecord(parsed) && isRecord(fallback)) {
      return { ...fallback, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

function normalizeBaseUrl(value: string | null | undefined) {
  const clean = (typeof value === "string" && value.trim() ? value : defaultSettings.baseUrl)
    .trim()
    .replace(/\/+$/, "");
  if (/\/v[12]$/i.test(clean)) {
    return clean;
  }
  return `${clean}/v2`;
}

function normalizeServiceUrl(value: string | null | undefined, fallback: string) {
  return (typeof value === "string" && value.trim() ? value : fallback).trim().replace(/\/+$/, "");
}

function isLocalUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSettings(value: unknown): Settings {
  const candidate = isRecord(value) ? value : {};
  const agentProvider =
    candidate.agentProvider === "openai" ||
    candidate.agentProvider === "claude" ||
    candidate.agentProvider === "codex"
      ? candidate.agentProvider
      : defaultSettings.agentProvider;
  const screenshotProvider =
    candidate.screenshotProvider === "browserless" ||
    candidate.screenshotProvider === "firecrawl"
      ? candidate.screenshotProvider
      : defaultSettings.screenshotProvider;

  return {
    ...defaultSettings,
    ...candidate,
    baseUrl:
      typeof candidate.baseUrl === "string" ? candidate.baseUrl : defaultSettings.baseUrl,
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : defaultSettings.apiKey,
    rememberKey:
      typeof candidate.rememberKey === "boolean"
        ? candidate.rememberKey
        : defaultSettings.rememberKey,
    autoPoll:
      typeof candidate.autoPoll === "boolean" ? candidate.autoPoll : defaultSettings.autoPoll,
    pollEvery:
      typeof candidate.pollEvery === "number" && Number.isFinite(candidate.pollEvery)
        ? candidate.pollEvery
        : defaultSettings.pollEvery,
    agentProvider,
    openaiApiKey:
      typeof candidate.openaiApiKey === "string"
        ? candidate.openaiApiKey
        : defaultSettings.openaiApiKey,
    openaiModel:
      typeof candidate.openaiModel === "string" && candidate.openaiModel.trim()
        ? candidate.openaiModel
        : defaultSettings.openaiModel,
    claudeApiKey:
      typeof candidate.claudeApiKey === "string"
        ? candidate.claudeApiKey
        : defaultSettings.claudeApiKey,
    claudeModel:
      typeof candidate.claudeModel === "string" && candidate.claudeModel.trim()
        ? candidate.claudeModel
        : defaultSettings.claudeModel,
    codexHarnessUrl:
      typeof candidate.codexHarnessUrl === "string" && candidate.codexHarnessUrl.trim()
        ? candidate.codexHarnessUrl
        : defaultSettings.codexHarnessUrl,
    codexHarnessToken:
      typeof candidate.codexHarnessToken === "string"
        ? candidate.codexHarnessToken
        : defaultSettings.codexHarnessToken,
    screenshotProvider,
    browserlessUrl:
      typeof candidate.browserlessUrl === "string" && candidate.browserlessUrl.trim()
        ? candidate.browserlessUrl
        : defaultSettings.browserlessUrl,
    browserlessToken:
      typeof candidate.browserlessToken === "string"
        ? candidate.browserlessToken
        : defaultSettings.browserlessToken,
  };
}

function compactObject(object: JsonRecord) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      return true;
    }),
  );
}

function parseList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      throw new Error("Expected an object");
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function createId() {
  return window.crypto?.randomUUID?.() ?? String(Date.now());
}

function createAgentSource(url = ""): AgentSource {
  return {
    id: createId(),
    url,
    label: "",
    mode: "crawl",
    limit: 8,
    depth: 1,
    includePaths: "",
    excludePaths: "",
    instruction: "",
    stayOnDomain: true,
    useSitemap: true,
  };
}

function getStatus(value: unknown) {
  if (!isRecord(value)) {
    return "ready";
  }
  if (typeof value.status === "string") {
    return value.status;
  }
  if (value.success === true) {
    return "success";
  }
  if (value.success === false) {
    return "failed";
  }
  return "ready";
}

function getJobId(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id === "string") {
    return value.id;
  }
  if (isRecord(value.data) && typeof value.data.id === "string") {
    return value.data.id;
  }
  return null;
}

function getWarning(value: unknown) {
  if (isRecord(value) && typeof value.warning === "string") {
    return value.warning;
  }
  return "";
}

function needsScreenshotEngineContext(message: string) {
  return (
    message.includes("SCRAPE_ALL_ENGINES_FAILED") ||
    message.includes("Engines tried: []")
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read screenshot image."));
    reader.readAsDataURL(blob);
  });
}

function detectImageMime(bytes: Uint8Array, fallback: string) {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return fallback || "image/png";
}

function normalizeScreenshotTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Browserless screenshots need a target URL.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new Error(
      "Browserless screenshots need a valid http(s) URL, such as https://example.com.",
    );
  }
}

function browserlessErrorMessage(value: string, status: number) {
  if (
    value.includes("Cannot navigate to invalid URL") ||
    value.includes("ProtocolError") ||
    value.includes("invalid URL")
  ) {
    return "Browserless needs a POST request with a valid http(s) URL. Use the Studio UI, or post JSON like { \"url\": \"https://example.com\" } to /screenshot.";
  }
  return value.trim() || `Browserless returned HTTP ${status}.`;
}

function terminalStatus(status: string) {
  return ["completed", "success", "failed", "cancelled", "canceled", "error"].includes(
    status.toLowerCase(),
  );
}

function summarizeTarget(mode: Mode, payload: JsonRecord) {
  if (mode === "search") {
    return String(payload.query ?? "Search");
  }
  if (mode === "agent") {
    return String(payload.prompt ?? "Agent job").slice(0, 120);
  }
  return String(payload.url ?? "Firecrawl request");
}

function collectLinks(value: unknown) {
  const seen = new Set<string>();
  const links: LinkItem[] = [];

  const push = (item: LinkItem) => {
    if (!item.url || seen.has(item.url)) {
      return;
    }
    seen.add(item.url);
    links.push(item);
  };

  const visit = (node: unknown, source = "result", depth = 0) => {
    if (depth > 6) {
      return;
    }
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node)) {
        push({ url: node, source });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, source, depth + 1));
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    const url = node.url ?? node.sourceURL ?? node.sourceUrl;
    if (typeof url === "string") {
      push({
        url,
        title: typeof node.title === "string" ? node.title : undefined,
        description:
          typeof node.description === "string" ? node.description : undefined,
        source,
      });
    }

    Object.entries(node).forEach(([key, next]) => {
      const nextSource = ["web", "images", "news", "links", "data"].includes(key)
        ? key
        : source;
      visit(next, nextSource, depth + 1);
    });
  };

  visit(value);
  return links;
}

function collectStringsByKey(value: unknown, keyNames: string[]) {
  const values: string[] = [];

  const visit = (node: unknown, depth = 0) => {
    if (depth > 6) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    Object.entries(node).forEach(([key, next]) => {
      if (keyNames.includes(key) && typeof next === "string" && next.trim()) {
        values.push(next);
      }
      visit(next, depth + 1);
    });
  };

  visit(value);
  return values;
}

function collectMedia(value: unknown) {
  const seen = new Set<string>();
  const media: MediaItem[] = [];

  const push = (url: string, label: string) => {
    if (!url || seen.has(url)) {
      return;
    }
    if (/^(https?:\/\/|data:image\/)/i.test(url)) {
      seen.add(url);
      media.push({ url, label });
    }
  };

  const visit = (node: unknown, label = "media", depth = 0) => {
    if (depth > 6) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, label, depth + 1));
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    Object.entries(node).forEach(([key, next]) => {
      const lowerKey = key.toLowerCase();
      if (
        typeof next === "string" &&
        (lowerKey.includes("screenshot") ||
          lowerKey.includes("image") ||
          lowerKey === "thumbnail")
      ) {
        push(next, key);
      }
      visit(next, key, depth + 1);
    });
  };

  visit(value);
  return media;
}

function attachBrowserlessScreenshot(value: unknown, screenshot: string) {
  const browserlessMeta = {
    screenshot,
    screenshotProvider: "browserless",
    capturedAt: new Date().toISOString(),
  };

  if (isRecord(value)) {
    if (isRecord(value.data)) {
      return {
        ...value,
        data: {
          ...value.data,
          browserless: browserlessMeta,
        },
      };
    }

    return {
      ...value,
      browserless: browserlessMeta,
    };
  }

  return {
    success: true,
    data: {
      browserless: browserlessMeta,
      firecrawl: value,
    },
  };
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function truncateText(value: string, maxLength = 12000) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n\n[truncated ${(
    value.length - maxLength
  ).toLocaleString()} characters]`;
}

function agentProviderLabel(value: Settings["agentProvider"]) {
  return agentProviderOptions.find((option) => option.value === value)?.label ?? "Agent";
}

function resultDetail(value: unknown) {
  const links = collectLinks(value).length;
  const markdown = collectStringsByKey(value, ["markdown"]).length;
  const media = collectMedia(value).length;
  const dataCount =
    isRecord(value) && Array.isArray(value.data) ? value.data.length : undefined;

  if (dataCount) {
    return `${dataCount} records`;
  }
  if (links) {
    return `${links} links`;
  }
  if (markdown) {
    return `${markdown} markdown sections`;
  }
  if (media) {
    return `${media} media items`;
  }
  return "response captured";
}

export function App() {
  const shellRef = useRef<HTMLElement | null>(null);
  const commandCardRef = useRef<HTMLFormElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<Settings>(() =>
    normalizeSettings(readStorage(SETTINGS_KEY, defaultSettings)),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [mode, setMode] = useState<Mode>("scrape");
  const [targetUrl, setTargetUrl] = useState("https://docs.firecrawl.dev");
  const [searchQuery, setSearchQuery] = useState("firecrawl self hosted guide");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentSources, setAgentSources] = useState<AgentSource[]>(() => [
    createAgentSource("https://docs.firecrawl.dev"),
  ]);
  const [manualJobId, setManualJobId] = useState("");

  const [formats, setFormats] = useState({
    markdown: true,
    html: false,
    rawHtml: false,
    links: true,
    screenshot: false,
    json: false,
  });
  const [jsonPrompt, setJsonPrompt] = useState(
    "Extract the title, main topic, and useful links.",
  );
  const [jsonSchema, setJsonSchema] = useState(defaultSchema);
  const [useSchema, setUseSchema] = useState(false);
  const [screenshotQuality, setScreenshotQuality] = useState(80);
  const [screenshotFullPage, setScreenshotFullPage] = useState(true);

  const [onlyMainContent, setOnlyMainContent] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [blockAds, setBlockAds] = useState(true);
  const [removeBase64Images, setRemoveBase64Images] = useState(true);
  const [includeTags, setIncludeTags] = useState("");
  const [excludeTags, setExcludeTags] = useState("nav, footer, script");
  const [waitFor, setWaitFor] = useState(0);
  const [timeout, setTimeoutMs] = useState(60000);

  const [crawlLimit, setCrawlLimit] = useState(25);
  const [maxDepth, setMaxDepth] = useState(2);
  const [includePaths, setIncludePaths] = useState("");
  const [excludePaths, setExcludePaths] = useState("");
  const [crawlEntireDomain, setCrawlEntireDomain] = useState(false);
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [allowExternalLinks, setAllowExternalLinks] = useState(false);
  const [ignoreQueryParameters, setIgnoreQueryParameters] = useState(true);
  const [sitemap, setSitemap] = useState("include");

  const [mapSearch, setMapSearch] = useState("");
  const [mapLimit, setMapLimit] = useState(250);
  const [mapIncludeSubdomains, setMapIncludeSubdomains] = useState(false);

  const [searchLimit, setSearchLimit] = useState(5);
  const [searchSources, setSearchSources] = useState({
    web: true,
    news: false,
    images: false,
  });
  const [searchCategories, setSearchCategories] = useState({
    github: false,
    research: false,
    pdf: false,
  });
  const [searchTbs, setSearchTbs] = useState("");
  const [searchCountry, setSearchCountry] = useState("US");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchWithScrape, setSearchWithScrape] = useState(false);

  const [agentModel, setAgentModel] = useState("spark-1-mini");
  const [agentMaxCredits, setAgentMaxCredits] = useState(20);
  const [strictAgentUrls, setStrictAgentUrls] = useState(false);
  const [agentOutputMode, setAgentOutputMode] = useState<AgentOutputMode>("report");
  const [agentRequireCitations, setAgentRequireCitations] = useState(true);
  const [agentShowEvidence, setAgentShowEvidence] = useState(true);
  const [agentDeduplicate, setAgentDeduplicate] = useState(true);

  const [result, setResult] = useState<unknown>(null);
  const [lastRequest, setLastRequest] = useState<RequestRecord | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSendingAgent, setIsSendingAgent] = useState(false);
  const [agentBridgeResult, setAgentBridgeResult] = useState<unknown>(null);
  const [pollingStatus, setPollingStatus] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("summary");
  const [history, setHistory] = useState<RunRecord[]>(() =>
    readStorage(HISTORY_KEY, []),
  );
  const [copied, setCopied] = useState("");

  const resolvedBaseUrl = useMemo(
    () => normalizeBaseUrl(settings.baseUrl),
    [settings.baseUrl],
  );
  const localFirecrawl = useMemo(() => isLocalUrl(resolvedBaseUrl), [resolvedBaseUrl]);
  const resolvedBrowserlessUrl = useMemo(
    () => normalizeServiceUrl(settings.browserlessUrl, defaultSettings.browserlessUrl),
    [settings.browserlessUrl],
  );

  const links = useMemo(() => collectLinks(result), [result]);
  const markdownText = useMemo(
    () => collectStringsByKey(result, ["markdown"]).join("\n\n---\n\n"),
    [result],
  );
  const htmlText = useMemo(
    () => collectStringsByKey(result, ["html", "rawHtml"]).join("\n\n"),
    [result],
  );
  const mediaItems = useMemo(() => collectMedia(result), [result]);

  useEffect(() => {
    const storedSettings = {
      ...settings,
      apiKey: settings.rememberKey ? settings.apiKey : "",
      openaiApiKey: settings.rememberKey ? settings.openaiApiKey : "",
      claudeApiKey: settings.rememberKey ? settings.claudeApiKey : "",
      codexHarnessToken: settings.rememberKey ? settings.codexHarnessToken : "",
      browserlessToken: settings.rememberKey
        ? settings.browserlessToken
        : defaultSettings.browserlessToken,
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(storedSettings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  }, [history]);

  useEffect(() => {
    setAgentPrompt((current) => (current === legacyDefaultAgentPrompt ? "" : current));
  }, []);

  useLayoutEffect(() => {
    if (!shellRef.current) {
      return;
    }

    const context = gsap.context(() => {
      gsap.set([".hero-shell", ".command-card", ".settings-drawer"], {
        autoAlpha: 0,
        filter: "blur(10px)",
        y: 18,
      });

      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .to(".hero-shell", {
          autoAlpha: 1,
          filter: "blur(0px)",
          y: 0,
          duration: 0.7,
        })
        .to(
          ".command-card",
          {
            autoAlpha: 1,
            filter: "blur(0px)",
            y: 0,
            duration: 0.78,
          },
          "-=0.45",
        )
        .to(
          ".settings-drawer",
          {
            autoAlpha: 1,
            filter: "blur(0px)",
            y: 0,
            duration: 0.48,
          },
          "-=0.48",
        );

      gsap.delayedCall(0.62, () => {
        commandInputRef.current?.focus();
      });
    }, shellRef);

    return () => context.revert();
  }, []);

  useLayoutEffect(() => {
    if (!commandCardRef.current) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        ".command-input-row input",
        { autoAlpha: 0.72, x: -5 },
        { autoAlpha: 1, x: 0, duration: 0.26, ease: "power2.out" },
      );
      gsap.fromTo(
        ".command-tabs .active",
        { scale: 0.94 },
        { scale: 1, duration: 0.32, ease: "back.out(2.4)" },
      );
    }, commandCardRef);

    return () => context.revert();
  }, [mode]);

  useLayoutEffect(() => {
    if (!hasSubmitted || !workspaceRef.current) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        ".workspace-intro",
        { autoAlpha: 0, filter: "blur(10px)", y: 22 },
        { autoAlpha: 1, filter: "blur(0px)", y: 0, duration: 0.58, ease: "power3.out" },
      );
      gsap.fromTo(
        ".panel",
        { autoAlpha: 0, filter: "blur(12px)", scale: 0.985, y: 34 },
        {
          autoAlpha: 1,
          filter: "blur(0px)",
          scale: 1,
          y: 0,
          duration: 0.68,
          ease: "power3.out",
          stagger: 0.08,
        },
      );
    }, workspaceRef);

    window.setTimeout(() => {
      workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);

    return () => context.revert();
  }, [hasSubmitted]);

  useLayoutEffect(() => {
    if (!hasSubmitted || !workspaceRef.current) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        ".result-body",
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.34, ease: "power2.out" },
      );
      gsap.fromTo(
        ".metric-strip div",
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.28, ease: "power2.out", stagger: 0.04 },
      );
    }, workspaceRef);

    return () => context.revert();
  }, [activeTab, error, hasSubmitted, isRunning, pollingStatus, result]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateAgentSource<K extends keyof AgentSource>(
    id: string,
    key: K,
    value: AgentSource[K],
  ) {
    setAgentSources((current) =>
      current.map((source) => (source.id === id ? { ...source, [key]: value } : source)),
    );
  }

  function addAgentSource() {
    setAgentSources((current) => [...current, createAgentSource()]);
  }

  function removeAgentSource(id: string) {
    setAgentSources((current) =>
      current.length > 1 ? current.filter((source) => source.id !== id) : current,
    );
  }

  function agentSourceUrls() {
    return agentSources.map((source) => source.url.trim()).filter(Boolean);
  }

  function shouldUseBrowserlessScreenshot(selectedMode: Mode = mode) {
    return (
      formats.screenshot &&
      settings.screenshotProvider === "browserless" &&
      (selectedMode === "scrape" || selectedMode === "crawl")
    );
  }

  function buildFormats(includeFirecrawlScreenshot = true) {
    const selected: FirecrawlFormat[] = [];
    if (formats.markdown) selected.push("markdown");
    if (formats.html) selected.push("html");
    if (formats.rawHtml) selected.push("rawHtml");
    if (formats.links) selected.push("links");
    if (formats.screenshot && includeFirecrawlScreenshot) {
      selected.push({
        type: "screenshot",
        fullPage: screenshotFullPage,
        quality: screenshotQuality,
      });
    }
    if (formats.json) {
      const jsonFormat: JsonRecord = { type: "json" };
      if (jsonPrompt.trim()) {
        jsonFormat.prompt = jsonPrompt.trim();
      }
      if (useSchema) {
        const schema = parseJsonObject(jsonSchema, "JSON schema");
        if (schema) {
          jsonFormat.schema = schema;
        }
      }
      selected.push(jsonFormat);
    }

    return selected.length ? selected : ["markdown"];
  }

  function buildScrapeOptions(includeFirecrawlScreenshot = true) {
    return compactObject({
      formats: buildFormats(includeFirecrawlScreenshot),
      onlyMainContent,
      includeTags: parseList(includeTags),
      excludeTags: parseList(excludeTags),
      waitFor: waitFor > 0 ? waitFor : undefined,
      timeout: timeout > 0 ? timeout : undefined,
      mobile,
      blockAds,
      removeBase64Images,
    });
  }

  function buildPayload(
    selectedMode: Mode = mode,
    includeFirecrawlScreenshot = !shouldUseBrowserlessScreenshot(selectedMode),
  ): JsonRecord {
    if (selectedMode === "search") {
      const sources = Object.entries(searchSources)
        .filter(([, enabled]) => enabled)
        .map(([source]) => source);
      const categories = Object.entries(searchCategories)
        .filter(([, enabled]) => enabled)
        .map(([type]) => ({ type }));

      if (!searchQuery.trim()) {
        throw new Error("Search query is required.");
      }

      return compactObject({
        query: searchQuery.trim(),
        limit: searchLimit,
        sources: sources.length ? sources : ["web"],
        categories,
        tbs: searchTbs,
        country: searchCountry.trim().toUpperCase(),
        location: searchLocation.trim(),
        ignoreInvalidURLs: true,
        timeout,
        scrapeOptions: searchWithScrape
          ? buildScrapeOptions(includeFirecrawlScreenshot)
          : undefined,
      });
    }

    if (selectedMode === "agent") {
      if (!agentPrompt.trim()) {
        throw new Error("Describe the agent mission before running.");
      }
      const urls = agentSourceUrls();
      if (!urls.length) {
        throw new Error("Agent mode needs at least one website or URL.");
      }
      const schema = useSchema ? parseJsonObject(jsonSchema, "Agent schema") : undefined;
      return compactObject({
        prompt: agentPrompt.trim(),
        urls,
        schema,
        maxCredits: agentMaxCredits,
        strictConstrainToURLs: strictAgentUrls,
        model: agentModel,
      });
    }

    if (!targetUrl.trim()) {
      throw new Error("URL is required.");
    }

    if (selectedMode === "map") {
      return compactObject({
        url: targetUrl.trim(),
        search: mapSearch.trim(),
        sitemap,
        includeSubdomains: mapIncludeSubdomains,
        ignoreQueryParameters,
        limit: mapLimit,
        timeout,
      });
    }

    if (selectedMode === "crawl") {
      return compactObject({
        url: targetUrl.trim(),
        limit: crawlLimit,
        scrapeOptions: buildScrapeOptions(includeFirecrawlScreenshot),
        includePaths: parseList(includePaths),
        excludePaths: parseList(excludePaths),
        maxDiscoveryDepth: maxDepth > 0 ? maxDepth : undefined,
        crawlEntireDomain,
        allowSubdomains,
        allowExternalLinks,
        ignoreQueryParameters,
        sitemap,
      });
    }

    return compactObject({
      url: targetUrl.trim(),
      ...buildScrapeOptions(includeFirecrawlScreenshot),
    });
  }

  async function firecrawlRequest(
    path: string,
    method: "POST" | "GET",
    payload?: JsonRecord,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    }

    let response: Response;
    try {
      response = await fetch(`${resolvedBaseUrl}${path}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
      });
    } catch {
      throw new Error(
        "Could not reach Firecrawl. Check that the base URL is running and that CORS is enabled for this local UI.",
      );
    }

    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        isRecord(data) && typeof data.error === "string"
          ? data.error
          : isRecord(data) && typeof data.message === "string"
            ? data.message
            : `Firecrawl returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    return data;
  }

  async function agentBridgeRequest(handoff: string) {
    const bridgeUrl = normalizeServiceUrl(
      settings.codexHarnessUrl,
      defaultSettings.codexHarnessUrl,
    );
    const token = settings.codexHarnessToken.trim();
    const provider = settings.agentProvider;
    const response = await fetch(`${bridgeUrl}/api/agent/run`, {
      method: "POST",
      headers: compactObject({
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : undefined,
      }) as Record<string, string>,
      body: JSON.stringify({
        provider,
        handoff,
        model:
          provider === "openai"
            ? settings.openaiModel
            : provider === "claude"
              ? settings.claudeModel
              : undefined,
        apiKey:
          provider === "openai"
            ? settings.openaiApiKey
            : provider === "claude"
              ? settings.claudeApiKey
              : undefined,
      }),
    });

    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        isRecord(data) && typeof data.error === "string"
          ? data.error
          : `Agent bridge returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    return data;
  }

  async function browserlessScreenshot(url: string) {
    const screenshotUrl = normalizeScreenshotTarget(url);
    const query = new URLSearchParams();
    const token = settings.browserlessToken.trim();
    if (token) {
      query.set("token", token);
    }

    const endpoint = `${resolvedBrowserlessUrl}/screenshot${
      query.toString() ? `?${query.toString()}` : ""
    }`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: screenshotUrl,
          options: compactObject({
            type: "jpeg",
            fullPage: screenshotFullPage,
            quality: screenshotQuality,
            captureBeyondViewport: screenshotFullPage,
          }),
        }),
      });
    } catch {
      throw new Error(
        "Could not reach Browserless. Start the Browserless sidecar on port 3003 and enable CORS for this UI.",
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const text = await response.text();
      throw new Error(browserlessErrorMessage(text, response.status));
    }
    if (!contentType.toLowerCase().startsWith("image/")) {
      const text = await response.text();
      throw new Error(
        text.trim() ||
          "Browserless did not return an image. Check the screenshot endpoint and token.",
      );
    }

    const bytes = await response.arrayBuffer();
    const mime = detectImageMime(new Uint8Array(bytes), contentType);
    return blobToDataUrl(new Blob([bytes], { type: mime }));
  }

  function saveRun(payload: JsonRecord, response: unknown) {
    const record: RunRecord = {
      id: createId(),
      mode,
      target: summarizeTarget(mode, payload),
      createdAt: new Date().toISOString(),
      status: getStatus(response),
      detail: resultDetail(response),
    };
    setHistory((current) => [record, ...current].slice(0, 8));
  }

  async function pollJob(selectedMode: Extract<Mode, "crawl" | "agent">, jobId: string) {
    let latest: unknown = result;
    setPollingStatus(`Polling ${jobId}`);

    for (let attempt = 1; attempt <= 80; attempt += 1) {
      await sleep(settings.pollEvery);
      latest = await firecrawlRequest(
        `${modeConfig[selectedMode].path}/${encodeURIComponent(jobId)}`,
        "GET",
      );
      setResult(latest);
      const status = getStatus(latest);
      setPollingStatus(`${status} after ${attempt} check${attempt === 1 ? "" : "s"}`);
      if (terminalStatus(status)) {
        break;
      }
    }

    setPollingStatus("");
    return latest;
  }

  async function runLocalAgent(payload: JsonRecord) {
    if (!agentReady) {
      throw new Error(
        `Connect ${agentProviderLabel(settings.agentProvider)} before running the local Agent workflow.`,
      );
    }

    const sources = agentSources.filter((source) => source.url.trim());

    if (!sources.length) {
      throw new Error(
        "Local Agent mode needs at least one URL. Add a URL so Firecrawl can gather evidence before the agent runs.",
      );
    }

    const normalizedSources = sources.map((source) => ({
      ...source,
      url: normalizeScreenshotTarget(source.url),
      limit: Math.max(1, Math.min(source.limit || 1, 2500)),
      depth: Math.max(0, Math.min(source.depth || 0, 20)),
    }));
    const evidence: JsonRecord[] = [];

    for (const [index, source] of normalizedSources.entries()) {
      const label = source.label.trim() || `Source ${index + 1}`;
      setPollingStatus(`${source.mode === "crawl" ? "Crawling" : source.mode === "map" ? "Mapping" : "Scraping"} ${label}`);
      try {
        if (source.mode === "crawl") {
          const crawlPayload = compactObject({
            url: source.url,
            limit: source.limit,
            maxDiscoveryDepth: source.depth,
            includePaths: parseList(source.includePaths),
            excludePaths: parseList(source.excludePaths),
            allowExternalLinks: !source.stayOnDomain,
            allowSubdomains: !source.stayOnDomain,
            ignoreQueryParameters,
            sitemap: source.useSitemap ? "include" : "skip",
            scrapeOptions: buildScrapeOptions(false),
          });
          const started = await firecrawlRequest("/crawl", "POST", crawlPayload);
          const jobId = getJobId(started);
          const response = settings.autoPoll && jobId ? await pollJob("crawl", jobId) : started;
          evidence.push({
            label,
            url: source.url,
            mode: source.mode,
            instruction: source.instruction.trim() || undefined,
            request: crawlPayload,
            response,
          });
        } else if (source.mode === "map") {
          const mapPayload = compactObject({
            url: source.url,
            limit: source.limit,
            includeSubdomains: !source.stayOnDomain,
            ignoreQueryParameters,
            sitemap: source.useSitemap ? "include" : "skip",
            search: source.instruction.trim(),
            timeout,
          });
          const response = await firecrawlRequest("/map", "POST", mapPayload);
          evidence.push({
            label,
            url: source.url,
            mode: source.mode,
            instruction: source.instruction.trim() || undefined,
            request: mapPayload,
            response,
          });
        } else {
          const scrapePayload = {
            url: source.url,
            ...buildScrapeOptions(false),
          };
          const response = await firecrawlRequest("/scrape", "POST", scrapePayload);
          evidence.push({
            label,
            url: source.url,
            mode: source.mode,
            instruction: source.instruction.trim() || undefined,
            request: scrapePayload,
            response,
          });
        }
      } catch (caught) {
        evidence.push({
          label,
          url: source.url,
          mode: source.mode,
          instruction: source.instruction.trim() || undefined,
          success: false,
          error: caught instanceof Error ? caught.message : "Source run failed.",
        });
      }
    }

    const request: RequestRecord = {
      url: `${resolvedBaseUrl}/local-agent-runtime`,
      method: "POST",
      payload: {
        ...payload,
        runtime: settings.agentProvider,
        outputMode: agentOutputMode,
        requireCitations: agentRequireCitations,
        showEvidence: agentShowEvidence,
        deduplicate: agentDeduplicate,
        sources: normalizedSources.map((source) => ({
          label: source.label,
          url: source.url,
          mode: source.mode,
          limit: source.limit,
          depth: source.depth,
          includePaths: parseList(source.includePaths),
          excludePaths: parseList(source.excludePaths),
          instruction: source.instruction,
          stayOnDomain: source.stayOnDomain,
          useSitemap: source.useSitemap,
        })),
      },
    };
    const preparedResult = {
      success: true,
      status: "prepared",
      data: {
        mode: "local-agent-runtime",
        prompt: payload.prompt,
        urls: normalizedSources.map((source) => source.url),
        runtime: settings.agentProvider,
        outputMode: agentOutputMode,
        requireCitations: agentRequireCitations,
        showEvidence: agentShowEvidence,
        deduplicate: agentDeduplicate,
        note:
          "Self-hosted Firecrawl has the beta /v2/agent endpoint disabled, so Studio scraped the URLs locally and sent this evidence to the selected agent runtime.",
        evidence,
      },
    };

    setLastRequest(request);
    setResult(preparedResult);
    setPollingStatus(`Sending context to ${agentProviderLabel(settings.agentProvider)}`);
    const handoff = buildCodexHandoffFor(preparedResult, request);
    const bridgeResponse = await agentBridgeRequest(handoff);
    setAgentBridgeResult(bridgeResponse);

    const finalResult = {
      ...preparedResult,
      status: "completed",
      data: {
        ...preparedResult.data,
        agentResponse: bridgeResponse,
      },
    };

    setResult(finalResult);
    setActiveTab("codex");
    saveRun(payload, finalResult);
  }

  async function handleRun(event: FormEvent) {
    event.preventDefault();
    setHasSubmitted(true);
    setError("");
    setResult(null);
    setAgentBridgeResult(null);
    setPollingStatus("");
    setActiveTab("summary");
    setIsRunning(true);

    try {
      const captureWithBrowserless = shouldUseBrowserlessScreenshot();
      const payload = buildPayload(mode, !captureWithBrowserless);
      if (mode === "agent" && localFirecrawl) {
        await runLocalAgent(payload);
        return;
      }

      const request = {
        url: `${resolvedBaseUrl}${modeConfig[mode].path}`,
        method: "POST" as const,
        payload,
      };
      setLastRequest(request);
      const response = await firecrawlRequest(modeConfig[mode].path, "POST", payload);
      setResult(response);

      const jobId = getJobId(response);
      const shouldPoll = settings.autoPoll && jobId && (mode === "crawl" || mode === "agent");
      let finalResponse = shouldPoll
        ? await pollJob(mode as Extract<Mode, "crawl" | "agent">, jobId)
        : response;

      if (captureWithBrowserless) {
        setPollingStatus("Capturing screenshot with Browserless");
        const screenshot = await browserlessScreenshot(targetUrl.trim());
        finalResponse = attachBrowserlessScreenshot(finalResponse, screenshot);
        setResult(finalResponse);
        setPollingStatus("");
      }

      saveRun(payload, finalResponse);
    } catch (caught) {
      setPollingStatus("");
      const message = caught instanceof Error ? caught.message : "The request failed.";
      setError(
        formats.screenshot && needsScreenshotEngineContext(message)
          ? "Screenshot output needs Fire Engine/CDP or Firecrawl Cloud. This local API has Playwright for page scraping, but no screenshot-capable engine is enabled."
          : message,
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function handleCheckJob() {
    const jobId = manualJobId.trim();
    if (!jobId || (mode !== "crawl" && mode !== "agent")) {
      setError("Switch to Crawl or Agent and enter a job ID.");
      return;
    }
    setError("");
    setIsRunning(true);
    setLastRequest({
      url: `${resolvedBaseUrl}${modeConfig[mode].path}/${jobId}`,
      method: "GET",
    });
    try {
      const response = await firecrawlRequest(
        `${modeConfig[mode].path}/${encodeURIComponent(jobId)}`,
        "GET",
      );
      setResult(response);
      setActiveTab("summary");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Job lookup failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSendToAgent() {
    if (!codexHandoff) {
      setError("Run Firecrawl first so there is context to send to the agent.");
      return;
    }

    setError("");
    setIsSendingAgent(true);
    setActiveTab("codex");
    try {
      const response = await agentBridgeRequest(codexHandoff);
      setAgentBridgeResult(response);
    } catch (caught) {
      const message =
        caught instanceof TypeError
          ? "Could not reach the local agent bridge. Start it with npm run agent-bridge."
          : caught instanceof Error
            ? caught.message
            : "Agent bridge failed.";
      setError(message);
    } finally {
      setIsSendingAgent(false);
    }
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1200);
  }

  function downloadText(filename: string, value: string, type = "application/json") {
    const blob = new Blob([value], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function previewRequest() {
    try {
      const captureWithBrowserless = shouldUseBrowserlessScreenshot();
      const payload = buildPayload(mode, !captureWithBrowserless);
      const authHeader = settings.apiKey ? "\n  -H 'Authorization: Bearer ***'" : "";
      const firecrawlCurl = `curl -X POST '${resolvedBaseUrl}${modeConfig[mode].path}' \\\n  -H 'Content-Type: application/json'${authHeader} \\\n  -d '${JSON.stringify(payload, null, 2)}'`;

      if (mode === "agent" && localFirecrawl) {
        const urls = agentSources
          .filter((source) => source.url.trim())
          .map((source) => ({ ...source, url: normalizeScreenshotTarget(source.url) }))
          .map((source) => {
            const path = source.mode === "crawl" ? "/crawl" : source.mode === "map" ? "/map" : "/scrape";
            const localPayload =
              source.mode === "crawl"
                ? compactObject({
                    url: source.url,
                    limit: source.limit,
                    maxDiscoveryDepth: source.depth,
                    includePaths: parseList(source.includePaths),
                    excludePaths: parseList(source.excludePaths),
                    allowExternalLinks: !source.stayOnDomain,
                    allowSubdomains: !source.stayOnDomain,
                    ignoreQueryParameters,
                    sitemap: source.useSitemap ? "include" : "skip",
                    scrapeOptions: buildScrapeOptions(false),
                  })
                : source.mode === "map"
                  ? compactObject({
                      url: source.url,
                      limit: source.limit,
                      includeSubdomains: !source.stayOnDomain,
                      ignoreQueryParameters,
                      sitemap: source.useSitemap ? "include" : "skip",
                      search: source.instruction.trim(),
                      timeout,
                    })
                  : { url: source.url, ...buildScrapeOptions(false) };
            return `curl -X POST '${resolvedBaseUrl}${path}' \\\n  -H 'Content-Type: application/json'${authHeader} \\\n  -d '${JSON.stringify(
              localPayload,
              null,
              2,
            )}'`;
          })
          .join("\n\n");
        const bridgeUrl = normalizeServiceUrl(
          settings.codexHarnessUrl,
          defaultSettings.codexHarnessUrl,
        );
        return `# Local Agent mode\n# Firecrawl self-hosted /agent is disabled here, so Studio gathers evidence first:\n${urls}\n\n# Then Studio sends the generated handoff to:\n${bridgeUrl}/api/agent/run`;
      }

      if (!captureWithBrowserless) {
        return firecrawlCurl;
      }

      const token = settings.browserlessToken.trim();
      const browserlessUrl = `${resolvedBrowserlessUrl}/screenshot${
        token ? `?token=${encodeURIComponent(token)}` : ""
      }`;
      const browserlessPayload = {
        url: normalizeScreenshotTarget(targetUrl),
        options: {
          type: "jpeg",
          fullPage: screenshotFullPage,
          quality: screenshotQuality,
          captureBeyondViewport: screenshotFullPage,
        },
      };

      return `${firecrawlCurl}\n\n# Browserless screenshot sidecar\ncurl -X POST '${browserlessUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(browserlessPayload, null, 2)}' \\\n  --output screenshot.jpg`;
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Request preview unavailable.";
    }
  }

  function buildAgentRuntimePrompt({
    intent,
    outputLabel,
    sourcePlan,
  }: {
    intent: string;
    outputLabel: string;
    sourcePlan: string;
  }) {
    const profile = agentPromptProfiles[agentOutputMode];
    const strategyNotes = [
      localFirecrawl
        ? "This is a local Firecrawl run. The app gathered evidence with scrape/crawl/map and then sent this package to the selected runtime."
        : "This may come from Firecrawl's native agent endpoint. Treat job metadata and returned artifacts as the source of truth.",
      strictAgentUrls
        ? "Stay within the listed source scope. Do not rely on external sites unless the evidence already includes them."
        : "You may reason across discovered links, but distinguish crawled evidence from external inference.",
      agentRequireCitations
        ? "Cite source URLs beside important factual claims. Never invent citations."
        : "Citations are optional, but still ground conclusions in the provided evidence.",
      agentShowEvidence
        ? "Include supporting evidence snippets where they help the reader trust the answer."
        : "Keep the final answer clean and omit long evidence excerpts.",
      agentDeduplicate
        ? "Deduplicate repeated navigation pages, duplicate claims, and boilerplate content."
        : "Preserve distinct findings even when sources overlap.",
      agentSources.some((source) => source.mode === "map")
        ? "Mapped URL lists are discovery signals, not complete evidence. Use them to explain what should be scraped next when needed."
        : "",
      agentSources.some((source) => source.mode === "crawl")
        ? "Crawl results can contain repeated layout, navigation, and footer content. Prioritize page-specific content."
        : "",
    ].filter(Boolean);
    const schemaInstruction =
      useSchema && (agentOutputMode === "json" || jsonSchema.trim())
        ? `\nAttached schema or extraction shape:\n\`\`\`json\n${jsonSchema.trim()}\n\`\`\`\n`
        : "";

    return `You are ${profile.role}.

Primary mission:
${intent || "No mission was provided. Infer the best useful task from the source plan and evidence."}

Selected preset: ${outputLabel}

Operating method:
${profile.workflow.map((item) => `- ${item}`).join("\n")}

Source plan:
${sourcePlan}

Source and evidence rules:
${strategyNotes.map((item) => `- ${item}`).join("\n")}

Output contract:
${profile.outputContract.map((item) => `- ${item}`).join("\n")}
${schemaInstruction}
Quality bar:
${profile.qualityBar.map((item) => `- ${item}`).join("\n")}

If evidence is insufficient, say exactly what is missing and what URL or crawl setting would likely resolve it.`;
  }

  function buildCodexHandoffFor(sourceResult: unknown, request: RequestRecord | null = lastRequest) {
    if (!sourceResult) {
      return "";
    }

    const seedUrls =
      mode === "agent"
        ? agentSourceUrls()
        : targetUrl.trim()
          ? [targetUrl.trim()]
          : [];
    const intent =
      mode === "agent"
        ? agentPrompt.trim()
        : mode === "search"
          ? searchQuery.trim()
          : targetUrl.trim();
    const sourceLinks = collectLinks(sourceResult);
    const sourceMediaItems = collectMedia(sourceResult);
    const sourceMarkdownText = collectStringsByKey(sourceResult, ["markdown"]).join("\n\n");
    const sourceHtmlText = collectStringsByKey(sourceResult, ["html", "rawHtml"]).join("\n\n");
    const evidence = sourceMarkdownText || sourceHtmlText;
    const requestPayload = request?.payload
      ? formatJson(request.payload)
      : "No request payload recorded.";
    const runtimeLines =
      settings.agentProvider === "codex"
        ? [
            "- Runtime: Codex harness",
            `- Harness bridge: ${settings.codexHarnessUrl || "not set"}`,
            "- Auth: local Codex app-server or bridge token",
          ]
        : settings.agentProvider === "openai"
          ? [
              "- Runtime: OpenAI API",
              `- Model: ${settings.openaiModel || defaultSettings.openaiModel}`,
              `- API key: ${settings.openaiApiKey ? "configured" : "not configured"}`,
            ]
          : [
              "- Runtime: Claude API",
              `- Model: ${settings.claudeModel || defaultSettings.claudeModel}`,
              `- API key: ${settings.claudeApiKey ? "configured" : "not configured"}`,
            ];
    const linkList = sourceLinks.length
      ? sourceLinks
          .slice(0, 80)
          .map((link) => `- ${link.title ? `${link.title}: ` : ""}${link.url}`)
          .join("\n")
      : "- No links extracted.";
    const mediaList = sourceMediaItems.length
      ? sourceMediaItems
          .slice(0, 24)
          .map((item) => `- ${item.label}: ${item.url.slice(0, 220)}`)
          .join("\n")
      : "- No media extracted.";
    const outputLabel =
      agentOutputOptions.find((option) => option.value === agentOutputMode)?.label ??
      "Research report";
    const sourcePlan =
      mode === "agent"
        ? agentSources
            .map((source, index) => {
              const label = source.label.trim() || `Source ${index + 1}`;
              const focus = source.instruction.trim()
                ? ` Focus: ${source.instruction.trim()}`
                : "";
              return `- ${label}: ${source.url || "No URL"} (${source.mode}, limit ${source.limit}, depth ${source.depth}).${focus}`;
            })
            .join("\n")
        : "- Not an Agent run.";
    const agentRuntimePrompt = buildAgentRuntimePrompt({
      intent,
      outputLabel,
      sourcePlan,
    });

    return `# Agent Handoff

Use this as a handoff from Firecrawl Studio into the selected agent runtime. Follow the dynamic agent brief first, then use the request, evidence, links, media, and raw JSON as supporting context.

## Agent Brief

${agentRuntimePrompt}

## Source

- Generated: ${new Date().toISOString()}
- Firecrawl mode: ${modeConfig[mode].label}
- Firecrawl endpoint: ${request?.url ?? "not recorded"}
- Status: ${getStatus(sourceResult)}
- Job: ${getJobId(sourceResult) ?? "none"}
- Seed URLs: ${seedUrls.length ? seedUrls.join(", ") : "none"}

## Agent Runtime

${runtimeLines.join("\n")}

## Output Requirements

- Output format: ${outputLabel}
- Citations: ${agentRequireCitations ? "required" : "optional"}
- Evidence snippets: ${agentShowEvidence ? "include supporting evidence" : "final answer only"}
- Deduplication: ${agentDeduplicate ? "deduplicate overlapping pages and claims" : "preserve all findings"}

## Source Plan

${sourcePlan}

## Firecrawl Request

\`\`\`json
${requestPayload}
\`\`\`

## Extracted Evidence

\`\`\`markdown
${evidence ? truncateText(evidence) : "No markdown or HTML evidence was extracted."}
\`\`\`

## Links

${linkList}

## Media

${mediaList}

## Full Result JSON

\`\`\`json
${truncateText(formatJson(sourceResult), 18000)}
\`\`\`
`;
  }

  function buildCodexHandoff() {
    return buildCodexHandoffFor(result, lastRequest);
  }

  const status = isRunning ? "running" : error ? "failed" : result ? getStatus(result) : "idle";
  const warning = getWarning(result);
  const browserlessScreenshotActive = shouldUseBrowserlessScreenshot();
  const codexHandoff = buildCodexHandoff();
  const selectedAgentProvider = agentProviderOptions.find(
    (option) => option.value === settings.agentProvider,
  ) ?? agentProviderOptions[0];
  const SelectedAgentIcon = selectedAgentProvider.icon;
  const agentReady =
    settings.agentProvider === "codex"
      ? Boolean(settings.codexHarnessUrl.trim())
      : settings.agentProvider === "openai"
        ? Boolean(settings.openaiApiKey.trim())
        : Boolean(settings.claudeApiKey.trim());
  const selectedAgentPromptProfile = agentPromptProfiles[agentOutputMode];
  const commandValue =
    mode === "search" ? searchQuery : mode === "agent" ? agentPrompt : targetUrl;
  const commandPlaceholder =
    mode === "search"
      ? "Search the web with Firecrawl"
      : mode === "agent"
        ? selectedAgentPromptProfile.example
        : "https://example.com";
  const commandModes: Mode[] = ["search", "scrape", "map", "crawl", "agent"];

  function updateCommandValue(value: string) {
    if (mode === "search") {
      setSearchQuery(value);
    } else if (mode === "agent") {
      setAgentPrompt(value);
    } else {
      setTargetUrl(value);
    }
  }

  function renderAgentMissionBuilder(compact = false) {
    const readySources = agentSources.filter((source) => source.url.trim()).length;
    const pageBudget = agentSources.reduce(
      (total, source) => total + Math.max(1, Number(source.limit) || 1),
      0,
    );
    const selectedProfile = selectedAgentPromptProfile;
    const outputLabel =
      agentOutputOptions.find((option) => option.value === agentOutputMode)?.label ??
      "Research report";

    return (
      <section className={`agent-builder ${compact ? "compact" : ""}`}>
        <div className="agent-builder-head">
          <div>
            <span className="eyebrow">Agent mission</span>
            <h3>{compact ? "Plan sources before running" : "Mission builder"}</h3>
            <p>
              Shape the research plan, evidence rules, and source strategy before
              the agent receives anything.
            </p>
          </div>
        </div>
        <div className="agent-plan-summary" aria-label="Agent plan summary">
          <div className="agent-plan-pill">
            <Layers3 size={14} />
            <span>{readySources || 0} source{readySources === 1 ? "" : "s"}</span>
          </div>
          <div className="agent-plan-pill">
            <Activity size={14} />
            <span>{pageBudget} page cap</span>
          </div>
        </div>

        {!compact && (
          <label className="field span-2">
            <span>
              <Sparkles size={15} />
              Objective
            </span>
            <textarea
              rows={4}
              value={agentPrompt}
              placeholder={selectedProfile.example}
              onChange={(event) => setAgentPrompt(event.currentTarget.value)}
            />
          </label>
        )}

        <section className="agent-setup-panel">
          <div className="agent-section-title">
            <span>Run shape</span>
            <p>
              Choose how the answer should be structured and how much evidence
              Firecrawl should gather.
            </p>
          </div>
          <div className={`agent-builder-controls ${localFirecrawl ? "is-local" : ""}`}>
            <label className="field">
              <span>
                Output
                <HelpTooltip text="Changes the role, workflow, and output contract included in the agent brief." />
              </span>
              <select
                value={agentOutputMode}
                onChange={(event) =>
                  setAgentOutputMode(event.currentTarget.value as AgentOutputMode)
                }
              >
                {agentOutputOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {localFirecrawl ? (
              <div className="local-mode-card">
                <TerminalSquare size={16} />
                <span>
                  <strong>Local evidence mode</strong>
                  <small>
                    Native /agent credits are skipped. Source page caps control
                    the evidence package.
                  </small>
                </span>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>
                    Firecrawl model
                    <HelpTooltip text="Used when calling Firecrawl's native hosted agent endpoint." />
                  </span>
                  <select
                    value={agentModel}
                    onChange={(event) => setAgentModel(event.currentTarget.value)}
                  >
                    <option value="spark-1-mini">spark-1-mini</option>
                    <option value="spark-1-pro">spark-1-pro</option>
                  </select>
                </label>
                <label className="field">
                  <span>
                    Max credits
                    <HelpTooltip text="Caps native Firecrawl Agent spend. Local mode uses source page caps instead." />
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={2500}
                    value={agentMaxCredits}
                    onChange={(event) => setAgentMaxCredits(Number(event.currentTarget.value))}
                  />
                </label>
              </>
            )}
          </div>
        </section>

        <div className="agent-prompt-preset">
          <div>
            <span>Prompt preset</span>
            <strong>{outputLabel}</strong>
            <p>{selectedProfile.description}</p>
          </div>
          <div className="agent-preset-example">
            <small>
              {selectedProfile.outputContract[0]}{" "}
              {agentRequireCitations ? "Cited claims required." : "Citations optional."}
            </small>
            <button
              type="button"
              className="ghost-button compact-run"
              onClick={() => setAgentPrompt(selectedProfile.example)}
            >
              Use example
            </button>
          </div>
        </div>

        <section className="agent-switch-grid" aria-label="Agent guardrails">
          <SwitchControl
            checked={agentRequireCitations}
            label="Citations"
            description="Require source URLs beside important factual claims."
            onChange={setAgentRequireCitations}
          />
          <SwitchControl
            checked={agentShowEvidence}
            label="Evidence"
            description="Ask the runtime to include short supporting snippets when helpful."
            onChange={setAgentShowEvidence}
          />
          <SwitchControl
            checked={agentDeduplicate}
            label="Deduplicate"
            description="Collapse repeated navigation, boilerplate, and duplicate claims."
            onChange={setAgentDeduplicate}
          />
          <SwitchControl
            checked={strictAgentUrls}
            label="Stay listed"
            description="Keep the answer inside the listed source scope unless the crawl discovered a link."
            onChange={setStrictAgentUrls}
          />
        </section>

        <div className="agent-source-toolbar">
          <div>
            <span className="eyebrow">Sources</span>
            <strong>Websites to inspect</strong>
            <p>Add exact URLs, bounded crawls, or URL maps. Each source can carry its own focus and limits.</p>
          </div>
          <button type="button" className="icon-text-button" onClick={addAgentSource}>
            <Plus size={15} />
            Add URL
          </button>
        </div>

        <div className="agent-source-list">
          {agentSources.map((source, index) => {
            const modeOption = agentSourceModeOptions.find(
              (option) => option.value === source.mode,
            );
            return (
              <article className="agent-source-card" key={source.id}>
                <div className="agent-source-top">
                  <span>
                    <Link2 size={15} />
                    {source.label.trim() || `Source ${index + 1}`}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeAgentSource(source.id)}
                    disabled={agentSources.length === 1}
                    title="Remove source"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="agent-source-grid">
                  <label className="field source-url-field">
                    <span>
                      Website
                      <HelpTooltip text="The starting page or site section Firecrawl should inspect for this source." />
                    </span>
                    <input
                      value={source.url}
                      onChange={(event) =>
                        updateAgentSource(source.id, "url", event.currentTarget.value)
                      }
                      placeholder="https://example.com/docs"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Mode
                      <HelpTooltip text="Exact page scrapes one URL. Crawl follows pages. Map discovers URLs without full extraction." />
                    </span>
                    <select
                      value={source.mode}
                      onChange={(event) =>
                        updateAgentSource(
                          source.id,
                          "mode",
                          event.currentTarget.value as AgentSourceMode,
                        )
                      }
                    >
                      {agentSourceModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      Page cap
                      <HelpTooltip text="Maximum pages or URLs this source can contribute to the agent package." />
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={2500}
                      value={source.limit}
                      onChange={(event) =>
                        updateAgentSource(source.id, "limit", Number(event.currentTarget.value))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>
                      Depth
                      <HelpTooltip text="How far a crawl can follow internal links from the starting URL." />
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={source.depth}
                      disabled={source.mode !== "crawl"}
                      onChange={(event) =>
                        updateAgentSource(source.id, "depth", Number(event.currentTarget.value))
                      }
                    />
                  </label>
                </div>

                <details className="agent-source-advanced">
                  <summary>
                    <Settings2 size={14} />
                    {modeOption?.detail ?? "Advanced source controls"}
                  </summary>
                  <div className="agent-source-grid">
                    <label className="field">
                      <span>Label</span>
                      <input
                        value={source.label}
                        onChange={(event) =>
                          updateAgentSource(source.id, "label", event.currentTarget.value)
                        }
                        placeholder="Docs, pricing, competitor"
                      />
                    </label>
                    <label className="field">
                      <span>Focus</span>
                      <input
                        value={source.instruction}
                        onChange={(event) =>
                          updateAgentSource(
                            source.id,
                            "instruction",
                            event.currentTarget.value,
                          )
                        }
                        placeholder="Focus on API limits and deployment steps"
                      />
                    </label>
                    <label className="field">
                      <span>Include paths</span>
                      <input
                        value={source.includePaths}
                        onChange={(event) =>
                          updateAgentSource(
                            source.id,
                            "includePaths",
                            event.currentTarget.value,
                          )
                        }
                        placeholder="^/docs/.*, ^/pricing"
                      />
                    </label>
                    <label className="field">
                      <span>Exclude paths</span>
                      <input
                        value={source.excludePaths}
                        onChange={(event) =>
                          updateAgentSource(
                            source.id,
                            "excludePaths",
                            event.currentTarget.value,
                          )
                        }
                        placeholder="^/blog/.*, ^/changelog"
                      />
                    </label>
                  </div>
                  <div className="agent-source-toggles">
                    <SwitchControl
                      checked={source.stayOnDomain}
                      label="Stay on domain"
                      description="Block external domains for this source unless Firecrawl already returned them."
                      onChange={(checked) =>
                        updateAgentSource(source.id, "stayOnDomain", checked)
                      }
                    />
                    <SwitchControl
                      checked={source.useSitemap}
                      label="Use sitemap"
                      description="Let Firecrawl use sitemap discovery when mapping or crawling this source."
                      onChange={(checked) =>
                        updateAgentSource(source.id, "useSitemap", checked)
                      }
                    />
                  </div>
                </details>
              </article>
            );
          })}
        </div>

        <div className="agent-run-preview">
          <div>
            <span>Runtime</span>
            <strong>{agentProviderLabel(settings.agentProvider)}</strong>
          </div>
          <div>
            <span>Output</span>
            <strong>{outputLabel}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>
              {localFirecrawl ? "scrape/crawl then handoff" : "Firecrawl /agent"}
            </strong>
          </div>
        </div>

        {localFirecrawl && (
          <p className="format-note">
            <TerminalSquare size={14} />
            Local mode gathers evidence first, then sends a clean handoff to the
            selected runtime because this Firecrawl host does not expose native
            /agent.
          </p>
        )}
      </section>
    );
  }

  return (
    <main
      ref={shellRef}
      className={`app-shell ${hasSubmitted ? "has-run" : "is-landing"}`}
    >
      <header className="hero-shell">
        <div className="hero-copy">
          <span className="mini-mark" aria-hidden="true">
            <Flame size={18} />
          </span>
          <div>
            <h1>Firecrawl Studio</h1>
            <p>Self-hosted web data, one clean command at a time.</p>
          </div>
        </div>
        <div className="hero-actions">
          <span className={`status-pill ${agentReady ? "is-ready" : ""}`}>
            {agentReady ? <ShieldCheck size={16} /> : <KeyRound size={16} />}
            {agentProviderLabel(settings.agentProvider)}
          </span>
          <a
            className="docs-link"
            href="https://docs.firecrawl.dev/api-reference/v2-introduction"
            target="_blank"
            rel="noreferrer"
          >
            Docs
            <ArrowUpRight size={15} />
          </a>
        </div>
      </header>

      <section
        className={`command-stage ${mode === "agent" ? "is-agent-stage" : ""}`}
        aria-label="Firecrawl command"
      >
        <form ref={commandCardRef} className="command-card" onSubmit={handleRun}>
          <div className="command-input-row">
            <Globe2 size={19} />
            <input
              autoFocus
              ref={commandInputRef}
              value={commandValue}
              onChange={(event) => updateCommandValue(event.currentTarget.value)}
              placeholder={commandPlaceholder}
              aria-label={mode === "search" ? "Search query" : "Target URL or prompt"}
            />
          </div>

          {mode === "agent" && !hasSubmitted && renderAgentMissionBuilder(true)}

          <div className="command-footer">
            <div className="command-tabs" role="tablist" aria-label="Endpoint">
              {commandModes.map((item) => {
                const Icon = modeConfig[item].icon;
                return (
                  <button
                    key={item}
                    type="button"
                    className={mode === item ? "active" : ""}
                    onClick={() => setMode(item)}
                  >
                    <Icon size={15} />
                    {modeConfig[item].label}
                  </button>
                );
              })}
            </div>
            <button
              className="command-submit"
              type="submit"
              disabled={isRunning}
              title={`Run against ${resolvedBaseUrl}`}
            >
              {isRunning ? <Loader2 className="spin" size={22} /> : <ArrowRight size={24} />}
            </button>
          </div>
        </form>

        <details className="settings-drawer">
          <summary>
            <Settings2 size={15} />
            Connection settings
          </summary>
          <div className="connection-panel" aria-label="Connection">
            <section className="connection-section span-2">
              <div className="connection-section-head">
                <div className="block-title">
                  <Globe2 size={16} />
                  Firecrawl API
                </div>
                <p>Point Studio at your local container or the hosted Firecrawl API.</p>
              </div>
              <div className="connection-grid">
                <label className="field">
                  <span>
                    <Globe2 size={15} />
                    Base URL
                  </span>
                  <input
                    value={settings.baseUrl}
                    onChange={(event) => updateSetting("baseUrl", event.currentTarget.value)}
                    placeholder="http://localhost:3002/v2"
                  />
                </label>
                <label className="field">
                  <span>
                    <KeyRound size={15} />
                    Firecrawl API key
                  </span>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(event) => updateSetting("apiKey", event.currentTarget.value)}
                    placeholder="fc-..."
                  />
                </label>
              </div>
              <div className="connection-footer-row">
                <div className="preset-group" aria-label="Presets">
                  <button
                    type="button"
                    onClick={() => updateSetting("baseUrl", "http://localhost:3002/v2")}
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSetting("baseUrl", "https://api.firecrawl.dev/v2")}
                  >
                    Cloud
                  </button>
                  <label className="toggle compact">
                    <input
                      type="checkbox"
                      checked={settings.rememberKey}
                      onChange={(event) =>
                        updateSetting("rememberKey", event.currentTarget.checked)
                      }
                    />
                    <span>
                      Remember secrets
                      <HelpTooltip text="Stores API keys and local tokens in this browser's localStorage. Use it only on your own machine." />
                    </span>
                  </label>
                </div>
                <div className="resolved-url">
                  <Activity size={14} />
                  {resolvedBaseUrl}
                </div>
              </div>
            </section>

            <section className="connection-section agent-runtime span-2">
              <div className="connection-section-head">
                <div className="block-title">
                  <WandSparkles size={16} />
                  Agent runtime
                </div>
                <p>Choose whether Agent handoffs go to Codex, OpenAI, or Claude.</p>
              </div>
              <div className="agent-provider-grid" role="tablist" aria-label="Agent runtime">
                {agentProviderOptions.map((option) => {
                  const Icon = option.icon;
                  const active = settings.agentProvider === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`provider-card ${active ? "active" : ""}`}
                      onClick={() => updateSetting("agentProvider", option.value)}
                    >
                      <Icon size={18} />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="agent-provider-fields">
                {settings.agentProvider === "openai" && (
                  <>
                    <label className="field">
                      <span>
                        <KeyRound size={15} />
                        OpenAI API key
                      </span>
                      <input
                        type="password"
                        value={settings.openaiApiKey}
                        onChange={(event) =>
                          updateSetting("openaiApiKey", event.currentTarget.value)
                        }
                        placeholder="sk-..."
                      />
                    </label>
                    <label className="field">
                      <span>
                        <Sparkles size={15} />
                        OpenAI model
                      </span>
                      <input
                        value={settings.openaiModel}
                        onChange={(event) =>
                          updateSetting("openaiModel", event.currentTarget.value)
                        }
                        placeholder="gpt-5.5"
                      />
                    </label>
                  </>
                )}
                {settings.agentProvider === "claude" && (
                  <>
                    <label className="field">
                      <span>
                        <KeyRound size={15} />
                        Claude API key
                      </span>
                      <input
                        type="password"
                        value={settings.claudeApiKey}
                        onChange={(event) =>
                          updateSetting("claudeApiKey", event.currentTarget.value)
                        }
                        placeholder="sk-ant-..."
                      />
                    </label>
                    <label className="field">
                      <span>
                        <WandSparkles size={15} />
                        Claude model
                      </span>
                      <input
                        value={settings.claudeModel}
                        onChange={(event) =>
                          updateSetting("claudeModel", event.currentTarget.value)
                        }
                        placeholder="claude-opus-4-6"
                      />
                    </label>
                  </>
                )}
                {settings.agentProvider === "codex" && (
                  <>
                    <label className="field">
                      <span>
                        <TerminalSquare size={15} />
                        Harness bridge URL
                      </span>
                      <input
                        value={settings.codexHarnessUrl}
                        onChange={(event) =>
                          updateSetting("codexHarnessUrl", event.currentTarget.value)
                        }
                        placeholder="http://127.0.0.1:8787"
                      />
                    </label>
                    <label className="field">
                      <span>
                        <KeyRound size={15} />
                        Harness token
                      </span>
                      <input
                        type="password"
                        value={settings.codexHarnessToken}
                        onChange={(event) =>
                          updateSetting("codexHarnessToken", event.currentTarget.value)
                        }
                        placeholder="optional local token"
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="connection-note">
                <SelectedAgentIcon size={14} />
                {settings.agentProvider === "codex"
                  ? "Codex harness mode expects a local bridge that talks to Codex app-server or OpenClaw."
                  : "API-key mode stores the provider and model here; enable Remember secrets only on your own machine."}
              </p>
            </section>

            <section className="connection-section span-2">
              <div className="connection-section-head">
                <div className="block-title">
                  <Sparkles size={16} />
                  Screenshot engine
                </div>
                <p>Use Browserless for local high-quality screenshots, or Firecrawl native when available.</p>
              </div>
              <div className="connection-grid screenshot-grid">
                <label className="field">
                  <span>
                    <Sparkles size={15} />
                    Engine
                  </span>
                  <select
                    value={settings.screenshotProvider}
                    onChange={(event) =>
                      updateSetting(
                        "screenshotProvider",
                        event.currentTarget.value as Settings["screenshotProvider"],
                      )
                    }
                  >
                    <option value="browserless">Browserless sidecar</option>
                    <option value="firecrawl">Firecrawl native</option>
                  </select>
                </label>
                <label className="field">
                  <span>
                    <Globe2 size={15} />
                    Browserless URL
                  </span>
                  <input
                    value={settings.browserlessUrl}
                    disabled={settings.screenshotProvider !== "browserless"}
                    onChange={(event) =>
                      updateSetting("browserlessUrl", event.currentTarget.value)
                    }
                    placeholder="http://localhost:3003"
                  />
                </label>
                <label className="field">
                  <span>
                    <KeyRound size={15} />
                    Browserless token
                  </span>
                  <input
                    value={settings.browserlessToken}
                    disabled={settings.screenshotProvider !== "browserless"}
                    onChange={(event) =>
                      updateSetting("browserlessToken", event.currentTarget.value)
                    }
                    placeholder="localdev"
                  />
                </label>
              </div>
              {settings.screenshotProvider === "browserless" && (
                <div className="resolved-url screenshot-resolved">
                  <Sparkles size={14} />
                  {resolvedBrowserlessUrl}
                </div>
              )}
            </section>
          </div>
        </details>
      </section>

      {hasSubmitted && (
        <section ref={workspaceRef} className="workspace-results" aria-label="Firecrawl results">
          <div className="workspace-intro">
            <div>
              <span className="eyebrow">Workbench</span>
              <h2>{modeConfig[mode].label}</h2>
              <p>{modeConfig[mode].description}</p>
            </div>
          </div>

          <div className="workspace-grid">
        <details className="panel controls-panel inspector-panel">
          <summary className="panel-heading">
            <div>
              <span className="eyebrow">Options</span>
              <h2>{modeConfig[mode].label} settings</h2>
              <p>Fine-tune the request before it leaves your browser.</p>
            </div>
            <Settings2 size={20} />
          </summary>
          <div className="inspector-body">

          <div className="mode-tabs" role="tablist" aria-label="Endpoint">
            {(Object.keys(modeConfig) as Mode[]).map((item) => {
              const Icon = modeConfig[item].icon;
              return (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? "active" : ""}
                  onClick={() => setMode(item)}
                >
                  <Icon size={16} />
                  {modeConfig[item].label}
                </button>
              );
            })}
          </div>

          <form className="request-form" onSubmit={handleRun}>
            {(mode === "scrape" || mode === "crawl" || mode === "map") && (
              <label className="field span-2">
                <span>
                  <Compass size={15} />
                  URL
                </span>
                <input
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.currentTarget.value)}
                  placeholder="https://docs.firecrawl.dev"
                />
              </label>
            )}

            {mode === "search" && (
              <>
                <label className="field span-2">
                  <span>
                    <Search size={15} />
                    Query
                  </span>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    placeholder="best docs for self hosted web scraping"
                  />
                </label>
                <label className="field">
                  <span>Limit</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={searchLimit}
                    onChange={(event) => setSearchLimit(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="field">
                  <span>Country</span>
                  <input
                    value={searchCountry}
                    onChange={(event) => setSearchCountry(event.currentTarget.value)}
                    maxLength={2}
                  />
                </label>
                <label className="field">
                  <span>Time</span>
                  <select
                    value={searchTbs}
                    onChange={(event) => setSearchTbs(event.currentTarget.value)}
                  >
                    {tbsOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Location</span>
                  <input
                    value={searchLocation}
                    onChange={(event) => setSearchLocation(event.currentTarget.value)}
                    placeholder="San Francisco,California,United States"
                  />
                </label>
              </>
            )}

            {mode === "agent" && renderAgentMissionBuilder(false)}

            {mode === "map" && (
              <>
                <label className="field">
                  <span>Search within site</span>
                  <input
                    value={mapSearch}
                    onChange={(event) => setMapSearch(event.currentTarget.value)}
                    placeholder="pricing, docs, api"
                  />
                </label>
                <label className="field">
                  <span>URL limit</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={mapLimit}
                    onChange={(event) => setMapLimit(Number(event.currentTarget.value))}
                  />
                </label>
              </>
            )}

            {mode === "crawl" && (
              <>
                <label className="field">
                  <span>Page limit</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={crawlLimit}
                    onChange={(event) => setCrawlLimit(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="field">
                  <span>Max depth</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={maxDepth}
                    onChange={(event) => setMaxDepth(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="field span-2">
                  <span>Include paths</span>
                  <input
                    value={includePaths}
                    onChange={(event) => setIncludePaths(event.currentTarget.value)}
                    placeholder="^/docs/.*, ^/blog/.*"
                  />
                </label>
                <label className="field span-2">
                  <span>Exclude paths</span>
                  <input
                    value={excludePaths}
                    onChange={(event) => setExcludePaths(event.currentTarget.value)}
                    placeholder="^/admin/.*, ^/private/.*"
                  />
                </label>
              </>
            )}

            {(mode === "scrape" || mode === "crawl" || mode === "search") && (
              <section className="control-block span-2">
                <div className="block-title">
                  <FileJson size={16} />
                  Formats
                </div>
                <div className="chip-grid">
                  {Object.entries(formats).map(([key, enabled]) => (
                    <label key={key} className={`check-chip ${enabled ? "checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setFormats((current) => ({
                            ...current,
                            [key]: checked,
                          }));
                        }}
                      />
                      {key}
                    </label>
                  ))}
                </div>

                {formats.screenshot && (
                  <>
                    <div className="option-row">
                      <label className="field">
                        <span>Screenshot quality</span>
                        <input
                          type="range"
                          min={40}
                          max={100}
                          value={screenshotQuality}
                          onChange={(event) =>
                            setScreenshotQuality(Number(event.currentTarget.value))
                          }
                        />
                      </label>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={screenshotFullPage}
                          onChange={(event) =>
                            setScreenshotFullPage(event.currentTarget.checked)
                          }
                        />
                        <span>Full page</span>
                      </label>
                    </div>
                    {settings.screenshotProvider === "browserless" && (
                      <p className="format-note">
                        <Sparkles size={14} />
                        {browserlessScreenshotActive
                          ? "Browserless will capture this target URL and attach the image to the Media tab."
                          : "Browserless sidecar captures Scrape and Crawl target URLs. Search screenshots still use Firecrawl-native support."}
                      </p>
                    )}
                    {settings.screenshotProvider === "firecrawl" && localFirecrawl && (
                      <p className="format-note">
                        <AlertCircle size={14} />
                        Local screenshots need Fire Engine/CDP. The basic Playwright
                        service can scrape pages but may return no eligible screenshot
                        engine.
                      </p>
                    )}
                  </>
                )}

                {formats.json && (
                  <div className="json-grid">
                    <label className="field">
                      <span>JSON prompt</span>
                      <textarea
                        rows={3}
                        value={jsonPrompt}
                        onChange={(event) => setJsonPrompt(event.currentTarget.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Schema</span>
                      <textarea
                        rows={3}
                        value={jsonSchema}
                        disabled={!useSchema}
                        onChange={(event) => setJsonSchema(event.currentTarget.value)}
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={useSchema}
                        onChange={(event) => setUseSchema(event.currentTarget.checked)}
                      />
                      <span>Attach schema</span>
                    </label>
                  </div>
                )}
              </section>
            )}

            {mode === "agent" && (
              <section className="control-block span-2">
                <div className="block-title">
                  <Braces size={16} />
                  Structured output
                </div>
                <div className="json-grid">
                  <label className="field span-2">
                    <span>Schema</span>
                    <textarea
                      rows={6}
                      value={jsonSchema}
                      disabled={!useSchema}
                      onChange={(event) => setJsonSchema(event.currentTarget.value)}
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={useSchema}
                      onChange={(event) => setUseSchema(event.currentTarget.checked)}
                    />
                    <span>Attach schema</span>
                  </label>
                </div>
              </section>
            )}

            {(mode === "scrape" || mode === "crawl" || mode === "search") && (
              <section className="control-block span-2">
                <div className="block-title">
                  <Settings2 size={16} />
                  Scrape options
                </div>
                <div className="toggle-grid">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={onlyMainContent}
                      onChange={(event) => setOnlyMainContent(event.currentTarget.checked)}
                    />
                    <span>Main content</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={mobile}
                      onChange={(event) => setMobile(event.currentTarget.checked)}
                    />
                    <span>Mobile viewport</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={blockAds}
                      onChange={(event) => setBlockAds(event.currentTarget.checked)}
                    />
                    <span>Block ads</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={removeBase64Images}
                      onChange={(event) =>
                        setRemoveBase64Images(event.currentTarget.checked)
                      }
                    />
                    <span>Trim base64 images</span>
                  </label>
                  {mode === "search" && (
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={searchWithScrape}
                        onChange={(event) =>
                          setSearchWithScrape(event.currentTarget.checked)
                        }
                      />
                      <span>Scrape results</span>
                    </label>
                  )}
                </div>
                <div className="option-row">
                  <label className="field">
                    <span>Include tags</span>
                    <input
                      value={includeTags}
                      onChange={(event) => setIncludeTags(event.currentTarget.value)}
                      placeholder="main, article, h1"
                    />
                  </label>
                  <label className="field">
                    <span>Exclude tags</span>
                    <input
                      value={excludeTags}
                      onChange={(event) => setExcludeTags(event.currentTarget.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Wait ms</span>
                    <input
                      type="number"
                      min={0}
                      value={waitFor}
                      onChange={(event) => setWaitFor(Number(event.currentTarget.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Timeout ms</span>
                    <input
                      type="number"
                      min={1000}
                      value={timeout}
                      onChange={(event) => setTimeoutMs(Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
              </section>
            )}

            {(mode === "crawl" || mode === "map") && (
              <section className="control-block span-2">
                <div className="block-title">
                  <MapIcon size={16} />
                  Discovery
                </div>
                <div className="option-row">
                  <label className="field">
                    <span>Sitemap</span>
                    <select
                      value={sitemap}
                      onChange={(event) => setSitemap(event.currentTarget.value)}
                    >
                      <option value="include">include</option>
                      <option value="skip">skip</option>
                      <option value="only">only</option>
                    </select>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={ignoreQueryParameters}
                      onChange={(event) =>
                        setIgnoreQueryParameters(event.currentTarget.checked)
                      }
                    />
                    <span>Ignore query params</span>
                  </label>
                  {mode === "crawl" ? (
                    <>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={crawlEntireDomain}
                          onChange={(event) =>
                            setCrawlEntireDomain(event.currentTarget.checked)
                          }
                        />
                        <span>Entire domain</span>
                      </label>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={allowSubdomains}
                          onChange={(event) =>
                            setAllowSubdomains(event.currentTarget.checked)
                          }
                        />
                        <span>Subdomains</span>
                      </label>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={allowExternalLinks}
                          onChange={(event) =>
                            setAllowExternalLinks(event.currentTarget.checked)
                          }
                        />
                        <span>External links</span>
                      </label>
                    </>
                  ) : (
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={mapIncludeSubdomains}
                        onChange={(event) =>
                          setMapIncludeSubdomains(event.currentTarget.checked)
                        }
                      />
                      <span>Subdomains</span>
                    </label>
                  )}
                </div>
              </section>
            )}

            {mode === "search" && (
              <section className="control-block span-2">
                <div className="block-title">
                  <Search size={16} />
                  Search scope
                </div>
                <div className="toggle-grid">
                  {Object.entries(searchSources).map(([key, enabled]) => (
                    <label key={key} className="toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSearchSources((current) => ({
                            ...current,
                            [key]: checked,
                          }));
                        }}
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                  {Object.entries(searchCategories).map(([key, enabled]) => (
                    <label key={key} className="toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSearchCategories((current) => ({
                            ...current,
                            [key]: checked,
                          }));
                        }}
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {(mode === "crawl" || mode === "agent") && (
              <section className="job-check span-2">
                <label className="field">
                  <span>
                    <Clock3 size={15} />
                    Job ID
                  </span>
                  <input
                    value={manualJobId}
                    onChange={(event) => setManualJobId(event.currentTarget.value)}
                    placeholder="123-456-789"
                  />
                </label>
                <button type="button" className="secondary-button" onClick={handleCheckJob}>
                  <RefreshCw size={16} />
                  Check
                </button>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.autoPoll}
                    onChange={(event) =>
                      updateSetting("autoPoll", event.currentTarget.checked)
                    }
                  />
                  <span>Auto-poll</span>
                </label>
              </section>
            )}

            <div className="action-row span-2">
              <button className="run-button" type="submit" disabled={isRunning}>
                {isRunning ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                {isRunning ? "Running" : `Run ${modeConfig[mode].label}`}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => copyText("request", previewRequest())}
              >
                {copied === "request" ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
                Copy request
              </button>
            </div>
          </form>
          </div>
        </details>

        <section className="panel results-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Response</span>
              <h2>{status}</h2>
              <p>
                {pollingStatus ||
                  (isRunning
                    ? "Waiting for Firecrawl..."
                    : result
                      ? resultDetail(result)
                      : "Ready for a run.")}
              </p>
            </div>
            {error ? (
              <XCircle className="danger" size={22} />
            ) : result ? (
              <CheckCircle2 className="success" size={22} />
            ) : (
              <TerminalSquare size={22} />
            )}
          </div>

          {error && (
            <div className="error-box">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {warning && (
            <div className="warning-box">
              <AlertCircle size={18} />
              <span>{warning}</span>
            </div>
          )}

          <div className="metric-strip" aria-label="Result metrics">
            <div>
              <span>Links</span>
              <strong>{links.length}</strong>
            </div>
            <div>
              <span>Markdown</span>
              <strong>{markdownText ? markdownText.length.toLocaleString() : 0}</strong>
            </div>
            <div>
              <span>Media</span>
              <strong>{mediaItems.length}</strong>
            </div>
          </div>

          <div className="result-tabs" role="tablist" aria-label="Result view">
            {(["summary", "markdown", "links", "media", "codex", "json"] as ResultTab[]).map(
              (tab) => {
                const tabConfig = resultTabConfig[tab];
                const TabIcon = tabConfig.icon;
                return (
                  <button
                    type="button"
                    key={tab}
                    className={activeTab === tab ? "active" : ""}
                    onClick={() => setActiveTab(tab)}
                  >
                    <TabIcon size={14} />
                    {tabConfig.label}
                  </button>
                );
              },
            )}
          </div>

          <div className="result-body">
            {activeTab === "summary" && (
              <SummaryView
                result={result}
                lastRequest={lastRequest}
                preview={previewRequest()}
                onCopy={(value) => copyText("summary", value)}
                copied={copied === "summary"}
                isRunning={isRunning}
              />
            )}

            {activeTab === "markdown" && (
              <TextView
                value={markdownText || htmlText}
                empty="No markdown or HTML content found in the current response."
                onCopy={() => copyText("markdown", markdownText || htmlText)}
                onDownload={() =>
                  downloadText("firecrawl-result.md", markdownText || htmlText, "text/markdown")
                }
                copied={copied === "markdown"}
              />
            )}

            {activeTab === "links" && (
              <LinksView
                links={links}
                onCopy={() => copyText("links", links.map((link) => link.url).join("\n"))}
                copied={copied === "links"}
              />
            )}

            {activeTab === "media" && <MediaView items={mediaItems} />}

            {activeTab === "codex" && (
              <CodexHandoffView
                value={codexHandoff}
                provider={settings.agentProvider}
                bridgeUrl={settings.codexHarnessUrl}
                result={agentBridgeResult}
                isSending={isSendingAgent}
                onSend={handleSendToAgent}
                onCopy={() => copyText("codex", codexHandoff)}
                onDownload={() =>
                  downloadText("AGENT_HANDOFF.md", codexHandoff, "text/markdown")
                }
                copied={copied === "codex"}
              />
            )}

            {activeTab === "json" && (
              <TextView
                value={formatJson(result)}
                empty="No JSON response yet."
                onCopy={() => copyText("json", formatJson(result))}
                onDownload={() => downloadText("firecrawl-result.json", formatJson(result))}
                copied={copied === "json"}
              />
            )}
          </div>
        </section>

        <details className="panel side-panel inspector-panel">
          <summary className="panel-heading compact-heading">
            <div>
              <span className="eyebrow">Request</span>
              <h2>Preview</h2>
              <p>Inspect the curl request and recent runs.</p>
            </div>
            <Code2 size={18} />
          </summary>
          <div className="inspector-body">
          <pre className="request-preview">{previewRequest()}</pre>

          <div className="history-heading">
            <div>
              <History size={16} />
              Recent runs
            </div>
            <button
              type="button"
              className="icon-button"
              title="Clear history"
              aria-label="Clear history"
              onClick={() => setHistory([])}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-state">Runs will appear here after the first request.</p>
            ) : (
              history.map((item) => {
                const Icon = modeConfig[item.mode].icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="history-item"
                    onClick={() => setMode(item.mode)}
                  >
                    <Icon size={16} />
                    <span>
                      <strong>{item.target}</strong>
                      <small>
                        {modeConfig[item.mode].label} - {item.status} - {item.detail}
                      </small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          </div>
        </details>
          </div>
        </section>
      )}
    </main>
  );
}

function SummaryView({
  result,
  lastRequest,
  preview,
  onCopy,
  copied,
  isRunning,
}: {
  result: unknown;
  lastRequest: { url: string; method: "POST" | "GET"; payload?: JsonRecord } | null;
  preview: string;
  onCopy: (value: string) => void;
  copied: boolean;
  isRunning: boolean;
}) {
  if (!result) {
    if (isRunning) {
      return (
        <div className="empty-result loading-result">
          <Loader2 className="spin" size={36} />
          <h3>Running Firecrawl</h3>
          <p>The response will unfold here as soon as the endpoint returns.</p>
        </div>
      );
    }

    return (
      <div className="empty-result">
        <Flame size={34} />
        <h3>No response yet</h3>
        <p>Choose an endpoint, set the payload, and run it against your Firecrawl host.</p>
      </div>
    );
  }

  return (
    <div className="summary-view">
      <div className="viewer-section-title">
        <div>
          <span>Snapshot</span>
          <strong>Run summary</strong>
        </div>
      </div>
      <div className="summary-grid">
        <div>
          <span>Status</span>
          <strong>{getStatus(result)}</strong>
        </div>
        <div>
          <span>Detail</span>
          <strong>{resultDetail(result)}</strong>
        </div>
        <div>
          <span>Job</span>
          <strong>{getJobId(result) ?? "none"}</strong>
        </div>
      </div>
      {lastRequest && (
        <div className="request-card">
          <div>
            <span>{lastRequest.method}</span>
            <strong>{lastRequest.url}</strong>
          </div>
          <button
            type="button"
            className="icon-text-button"
            onClick={() => onCopy(preview)}
          >
            {copied ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
            Copy
          </button>
        </div>
      )}
      <div className="viewer-section-title">
        <div>
          <span>Raw preview</span>
          <strong>First 4,500 characters</strong>
        </div>
      </div>
      <pre className="json-snippet">{formatJson(result).slice(0, 4500)}</pre>
    </div>
  );
}

function CodexHandoffView({
  value,
  provider,
  bridgeUrl,
  result,
  isSending,
  onSend,
  onCopy,
  onDownload,
  copied,
}: {
  value: string;
  provider: Settings["agentProvider"];
  bridgeUrl: string;
  result: unknown;
  isSending: boolean;
  onSend: () => void;
  onCopy: () => void;
  onDownload: () => void;
  copied: boolean;
}) {
  const providerLabel = agentProviderLabel(provider);

  if (!value) {
    return (
      <div className="empty-result codex-empty">
        <TerminalSquare size={34} />
        <h3>No agent handoff yet</h3>
        <p>Run Agent, Scrape, Crawl, or Search to package context for the selected runtime.</p>
      </div>
    );
  }

  return (
    <div className="codex-view">
      <div className="codex-brief">
        <div>
          <span>Agent handoff</span>
          <strong>
            Send to {providerLabel} through {bridgeUrl || "the configured bridge"}.
          </strong>
        </div>
        <code>
          {provider === "codex"
            ? 'codex "Read AGENT_HANDOFF.md and continue from the Firecrawl handoff."'
            : `Bridge packages this evidence for ${providerLabel}.`}
        </code>
      </div>
      <div className="viewer-actions">
        <button
          type="button"
          className="run-button compact-run"
          onClick={onSend}
          disabled={isSending}
        >
          {isSending ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}
          {isSending ? "Sending" : "Send to agent"}
        </button>
        <button type="button" className="icon-text-button" onClick={onCopy}>
          {copied ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
          Copy handoff
        </button>
        <button type="button" className="icon-text-button" onClick={onDownload}>
          <Download size={15} />
          Export
        </button>
      </div>
      {result !== null && result !== undefined && (
        <div className="agent-output">
          <div>
            <span>Agent response</span>
            <strong>{getStatus(result)}</strong>
          </div>
          <pre>{formatJson(result).slice(0, 8000)}</pre>
        </div>
      )}
      <pre>{value}</pre>
    </div>
  );
}

function TextView({
  value,
  empty,
  onCopy,
  onDownload,
  copied,
}: {
  value: string;
  empty: string;
  onCopy: () => void;
  onDownload: () => void;
  copied: boolean;
}) {
  if (!value) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className="text-view">
      <div className="viewer-actions">
        <button type="button" className="icon-text-button" onClick={onCopy}>
          {copied ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
          Copy
        </button>
        <button type="button" className="icon-text-button" onClick={onDownload}>
          <Download size={15} />
          Export
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function LinksView({
  links,
  onCopy,
  copied,
}: {
  links: LinkItem[];
  onCopy: () => void;
  copied: boolean;
}) {
  if (links.length === 0) {
    return <p className="empty-state">No links found in the current response.</p>;
  }

  return (
    <div className="links-view">
      <div className="viewer-actions">
        <button type="button" className="icon-text-button" onClick={onCopy}>
          {copied ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
          Copy URLs
        </button>
        <span>{links.length} total</span>
      </div>
      <div className="viewer-section-title">
        <div>
          <span>Discovered links</span>
          <strong>Top {Math.min(links.length, 300).toLocaleString()} shown</strong>
        </div>
      </div>
      {links.slice(0, 300).map((link) => (
        <a key={`${link.source}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
          <Link2 size={16} />
          <span>
            <strong>{link.title || link.url}</strong>
            {link.description && <small>{link.description}</small>}
            <em>{link.url}</em>
          </span>
        </a>
      ))}
    </div>
  );
}

function MediaView({ items }: { items: MediaItem[] }) {
  if (items.length === 0) {
    return <p className="empty-state">Screenshots and image results will appear here.</p>;
  }

  return (
    <div className="media-view">
      <div className="viewer-section-title">
        <div>
          <span>Media</span>
          <strong>{items.length} asset{items.length === 1 ? "" : "s"}</strong>
        </div>
      </div>
      <div className="media-grid">
        {items.map((item) => (
          <figure key={item.url}>
            <img src={item.url} alt={item.label} />
            <figcaption>
              <ArrowDownToLine size={14} />
              <span>{item.label}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
