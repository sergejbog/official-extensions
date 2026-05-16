const DDG_SEARCH = "https://duckduckgo.com/";

const escHtml = (s) => {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const buildDdgQuery = (args) => {
  const t = args.trim();
  if (!t) return "";
  if (t.startsWith("!")) return t;
  return `!${t}`;
};

const redirectGoHandler = async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("q") ?? "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("!!")) {
    return new Response("Bad request", { status: 400 });
  }
  const inner = trimmed.slice(2).trimStart();
  const ddgQ = inner.startsWith("!") ? inner : `!${inner}`;
  const dest = `${DDG_SEARCH}?q=${encodeURIComponent(ddgQ)}`;
  return Response.redirect(dest, 302);
};

export default {
  isClientExposed: false,
  name: "DuckDuckGo !bangs",
  description:
    "Type !! followed by any ddg bang command to trigger them directly from degoog. This WILL route through duckduckgo.",
  trigger: "ddb",
  aliases: ["ddb", "dbang"],

  settingsSchema: [],

  routes: [
    {
      method: "get",
      path: "/go",
      handler: redirectGoHandler,
    },
  ],

  async execute(args) {
    const raw = args.trim();
    if (!raw) {
      return {
        title: "DuckDuckGo bang redirect",
        html: `<div class="command-result">
          <p><strong>!!wiki cats</strong> in the search bar (handled by this plugin’s script).</p>
          <p><strong>!ddg wiki cats</strong> — bang command (aliases <code>!ddb</code>, <code>!dbang</code>).</p>
          <p>Note: !!wiki cats without a space after !! will not work as a plugin-only install; the host parses that as a different command name.</p>
        </div>`,
      };
    }

    const q = buildDdgQuery(raw);
    const url = `${DDG_SEARCH}?q=${encodeURIComponent(q)}`;
    const safeUrl = JSON.stringify(url);

    return {
      title: "Redirecting…",
      html: `<div class="command-result">
        <p>Opening DuckDuckGo…</p>
        <p><a href="${escHtml(url)}">Continue if you are not redirected</a></p>
        <script>location.replace(${safeUrl})</script>
      </div>`,
    };
  },
};
