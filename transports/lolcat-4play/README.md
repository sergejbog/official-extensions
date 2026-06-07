# Credits

All credit to lolcat, creator of [4get](https://git.lolcat.ca/lolcat) and [4play](https://git.lolcat.ca/lolcat/4play). This transport speaks the official 4play protocol so the unmodified Firefox extension can connect directly to degoog.

If you want the version with curl-impersonate cookie harvesting, use the **degoog-fplay** transport instead.

# 4play (lolcat) - degoog transport

Routes searches through a real Firefox session using the official [4play](https://git.lolcat.ca/lolcat/4play) Firefox extension. Degoog runs the WebSocket server itself, you only need to install the extension and point it at degoog. No separate server required.

## How it works

1. The official 4play Firefox extension connects to degoog's WebSocket endpoint on the main port.
2. For each engine request, degoog opens a tab in the connected Firefox, waits for full DOM load, extracts the rendered HTML, and closes the tab.

## Requirements

- Firefox with the 4play extension installed.
- **Firefox only** - the extension uses `browser.contextualIdentities` and `browser.scripting`, which are not available in Chrome builds.

## 1. Install the Firefox extension

Install the extension on a **clean Firefox profile** - not your main one, as it manages tabs and containers globally.

Clone the repository:

```bash
git clone https://git.lolcat.ca/lolcat/4play.git
```

- Open `about:debugging` -> This Firefox -> **Load Temporary Add-on** -> select `manifest.json` from `4play/extension/`.
- Click the extension icon in the toolbar.
- Find the exact WebSocket URL in **Settings -> Transports -> 4play (lolcat) -> Configure** — it is shown at the top of the settings panel. If you set a password, append it as a path segment. The WebSocket runs on degoog's main port — no separate port needed.
- The badge turns green when connected.

## 2. Configure in degoog

Settings -> Transports -> 4play (lolcat) -> Configure:

### Connection

- **Password** - appended as a path segment to the WebSocket URL shown above. Must match what you entered in the extension popup. Leave blank for no authentication.
- **Page load timeout** - how long to wait for a tab to load before giving up (default 30000 ms).
### Container isolation

- **Container isolation** - open each request in a fresh Firefox container, deleted after the tab closes. Enabled automatically when a proxy is configured.

### Proxy (optional)

- **Proxy type** - `none` (default), `socks5`, `socks4`, `http`, or `https`. Enabling any proxy type turns on container isolation automatically.
- **Proxy host** / **Proxy port** - proxy server address.
- **Proxy username** / **Proxy password** - optional credentials.
- **Proxy DNS** - route DNS through the proxy (recommended for SOCKS to avoid leaks).

Then, in Settings -> Engines -> Configure -> Advanced, pick `lolcat-4play` as the outgoing transport. Point the extension at the WebSocket URL shown in the transport settings, substituting your Docker host IP for the hostname.

## Behaviour and limits

- **Firefox only** - use degoog-fplay for Chrome/Edge/Brave support.
- **One browser connection** - a single Firefox instance connects. Parallel engine queries each open their own tab concurrently.
- **Tabs are visible** - tabs flicker in the connected Firefox window as requests come in.
- **Session state is native** - cookies persist across tabs within the same profile. Container isolation keeps parallel requests separated.
- **Clean profile recommended** - dedicated Firefox profile, no personal data, no interfering extensions.

## Privacy and trust

- The Firefox instance contacts external sites directly for every search request.
- The WebSocket between degoog and the extension is unencrypted (`ws://`). On a LAN, set a password and treat the port accordingly.
