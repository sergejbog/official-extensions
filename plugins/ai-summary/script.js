(function () {
  const glanceEl = document.getElementById("at-a-glance");
  if (!glanceEl) return;

  const SUMMARY_URL = "/api/plugin/fccview-degoog-extensions-ai-summary/stream";
  const CHAT_URL = "/api/plugin/fccview-degoog-extensions-ai-summary/chat";
  const MAX_SOURCES = 6;
  const FAVICON_BASE = "https://www.google.com/s2/favicons";

  let history = [];
  let sources = [];

  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const getQuery = () => new URLSearchParams(window.location.search).get("q") || "";

  const collectResults = () => {
    const items = document.querySelectorAll("#results-list .result-item");
    const out = [];
    let i = 0;
    for (const el of items) {
      if (i >= MAX_SOURCES) break;
      const title = (el.querySelector(".result-title")?.textContent || "").trim();
      const snippet = (el.querySelector(".result-snippet")?.textContent || "").trim();
      const url = el.querySelector("a[href]")?.getAttribute("href") || "";
      if (!title && !snippet) continue;
      i++;
      out.push({ title, snippet, url });
    }
    return out;
  };

  const hostOf = (url) => {
    try {
      return new URL(url, window.location.origin).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  const faviconFor = (url) => {
    const host = hostOf(url);
    return host ? `${FAVICON_BASE}?domain=${encodeURIComponent(host)}&sz=32` : "";
  };

  const citeHtml = (n) => {
    const map = new Map(sources.map((s) => [s.i, s]));
    const src = map.get(parseInt(n, 10));
    if (!src) return escapeHtml(`[${n}]`);
    const fav = faviconFor(src.u);
    const host = src.h || hostOf(src.u);
    return (
      `<a class="degoog-badge glance-ai-cite" href="${escapeHtml(src.u)}" ` +
      `target="_blank" rel="noopener" title="${escapeHtml(src.t || host)}">` +
      (fav ? `<img class="glance-ai-cite-favicon" src="${escapeHtml(fav)}" alt="" width="12" height="12">` : "") +
      `<span class="glance-ai-cite-n">[${escapeHtml(n)}]</span>` +
      (host ? `<span class="glance-ai-cite-host">${escapeHtml(host)}</span>` : "") +
      "</a>"
    );
  };

  const injectCites = (text) => {
    if (!sources.length) return text;
    return text.replace(/\[(\d+(?:\s*[,\s]\s*\d+)*)\]/g, (full) =>
      (full.match(/\d+/g) || []).map(citeHtml).join(""),
    );
  };

  const renderRich = (text) => {
    const withCites = injectCites(text);
    const md = window.__degoogMd;
    if (md) return md.block(withCites);
    return escapeHtml(withCites).replace(/\n/g, "<br>");
  };

  const autoResize = (el) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  const parseSrcs = (box) => {
    try {
      return JSON.parse(box.dataset.sources || "[]");
    } catch {
      return [];
    }
  };

  const skeletonHtml = () =>
    '<div class="glance-ai-skeleton" aria-hidden="true">' +
    '<div class="skeleton-line skeleton-line--snippet"></div>' +
    '<div class="skeleton-line skeleton-line--snippet"></div>' +
    '<div class="skeleton-line skeleton-line--snippet-short"></div>' +
    "</div>";

  const writingHtml = () =>
    '<div class="glance-ai-writing" aria-label="' + escapeHtml(t("ai-summary.writing") || "writing") + '">' +
    "<span></span><span></span><span></span></div>";

  const mountThinking = (anchor, position) => {
    const label = document.createElement("div");
    label.className = "glance-ai-thinking-label";
    label.textContent = t("ai-summary.thinking");
    const stream = document.createElement("div");
    stream.className = "glance-ai-thinking-stream";
    if (position === "before") {
      anchor.parentNode.insertBefore(label, anchor);
      anchor.parentNode.insertBefore(stream, anchor);
    } else {
      anchor.appendChild(label);
      anchor.appendChild(stream);
    }
    return { label, stream };
  };

  const clearPending = (root) => {
    root.querySelectorAll(".glance-ai-skeleton, .glance-ai-writing")
      .forEach((el) => el.remove());
  };

  const clearTransient = (root) => {
    root.querySelectorAll(".glance-ai-thinking-stream, .glance-ai-thinking-label, .glance-ai-skeleton, .glance-ai-writing")
      .forEach((el) => el.remove());
  };

  const consumeSse = async (res, handlers) => {
    if (!res.ok || !res.body) {
      handlers.onError("Stream failed");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let evt;
    let data = "";
    const flush = () => {
      if (!data.length) {
        evt = undefined;
        return;
      }
      const payload = data.replace(/\n$/, "");
      let parsed = {};
      try {
        parsed = JSON.parse(payload);
      } catch {}
      if (evt === "delta") handlers.onDelta(parsed.text || "");
      else if (evt === "thinking") handlers.onThinking(parsed.text || "");
      else if (evt === "done") handlers.onDone(parsed.finishReason);
      else if (evt === "error") handlers.onError(parsed.message || "Stream error");
      evt = undefined;
      data = "";
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          flush();
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "") + "\n";
      }
    }
    flush();
  };

  const runStream = ({ url, payload, onFirstText, onComplete, onFail, target, thinkAnchor, thinkPos }) => {
    let textBuf = "";
    let thinkBuf = "";
    let started = false;
    let thinking = null;

    const handlers = {
      onDelta: (chunk) => {
        if (!started) {
          started = true;
          clearTransient(target);
          thinking = null;
          onFirstText();
        }
        textBuf += chunk;
        target.innerHTML = renderRich(textBuf);
      },
      onThinking: (text) => {
        if (started || !text) return;
        if (!thinking) {
          clearPending(target);
          thinking = mountThinking(thinkAnchor || target, thinkPos || "append");
        }
        thinkBuf += text;
        thinking.stream.textContent = thinkBuf;
        thinking.stream.scrollTop = thinking.stream.scrollHeight;
      },
      onDone: () => {
        clearTransient(target);
        if (!textBuf.trim()) {
          onFail(t("ai-summary.no-response"));
          return;
        }
        onComplete(textBuf);
      },
      onError: (msg) => {
        clearTransient(target);
        onFail(msg || t("ai-summary.request-failed"));
      },
    };

    return (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await consumeSse(res, handlers);
      } catch {
        handlers.onError(t("ai-summary.request-failed"));
      }
    })();
  };

  const streamSummary = async (box) => {
    const target = box.querySelector(".glance-snippet");
    const diveBtn = box.querySelector(".glance-ai-dive");
    if (!target) return;
    const query = getQuery();
    const results = collectResults();
    if (!query || results.length === 0) return;

    await runStream({
      url: SUMMARY_URL,
      payload: { query, results },
      target,
      onFirstText: () => {
        target.dataset.state = "streaming";
        target.innerHTML = writingHtml();
      },
      onComplete: (text) => {
        target.dataset.state = "done";
        target.innerHTML = renderRich(text);
        initFollowUp(box, text);
        if (diveBtn) diveBtn.hidden = false;
      },
      onFail: (msg) => {
        target.dataset.state = "error";
        target.textContent = msg;
      },
    });
  };

  const initFollowUp = (box, initialSummary) => {
    const query = getQuery();
    const ctxBlock = sources.map((s) => `[${s.i}] ${s.t}\n${s.u}`).join("\n\n");
    history = [
      {
        role: "system",
        content:
          "You are a helpful assistant. The user searched for: " +
          JSON.stringify(query) +
          ". Sources available (cite with [N]):\n\n" +
          ctxBlock +
          "\n\nYou already gave a summary. Now the user wants to dive deeper. Answer follow-ups conversationally and concisely. Cite with [N] when you use a source.",
      },
      { role: "assistant", content: initialSummary },
    ];

    const diveBtn = box.querySelector(".glance-ai-dive");
    const chatWrap = box.querySelector(".glance-ai-chat");
    const input = box.querySelector(".glance-ai-input");
    const messagesEl = box.querySelector(".glance-ai-messages");
    if (!diveBtn || !chatWrap || !input || !messagesEl) return;

    diveBtn.addEventListener("click", () => {
      diveBtn.hidden = true;
      chatWrap.hidden = false;
      input.focus();
    });
    input.addEventListener("input", () => autoResize(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendFollowUp(input, messagesEl);
      }
    });
  };

  const sendFollowUp = async (input, messagesEl) => {
    const text = input.value.trim();
    if (!text) return;
    const userDiv = document.createElement("div");
    userDiv.className = "glance-ai-reply glance-ai-user";
    userDiv.textContent = text;
    messagesEl.appendChild(userDiv);
    history.push({ role: "user", content: text });
    input.value = "";
    autoResize(input);

    const reply = document.createElement("div");
    reply.className = "glance-ai-reply";
    reply.innerHTML = skeletonHtml();
    messagesEl.appendChild(reply);

    await runStream({
      url: CHAT_URL,
      payload: { messages: history },
      target: reply,
      thinkAnchor: reply,
      thinkPos: "before",
      onFirstText: () => {
        reply.innerHTML = writingHtml();
      },
      onComplete: (out) => {
        history.push({ role: "assistant", content: out });
        reply.innerHTML = renderRich(out);
      },
      onFail: (msg) => {
        reply.remove();
        const err = document.createElement("div");
        err.className = "glance-ai-typing";
        err.textContent = msg;
        messagesEl.appendChild(err);
      },
    });
    input.focus();
  };

  const bootBox = (box) => {
    if (box.dataset.chatInit) return;
    box.dataset.chatInit = "1";
    sources = parseSrcs(box);
    if (box.dataset.stream === "1") streamSummary(box);
  };

  const observer = new MutationObserver(() => {
    const box = glanceEl.querySelector(".glance-ai");
    if (box) bootBox(box);
  });
  observer.observe(glanceEl, { childList: true, subtree: true });

  const existing = glanceEl.querySelector(".glance-ai");
  if (existing) bootBox(existing);
})();
