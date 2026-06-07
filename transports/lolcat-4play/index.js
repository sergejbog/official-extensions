import { ContainerPool } from "./src/container-pool.js";
import { tabSpell } from "./src/browser.js";
import { wrapResponse } from "./src/response.js";
import {
  FETCH_TIMEOUT_MS,
  containerConfigKey,
  normaliseSettings,
  settingsSchemaFor,
  DEFAULT_CONTAINER_TTL_H,
} from "./src/settings.js";

const WEB_RESPONSE_TYPES = ["main_frame", "xmlhttprequest"];

export default class FourPlayTransport {
  isClientExposed = true;
  name = "lolcat-4play";
  displayName = "4play (lolcat)";
  description =
    "Fetches pages using a real Firefox session via the official [lolcat 4play](https://git.lolcat.ca/lolcat/4play) browser extension. Point the extension at this transport's WebSocket address instead of a separate server.";

  _password = "";
  _timeoutMs = 30000;
  _useContainer = false;
  _proxyType = "none";
  _proxyHost = "";
  _proxyPort = 1080;
  _proxyUsername = "";
  _proxyPassword = "";
  _proxyDns = true;
  _session = null;
  _containerConfigKey = "";
  _maxPoolSize = 5;
  _containerTtlMs = DEFAULT_CONTAINER_TTL_H * 60 * 60 * 1000;

  _urlPending = new Map();
  _tabPending = new Map();

  _containers = new ContainerPool({
    command: (action, params, timeoutMs) => this._cmd(action, params, timeoutMs),
    hasSession: () => Boolean(this._session),
    buildProxy: () => this._dressProxy(),
    proxyType: () => this._proxyType,
    timeoutMs: () => this._timeoutMs,
    maxPoolSize: () => this._maxPoolSize,
    ttlMs: () => this._containerTtlMs,
  });

  get settingsSchema() {
    return settingsSchemaFor(this.name);
  }

  wsHandler = {
    onUpgrade: (passwordPath) => passwordPath === `/${this._password}`,

    onOpen: () => {
      this._cmd("web_response_whitelist", { list: WEB_RESPONSE_TYPES }).catch(() => { });
    },

    onMessage: (_ws, raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg?.action !== "web_response") return;

      const { id: tabId, url, body } = msg?.data ?? {};

      const byTab = typeof tabId === "number" && this._tabPending.get(tabId);
      if (byTab) {
        this._settlePending(byTab, byTab.resolve, { url, body });
        return;
      }

      const byUrl =
        typeof url === "string" ? this._firstUrlPending(url) : null;
      if (byUrl) {
        this._settlePending(byUrl, byUrl.resolve, { url, body });
      }
    },

    onClose: () => {
      this._session = null;
      this._containers.clear();
      this._drainPending("lolcat-4play: browser extension disconnected");
    },
  };

  bindWsSession(session) {
    this._session = session;
  }

  configure(settings = {}) {
    const oldKey = this._containerConfigKey;
    const next = normaliseSettings(settings);

    this._timeoutMs = next.timeoutMs;
    this._maxPoolSize = next.maxPoolSize;
    this._containerTtlMs = next.containerTtlMs;
    this._useContainer = next.useContainer;
    this._proxyType = next.proxyType;
    this._proxyHost = next.proxyHost;
    this._proxyPort = next.proxyPort;
    this._proxyUsername = next.proxyUsername;
    this._proxyPassword = next.proxyPassword;
    this._proxyDns = next.proxyDns;
    this._password = next.password;
    this._containerConfigKey = containerConfigKey(next);

    if (oldKey && oldKey !== this._containerConfigKey) {
      this._containers.yerOldGetOuttaHere();
    }
  }

  available() {
    return this._session?.connected() === true;
  }

  _cmd(action, params = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    if (!this._session) {
      return Promise.reject(
        new Error("lolcat-4play: transport session not initialized"),
      );
    }
    return this._session.cmd(action, params, timeoutMs);
  }

  _dressProxy() {
    const proxy = {
      type: this._proxyType === "socks5" ? "socks" : this._proxyType,
      host: this._proxyHost,
      port: this._proxyPort,
      proxyDNS: this._proxyDns,
    };
    if (this._proxyUsername) proxy.username = this._proxyUsername;
    if (this._proxyPassword) proxy.password = this._proxyPassword;
    return proxy;
  }

  _firstUrlPending(url) {
    return this._urlPending.get(url)?.values().next().value ?? null;
  }

  _forgetUrlPending(entry) {
    const entries = this._urlPending.get(entry.url);
    if (!entries) return;

    entries.delete(entry);
    if (!entries.size) this._urlPending.delete(entry.url);
  }

  _settlePending(entry, settle, value) {
    if (!entry || entry.settled) return;

    entry.settled = true;
    clearTimeout(entry.timer);
    this._forgetUrlPending(entry);
    if (typeof entry.tabId === "number") this._tabPending.delete(entry.tabId);
    settle(value);
  }

  _registerPending(url) {
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { url, resolve, reject, timer: null, tabId: null, settled: false };
    });
    promise.catch(() => { });

    entry.timer = setTimeout(() => {
      this._settlePending(entry, entry.reject, new Error("lolcat-4play: web_response timed out"));
    }, this._timeoutMs);

    const entries = this._urlPending.get(url) ?? new Set();
    entries.add(entry);
    this._urlPending.set(url, entries);
    return { entry, promise };
  }

  _upgradePending(entry, tabId) {
    if (!entry || entry.settled) return;

    this._forgetUrlPending(entry);
    entry.tabId = tabId;
    this._tabPending.set(tabId, entry);
  }

  _drainPending(reason) {
    const error = new Error(reason);
    const entries = new Set();
    for (const group of this._urlPending.values()) {
      for (const entry of group) entries.add(entry);
    }
    for (const entry of this._tabPending.values()) entries.add(entry);
    for (const entry of entries) this._settlePending(entry, entry.reject, error);
  }

  async _closeTabQuietly(tabId) {
    if (typeof tabId !== "number") return;
    await this._cmd("tab_close", { tabid: [tabId] }).catch(() => { });
  }

  async fetch(url) {
    await this._containers.sweepRetiredContainers();

    const useContainer = this._proxyType !== "none" || this._useContainer;
    let containerId = null;
    let tabId = null;

    try {
      if (useContainer) {
        containerId = await this._containers.summonContainer();
      }

      const pending = this._registerPending(url);

      try {
        const tabResp = await this._cmd("tab_open", tabSpell(url, containerId));
        tabId = tabResp?.data?.id;
        if (typeof tabId !== "number") {
          throw new Error("lolcat-4play: tab_open did not return a valid tab id");
        }

        this._upgradePending(pending.entry, tabId);

        const { body } = await pending.promise;
        const text = Buffer.from(body, "base64").toString("utf-8");
        return wrapResponse(text);
      } finally {
        this._settlePending(
          pending.entry,
          pending.entry.reject,
          new Error("lolcat-4play: request ended before web_response arrived"),
        );
      }
    } finally {
      await this._closeTabQuietly(tabId);
      await this._containers.tuckContainerIn(containerId, useContainer);
    }
  }
}
