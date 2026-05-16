import { basename } from "node:path";

const CORRECTION_TTL_MS = 15_000;
const YANDEX_SPELLER = "https://speller.yandex.net/services/spellservice.json/checkText";

const _corrections = new Map();
const _skipOnce = new Set();

let _cache = null;
let _lang = "en";
let _folderName = "spell-check";
let _tpl = "";

const BANG = /^!/;
const MIN_WORDS = 2;

const _esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const _applyFixes = (query, errors) => {
  let out = query;
  let offset = 0;
  for (const e of errors) {
    if (!e.s?.length) continue;
    const start = e.pos + offset;
    const end = start + e.len;
    const rep = e.s[0];
    out = out.slice(0, start) + rep + out.slice(end);
    offset += rep.length - e.len;
  }
  return out;
};

const _toLang = (tag) => tag.split(/[-_]/)[0].toLowerCase();

export const interceptor = {
  isClientExposed: false,
  name: "Spell Check",
  description:
    "Intercepts search queries and corrects spelling using Yandex Speller.",

  settingsSchema: [
    {
      key: "language",
      label: "Language",
      type: "text",
      default: "en",
      placeholder: "en",
      description: "Language code passed to Yandex Speller (en, ru, uk).",
    },
  ],

  configure(settings) {
    _lang = _toLang(settings.language || "en");
  },

  init(ctx) {
    _cache = ctx.createCache(120_000);
    _folderName = basename(ctx.dir);
  },

  async intercept(query, context) {
    const q = query.trim();
    if (!q || BANG.test(q) || q.split(/\s+/).length < MIN_WORDS)
      return { query };

    if (_skipOnce.has(q)) {
      _skipOnce.delete(q);
      return { query };
    }

    const cacheKey = `${_lang}:${q}`;
    const hit = _cache?.get(cacheKey);
    if (hit) {
      if (hit.query !== q)
        _corrections.set(q, {
          corrected: hit.query,
          expiresAt: Date.now() + CORRECTION_TTL_MS,
        });
      return hit;
    }

    const fetchFn = context?.fetch ?? fetch;

    try {
      const url = `${YANDEX_SPELLER}?text=${encodeURIComponent(q)}&lang=${_lang}`;
      const res = await fetchFn(url);

      if (!res.ok) return { query };

      const errors = await res.json();
      if (!Array.isArray(errors) || errors.length === 0) return { query };

      const corrected = _applyFixes(q, errors);
      if (corrected === q) return { query };

      const result = { query: corrected };
      _cache?.set(cacheKey, result);
      _corrections.set(q, {
        corrected,
        expiresAt: Date.now() + CORRECTION_TTL_MS,
      });
      return result;
    } catch (err) {
      console.warn("[spell-check] Yandex Speller request failed", err);
      return { query };
    }
  },
};

export const slot = {
  isClientExposed: false,
  name: "Spell Check",
  description: "Shows a correction banner when a query was spell-checked.",
  position: "at-a-glance",

  init(ctx) {
    _tpl = ctx.template;
    _folderName = basename(ctx.dir);
  },

  trigger(query) {
    const entry = _corrections.get(query);
    return !!(entry && Date.now() < entry.expiresAt);
  },

  async execute(query) {
    const entry = _corrections.get(query);
    if (!entry || Date.now() > entry.expiresAt) return { html: "" };

    const { corrected } = entry;
    const html = _tpl
      .replace(/\{\{corrected\}\}/g, _esc(corrected))
      .replace(/\{\{original\}\}/g, _esc(query))
      .replace(
        /\{\{search_url\}\}/g,
        `/search?q=${encodeURIComponent(query)}`,
      )
      .replace(
        /\{\{skip_endpoint\}\}/g,
        `/api/plugin/${_folderName}/skip`,
      );

    return { html };
  },
};

export const routes = [
  {
    method: "post",
    path: "/skip",
    async handler(req) {
      try {
        const body = await req.json();
        if (typeof body?.q === "string" && body.q) {
          _skipOnce.add(body.q);
          setTimeout(() => _skipOnce.delete(body.q), 30_000);
        }
      } catch (err) {
        console.warn("[spell-check] skip route parse failed", err);
      }
      return new Response(null, { status: 204 });
    },
  },
];
