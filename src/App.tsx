import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Braces,
  CheckCircle2,
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
type ResultTab = "summary" | "markdown" | "links" | "media" | "json";
type JsonRecord = Record<string, unknown>;
type FirecrawlFormat = string | JsonRecord;

type Settings = {
  baseUrl: string;
  apiKey: string;
  rememberKey: boolean;
  autoPoll: boolean;
  pollEvery: number;
};

type RunRecord = {
  id: string;
  mode: Mode;
  target: string;
  createdAt: string;
  status: string;
  detail: string;
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

const SETTINGS_KEY = "firecrawl-studio-settings";
const HISTORY_KEY = "firecrawl-studio-history";

const defaultSettings: Settings = {
  baseUrl: "http://localhost:3002/v2",
  apiKey: "",
  rememberKey: false,
  autoPoll: true,
  pollEvery: 2500,
};

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

const tbsOptions = [
  { value: "", label: "Any time" },
  { value: "qdr:h", label: "Past hour" },
  { value: "qdr:d", label: "Past day" },
  { value: "qdr:w", label: "Past week" },
  { value: "qdr:m", label: "Past month" },
  { value: "qdr:y", label: "Past year" },
];

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

function normalizeBaseUrl(value: string) {
  const clean = (value || defaultSettings.baseUrl).trim().replace(/\/+$/, "");
  if (/\/v[12]$/i.test(clean)) {
    return clean;
  }
  return `${clean}/v2`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
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
    readStorage(SETTINGS_KEY, defaultSettings),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [mode, setMode] = useState<Mode>("scrape");
  const [targetUrl, setTargetUrl] = useState("https://docs.firecrawl.dev");
  const [searchQuery, setSearchQuery] = useState("firecrawl self hosted guide");
  const [agentPrompt, setAgentPrompt] = useState(
    "Find the key self-hosting requirements and return a concise setup checklist.",
  );
  const [agentUrls, setAgentUrls] = useState("https://docs.firecrawl.dev");
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

  const [result, setResult] = useState<unknown>(null);
  const [lastRequest, setLastRequest] = useState<{
    url: string;
    method: "POST" | "GET";
    payload?: JsonRecord;
  } | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
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
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(storedSettings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  }, [history]);

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

  function buildFormats() {
    const selected: FirecrawlFormat[] = [];
    if (formats.markdown) selected.push("markdown");
    if (formats.html) selected.push("html");
    if (formats.rawHtml) selected.push("rawHtml");
    if (formats.links) selected.push("links");
    if (formats.screenshot) {
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

  function buildScrapeOptions() {
    return compactObject({
      formats: buildFormats(),
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

  function buildPayload(selectedMode: Mode = mode): JsonRecord {
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
        scrapeOptions: searchWithScrape ? buildScrapeOptions() : undefined,
      });
    }

    if (selectedMode === "agent") {
      if (!agentPrompt.trim()) {
        throw new Error("Agent prompt is required.");
      }
      const schema = useSchema ? parseJsonObject(jsonSchema, "Agent schema") : undefined;
      return compactObject({
        prompt: agentPrompt.trim(),
        urls: parseList(agentUrls),
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
        scrapeOptions: buildScrapeOptions(),
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
      ...buildScrapeOptions(),
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

  async function handleRun(event: FormEvent) {
    event.preventDefault();
    setHasSubmitted(true);
    setError("");
    setResult(null);
    setPollingStatus("");
    setActiveTab("summary");
    setIsRunning(true);

    try {
      const payload = buildPayload();
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
      const finalResponse = shouldPoll
        ? await pollJob(mode as Extract<Mode, "crawl" | "agent">, jobId)
        : response;

      saveRun(payload, finalResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.");
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
      const payload = buildPayload();
      const authHeader = settings.apiKey ? "\n  -H 'Authorization: Bearer ***'" : "";
      return `curl -X POST '${resolvedBaseUrl}${modeConfig[mode].path}' \\\n  -H 'Content-Type: application/json'${authHeader} \\\n  -d '${JSON.stringify(payload, null, 2)}'`;
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Request preview unavailable.";
    }
  }

  const status = isRunning ? "running" : error ? "failed" : result ? getStatus(result) : "idle";
  const warning = getWarning(result);
  const commandValue =
    mode === "search" ? searchQuery : mode === "agent" ? agentPrompt : targetUrl;
  const commandPlaceholder =
    mode === "search"
      ? "Search the web with Firecrawl"
      : mode === "agent"
        ? "Ask an agent to research or extract something"
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
          <span className={`status-pill ${settings.apiKey ? "is-ready" : ""}`}>
            {settings.apiKey ? <ShieldCheck size={16} /> : <KeyRound size={16} />}
            {settings.apiKey ? "Auth header ready" : "No auth header"}
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

      <section className="command-stage" aria-label="Firecrawl command">
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
                API key
              </span>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(event) => updateSetting("apiKey", event.currentTarget.value)}
                placeholder="fc-..."
              />
            </label>
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
                  onChange={(event) => updateSetting("rememberKey", event.currentTarget.checked)}
                />
                <span>Remember key</span>
              </label>
            </div>
            <div className="resolved-url">
              <Activity size={14} />
              {resolvedBaseUrl}
            </div>
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

            {mode === "agent" && (
              <>
                <label className="field span-2">
                  <span>
                    <Sparkles size={15} />
                    Prompt
                  </span>
                  <textarea
                    rows={4}
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.currentTarget.value)}
                  />
                </label>
                <label className="field span-2">
                  <span>
                    <Link2 size={15} />
                    URLs
                  </span>
                  <textarea
                    rows={3}
                    value={agentUrls}
                    onChange={(event) => setAgentUrls(event.currentTarget.value)}
                    placeholder="One URL per line"
                  />
                </label>
                <label className="field">
                  <span>Model</span>
                  <select
                    value={agentModel}
                    onChange={(event) => setAgentModel(event.currentTarget.value)}
                  >
                    <option value="spark-1-mini">spark-1-mini</option>
                    <option value="spark-1-pro">spark-1-pro</option>
                  </select>
                </label>
                <label className="field">
                  <span>Max credits</span>
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
                        onChange={(event) =>
                          setFormats((current) => ({
                            ...current,
                            [key]: event.currentTarget.checked,
                          }))
                        }
                      />
                      {key}
                    </label>
                  ))}
                </div>

                {formats.screenshot && (
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
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={strictAgentUrls}
                      onChange={(event) => setStrictAgentUrls(event.currentTarget.checked)}
                    />
                    <span>Stay inside URLs</span>
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
                        onChange={(event) =>
                          setSearchSources((current) => ({
                            ...current,
                            [key]: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                  {Object.entries(searchCategories).map(([key, enabled]) => (
                    <label key={key} className="toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) =>
                          setSearchCategories((current) => ({
                            ...current,
                            [key]: event.currentTarget.checked,
                          }))
                        }
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
            {(["summary", "markdown", "links", "media", "json"] as ResultTab[]).map((tab) => (
              <button
                type="button"
                key={tab}
                className={activeTab === tab ? "active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
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
                        {modeConfig[item.mode].label} · {item.status} · {item.detail}
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
      <pre className="json-snippet">{formatJson(result).slice(0, 4500)}</pre>
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
    <div className="media-grid">
      {items.map((item) => (
        <figure key={item.url}>
          <img src={item.url} alt={item.label} />
          <figcaption>
            <ArrowDownToLine size={14} />
            {item.label}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
