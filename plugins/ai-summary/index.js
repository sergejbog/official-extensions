import { createHash } from "node:crypto";
import { ChunkKind, ProviderId, pickAdapter } from "./providers/index.js";

const AI_SUMMARY_ID = "ai-summary-slot";
const SUMMARY_NAMESPACE = "ext:ai-summary:summary";
const MAX_SOURCES = 6;
const DEFAULT_TIMEOUT_S = 180;
const DEFAULT_MAX_TOKENS = 2048;
const FOLLOWUP_MIN_TOKENS = 512;
const SHORT_TTL_MS = 2 * 60 * 1000;
const THINK_ONLY_MS = 45_000;
const ROUTE_STREAM = "/stream";
const ROUTE_CHAT = "/chat";
const LOG_NS = "ai-summary:routes";

export const DEFAULT_SYSTEM_PROMPT = [
  "<identity>",
  "You are a Search Synthesis Engine. Your sole purpose is to deliver an accurate, useful, highly structured, and deeply cited answer to the user's query, drawing strictly from the numbered search results provided.",
  "</identity>",
  "",
  "<context_integration>",
  "Context arrives as numbered results: [N] Title (host)\\nSnippet.",
  "Your answer must be entirely informed by that context. If the context does not fully answer the query, state plainly what is missing, summarize what is available, and suggest one or two follow-up searches the user could try. Do not assume or extrapolate.",
  "Never refer to your training cutoff, your model architecture, or your lack of real-time access. The provided context IS your real-time access.",
  "</context_integration>",
  "",
  "<citation_protocol>",
  "1. CRITICAL: Every single factual claim, statement, list item, or table row MUST be cited inline as [N] immediately after the claim, with no space between the last word and the bracket.",
  "2. Multiple sources on one claim look like [1][3]. If several results corroborate a claim, cite all of them.",
  "3. Cite only results you actually used. Do not invent citations or pad with irrelevant ones.",
  "4. Never include a References, Sources, or Bibliography section. Never write URLs or full source titles in the prose. The engine renders the [N] markers as links.",
  "</citation_protocol>",
  "",
  "<formatting_and_ux>",
  "- STRUCTURED & CITED: Scale the depth of the answer to match the complexity of the query. For factual lookups, a single cited sentence is fine. For multi-faceted queries, provide a comprehensive, multi-paragraph layout using headers, lists, or tables, but EVERY section, list item, or table cell containing factual data must carry its respective [N] citation.",
  "- SCANNABILITY IS KING: Break up dense walls of text. Use Level-2 headers (##) to separate distinct aspects of the answer. Use **bolding** for critical terms, dates, and names to guide the user's eye.",
  "- LISTS & TABLES: Whenever comparing data, listing steps, or aggregating distinct points, aggressively prefer structured Markdown lists (bulleted or numbered) or Markdown tables over prose paragraphs. Ensure inline citations [N] are embedded within these lists/tables.",
  "- Begin directly with the answer (or a one-sentence high-level overview for multi-part queries). Never start with a markdown heading, a preamble, or filler like 'Sure', 'Here is', 'Based on the search results', or 'According to the sources'.",
  "- Match the language of the user's query.",
  "- If code is required, emit the fully functional code block first, then a short explanation beneath.",
  "</formatting_and_ux>",
  "",
  "<tone_and_guardrails>",
  "- Unbiased, journalistic, authoritative. Avoid opinionated adjectives.",
  "- No hedging or moralizing. Cut phrases like 'It is important to', 'It is worth noting', 'It is subjective', 'Some might argue', 'it seems', 'it might be', unless the sources themselves disagree, in which case briefly note the disagreement and prefer the most recent or most authoritative-looking source.",
  "- Copyright: do not reproduce long verbatim passages (lyrics, poems, full articles, full recipes). Summarize and rewrite in your own words.",
  "</tone_and_guardrails>",
  "",
  "<execution_workflow>",
  "CRITICAL FOR SPEED: Do not deliberate, plan, or analyze. Do not generate a hidden reasoning chain or draft. Treat this as a direct stream-to-output task. Read the context and immediately begin writing the final synthesized answer in a single pass, adhering strictly to the formatting and inline citation rules above.",
  "</execution_workflow>",
].join("\n");

const settingsSchema = [
  {
    key: "questionMarkOnly",
    label: "Only trigger on questions (?)",
    type: "toggle",
    description: "Only show summaries when the query ends with `?`.",
  },
  {
    key: "provider",
    label: "Provider",
    type: "select",
    options: [ProviderId.OpenAICompat, ProviderId.Gemini, ProviderId.Anthropic],
    optionLabels: [
      "OpenAI compatible (OpenAI, Ollama, vLLM, ...)",
      "Google Gemini (native)",
      "Anthropic Claude (native)",
    ],
    default: ProviderId.OpenAICompat,
    description:
      "**OpenAI-compatible** covers OpenAI, [Ollama](https://ollama.com), vLLM. **Gemini** and **Anthropic** use their native streaming APIs.",
  },
  {
    key: "baseUrl",
    label: "API Base URL",
    type: "url",
    placeholder: "https://api.openai.com/v1",
    description:
      "Include the version path for OpenAI-compatible providers (`https://api.openai.com/v1`, or `http://localhost:11434/v1` for [Ollama](https://ollama.com)). Leave blank for Gemini and Anthropic; if you set a host-only override, the version path is filled in automatically.",
  },
  {
    key: "model",
    label: "Model",
    type: "text",
    required: true,
    placeholder: "gpt-4o-mini / gemini-2.5-flash / claude-haiku-4-5",
    description:
      "Model id. Lists: [OpenAI](https://platform.openai.com/docs/models), [Gemini](https://ai.google.dev/gemini-api/docs/models), [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models). For Ollama/vLLM use whatever you have served. Reasoning models work; their thoughts stream live and clear when the answer starts.",
  },
  {
    key: "apiKey",
    label: "API Key",
    type: "password",
    secret: true,
    placeholder: "Leave blank for local models (Ollama)",
    description:
      "Get one from [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey), or [Anthropic](https://console.anthropic.com/settings/keys). Not needed for local Ollama.",
  },
  {
    key: "enableThinking",
    label: "Let reasoning models think",
    type: "toggle",
    description:
      "Off by default. When off: Gemini budget `0`, Anthropic thinking disabled, Qwen models get `/no_think` appended. On is slower and costlier.",
  },
  {
    key: "timeoutSeconds",
    label: "Timeout (seconds)",
    type: "text",
    placeholder: "180",
    description: "Max seconds before giving up. Default `180`.",
  },
  {
    key: "maxTokens",
    label: "Max Tokens",
    type: "text",
    placeholder: "2048",
    description:
      "Max tokens for the response. Default `2048`. Reasoning models need budget for thinking *and* answer; bump to `4096`+ for deep models.",
  },
  {
    key: "systemPrompt",
    label: "Custom System Prompt",
    type: "textarea",
    placeholder: DEFAULT_SYSTEM_PROMPT,
    description: "Override the default system prompt. Blank uses the default.",
  },
];

const _normaliseProvider = (raw) => {
  const all = Object.values(ProviderId);
  return all.includes(raw) ? raw : ProviderId.OpenAICompat;
};

const _asStr = (v) => (typeof v === "string" ? v : String(v ?? ""));
const _asBool = (v) => v === "true" || v === true;

const _parseSettings = (raw) => {
  const timeoutSeconds = parseFloat(_asStr(raw["timeoutSeconds"]) || "") || DEFAULT_TIMEOUT_S;
  const maxTokens = parseInt(_asStr(raw["maxTokens"]) || "", 10) || DEFAULT_MAX_TOKENS;
  return {
    provider: _normaliseProvider(_asStr(raw["provider"])),
    baseUrl: _asStr(raw["baseUrl"]),
    model: _asStr(raw["model"]),
    apiKey: _asStr(raw["apiKey"]),
    timeoutMs: Math.max(5, timeoutSeconds) * 1000,
    systemPrompt: _asStr(raw["systemPrompt"]),
    maxTokens: Math.max(16, maxTokens),
    questionMarkOnly: _asBool(raw["questionMarkOnly"]),
    enableThinking: _asBool(raw["enableThinking"]),
  };
};

let _settings = _parseSettings({});
let _summaryCache = null;

const _resolveCache = (ctx) => {
  if (typeof ctx?.useCache === "function") {
    return ctx.useCache(SUMMARY_NAMESPACE, SHORT_TTL_MS);
  }
  if (typeof ctx?.createCache === "function") {
    const sync = ctx.createCache(SHORT_TTL_MS);
    return {
      get: async (k) => sync.get(k),
      set: async (k, v) => sync.set(k, v),
      delete: async (k) => { if (typeof sync.delete === "function") sync.delete(k); },
      clear: async () => sync.clear(),
    };
  }
  return null;
};

const _hostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const buildSources = (results) =>
  results.slice(0, MAX_SOURCES).map((r, i) => ({
    index: i + 1,
    title: r.title || "",
    url: r.url,
    snippet: r.snippet || "",
    host: _hostname(r.url),
  }));

const buildUserPrompt = (query, sources) => {
  const block = sources
    .map((s) => `[${s.index}] ${s.title}${s.host ? ` (${s.host})` : ""}\n${s.snippet}`)
    .join("\n\n");
  return `Query: ${query.trim()}\n\nSearch results:\n${block}`;
};

const summaryCacheKey = (query, results) => {
  const fp = results
    .slice(0, MAX_SOURCES)
    .map((r) => `${r.url}\n${r.snippet}`)
    .join("\n\n");
  const hash = createHash("sha256").update(fp).digest("hex").slice(0, 24);
  return `${query.trim().toLowerCase()}|${hash}`;
};

const _escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildPanelHtml = (t, query, sources) => {
  const sourcesJson = JSON.stringify(
    sources.map((s) => ({ i: s.index, u: s.url, t: s.title, h: s.host })),
  );
  return (
    '<div class="glance-ai degoog-panel degoog-panel--slot degoog-panel--slot-body-padded degoog-vstack"' +
    ` data-stream="1" data-query="${_escapeHtml(query)}"` +
    ` data-sources="${_escapeHtml(sourcesJson)}">` +
    '<div class="glance-ai-messages">' +
    '<div class="glance-snippet glance-ai-stream degoog-text degoog-text--md" data-state="pending">' +
    '<div class="skeleton-glance glance-ai-skeleton" aria-hidden="true">' +
    '<div class="skeleton-line skeleton-line--snippet"></div>' +
    '<div class="skeleton-line skeleton-line--snippet"></div>' +
    '<div class="skeleton-line skeleton-line--snippet-short"></div>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="glance-ai-footer">' +
    `<span class="glance-ai-badge degoog-badge">${t("ai-summary.badge")}</span>` +
    `<button class="glance-ai-dive degoog-link-btn" type="button" hidden>${t("ai-summary.dive-deeper")}</button>` +
    "</div>" +
    '<div class="glance-ai-chat" hidden>' +
    `<textarea class="glance-ai-input degoog-input degoog-input--chat" placeholder="${t("ai-summary.follow-up-placeholder")}" rows="1"></textarea>` +
    "</div>" +
    "</div>"
  );
};

const encoder = new TextEncoder();

const writeSse = (controller, event, data) => {
  const payload = typeof data === "string" ? data : JSON.stringify(data ?? {});
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`));
};

const sseResponse = (body) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });

const pump = async (iter, controller) => {
  let errored = false;
  let finishReason;
  let text = "";
  for await (const ch of iter) {
    if (ch.kind === ChunkKind.Text) {
      text += ch.text;
      writeSse(controller, "delta", { text: ch.text });
    } else if (ch.kind === ChunkKind.Thinking) {
      writeSse(controller, "thinking", { text: ch.text });
    } else if (ch.kind === ChunkKind.Error) {
      errored = true;
      writeSse(controller, "error", { message: ch.message });
    } else if (ch.kind === ChunkKind.Done) {
      finishReason = ch.finishReason;
    }
  }
  return { finishReason, errored, text };
};

const runStream = (messages, maxTokens, cacheKey) => {
  const s = _settings;
  const adapter = pickAdapter(s.provider);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), s.timeoutMs);
  const emitThinking = s.enableThinking;

  const body = new ReadableStream({
    async start(controller) {
      let watchdog = null;
      try {
        if (cacheKey && _summaryCache) {
          const cached = await _summaryCache.get(cacheKey);
          if (cached) {
            writeSse(controller, "delta", { text: cached });
            writeSse(controller, "done", { finishReason: "cache" });
            return;
          }
        }
        if (!emitThinking) {
          watchdog = setTimeout(() => {
            console.warn(LOG_NS, "no text within window, aborting");
            abort.abort();
          }, THINK_ONLY_MS);
        }
        const iter = adapter.stream(
          { baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey },
          messages,
          { maxTokens, enableThinking: s.enableThinking, signal: abort.signal },
        );
        const wrapped = (async function* () {
          for await (const ch of iter) {
            if (ch.kind === ChunkKind.Text && watchdog) {
              clearTimeout(watchdog);
              watchdog = null;
            }
            yield ch;
          }
        })();
        const out = await pump(wrapped, controller);
        if (out.errored) return;
        if (!out.text.trim()) {
          writeSse(controller, "error", { message: "Model produced no answer" });
          return;
        }
        if (cacheKey && _summaryCache) {
          try {
            await _summaryCache.set(cacheKey, out.text);
          } catch (err) {
            console.warn(LOG_NS, "cache set failed", err);
          }
        }
        writeSse(controller, "done", { finishReason: out.finishReason ?? "stop" });
      } catch (err) {
        console.warn(LOG_NS, "stream failed", err);
        try { writeSse(controller, "error", { message: "Stream failed" }); } catch {}
      } finally {
        if (watchdog) clearTimeout(watchdog);
        clearTimeout(timeout);
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      clearTimeout(timeout);
      abort.abort();
    },
  });
  return sseResponse(body);
};

const buildSummaryMsgs = (query, results) => {
  const sources = buildSources(results);
  return [
    { role: "system", content: _settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(query, sources) },
  ];
};

const _jsonError = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const slot = {
  id: AI_SUMMARY_ID,
  settingsId: AI_SUMMARY_ID,
  name: "AI Summary",
  waitForResults: true,
  get description() {
    return this.t?.("ai-summary.description") ?? "AI Summary";
  },
  position: "at-a-glance",
  isClientExposed: false,

  async init(ctx) {
    _summaryCache = _resolveCache(ctx);
  },

  configure(s) {
    _settings = _parseSettings(s ?? {});
  },

  async trigger(query) {
    if (!_settings.model) return false;
    if (_settings.provider === ProviderId.OpenAICompat && !_settings.baseUrl) return false;
    if (_settings.provider !== ProviderId.OpenAICompat && !_settings.apiKey) return false;
    if (_settings.questionMarkOnly && !query.trim().endsWith("?")) return false;
    return true;
  },

  async execute(query, context) {
    const results = context?.results ?? [];
    if (results.length === 0) return { html: "" };
    const sources = buildSources(results);
    return { html: buildPanelHtml(this.t, query.trim(), sources) };
  },

  settingsSchema,
};

export const routes = [
  {
    method: "post",
    path: ROUTE_STREAM,
    async handler(req) {
      let body;
      try {
        body = await req.json();
      } catch {
        return _jsonError("Invalid JSON", 400);
      }
      const query = (body.query ?? "").trim();
      const results = Array.isArray(body.results) ? body.results : [];
      if (!query || results.length === 0) return _jsonError("Missing query or results", 400);
      if (!_settings.model) return _jsonError("AI summary not configured", 400);
      return runStream(buildSummaryMsgs(query, results), _settings.maxTokens, summaryCacheKey(query, results));
    },
  },
  {
    method: "post",
    path: ROUTE_CHAT,
    async handler(req) {
      let body;
      try {
        body = await req.json();
      } catch {
        return _jsonError("Invalid JSON", 400);
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return _jsonError("Missing messages", 400);
      }
      if (!_settings.model) return _jsonError("AI summary not configured", 400);
      return runStream(body.messages, Math.max(_settings.maxTokens, FOLLOWUP_MIN_TOKENS), null);
    },
  },
];
