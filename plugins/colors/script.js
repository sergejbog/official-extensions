(function () {
  const OFFSETS = [0, 180, 30, 150, 210];
  const STYLES = {
    all: { sMin: 10, sMax: 100, lMin: 20, lMax: 90 },
    vibrant: { sMin: 70, sMax: 100, lMin: 45, lMax: 60 },
    pastel: { sMin: 20, sMax: 50, lMin: 75, lMax: 90 },
    dark: { sMin: 10, sMax: 30, lMin: 15, lMax: 30 },
    neon: { sMin: 90, sMax: 100, lMin: 50, lMax: 60 },
  };

  const getRandom = (min, max) => Math.floor(Math.random() * (max - min)) + min;

  const getContrastColor = (r, g, b) => {
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness >= 128 ? "#000000" : "#ffffff";
  };

  const getColors = (h, s, l) => {
    const sPct = s / 100;
    const lPct = l / 100;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = sPct * Math.min(lPct, 1 - lPct);
      return lPct - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const r = Math.round(f(0) * 255);
    const g = Math.round(f(8) * 255);
    const b = Math.round(f(4) * 255);
    const hex =
      "#" +
      [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
    const textColor = getContrastColor(r, g, b);
    return {
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
      hex,
      text: textColor,
    };
  };

  const rgbToHsl = (r, g, b) => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rn:
          h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
          break;
        case gn:
          h = ((bn - rn) / d + 2) / 6;
          break;
        default:
          h = ((rn - gn) / d + 4) / 6;
      }
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  };

  const parseSeedColor = (input) => {
    const t = String(input || "").trim();
    if (!t) return null;
    const probe = document.createElement("span");
    probe.style.color = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t)
      ? t.startsWith("#")
        ? t
        : `#${t}`
      : t;
    document.documentElement.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const hsl = rgbToHsl(r, g, b);
    return { r, g, b, h: hsl.h, s: hsl.s, l: hsl.l };
  };

  const defaultState = () => ({
    style: "vibrant",
    boxes: Array.from({ length: 5 }, () => ({
      h: 0,
      s: 50,
      l: 50,
      locked: false,
      fixed: false,
    })),
  });

  const setBoxHexLabel = (boxEl, hex, textColor) => {
    const hexBtn = boxEl.querySelector(".colors-hex");
    if (!hexBtn) return;
    hexBtn.textContent = hex;
    hexBtn.style.color = textColor;
    hexBtn.dataset.hex = hex;
  };

  const setBoxColor = (boxEl, h, s, l) => {
    const colorObj = getColors(h, s, l);
    boxEl.style.backgroundColor = colorObj.hsl;
    boxEl.setAttribute("data-h", String(h));
    setBoxHexLabel(boxEl, colorObj.hex, colorObj.text);
  };

  const setBoxFromSeed = (boxEl, color) => {
    boxEl.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    boxEl.setAttribute("data-h", String(color.h));
    const hex =
      "#" +
      [color.r, color.g, color.b]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    setBoxHexLabel(boxEl, hex, getContrastColor(color.r, color.g, color.b));
  };

  const renderState = (root, state) => {
    const styleSelect = root.querySelector(".colors-style");
    if (styleSelect) styleSelect.value = state.style;
    const boxes = root.querySelectorAll(".box");
    boxes.forEach((boxEl, index) => {
      const box = state.boxes[index];
      if (box.fixed && box.r != null) {
        setBoxFromSeed(boxEl, box);
      } else {
        setBoxColor(boxEl, box.h, box.s, box.l);
      }
      boxEl.classList.toggle("locked", box.locked);
    });
  };

  const applySeeds = (state, seedsRaw) => {
    if (!seedsRaw) return 0;
    const tokens = seedsRaw
      .split("|")
      .map((t) => decodeURIComponent(t))
      .filter(Boolean);
    let count = 0;
    tokens.forEach((token, index) => {
      if (index >= 5) return;
      const parsed = parseSeedColor(token);
      if (!parsed) return;
      state.boxes[index] = {
        h: parsed.h,
        s: parsed.s,
        l: parsed.l,
        r: parsed.r,
        g: parsed.g,
        b: parsed.b,
        locked: false,
        fixed: true,
      };
      count += 1;
    });
    return count;
  };

  const randomize = (root, state, fixedCount) => {
    const boxes = root.querySelectorAll(".box");
    const styleSelect = root.querySelector(".colors-style");
    const selectedStyle = (styleSelect && styleSelect.value) || state.style || "vibrant";
    state.style = selectedStyle;
    const config = STYLES[selectedStyle] || STYLES.vibrant;
    const baseHue = getRandom(0, 360);
    boxes.forEach((boxEl, index) => {
      const box = state.boxes[index];
      if (box.locked) return;
      if (fixedCount > 0 && index < fixedCount && box.fixed) return;
      const h = (baseHue + OFFSETS[index] + 360) % 360;
      const s = getRandom(config.sMin, config.sMax);
      const l = getRandom(config.lMin, config.lMax);
      box.h = h;
      box.s = s;
      box.l = l;
      box.fixed = false;
      box.r = undefined;
      box.g = undefined;
      box.b = undefined;
      setBoxColor(boxEl, h, s, l);
    });
  };

  const mount = (root) => {
    if (root.dataset.colorsMounted === "1") return;
    root.dataset.colorsMounted = "1";
    const state = defaultState();
    const fixedCount = applySeeds(state, root.getAttribute("data-seeds") || "");
    renderState(root, state);
    randomize(root, state, fixedCount);
    const styleSelect = root.querySelector(".colors-style");
    if (styleSelect) {
      styleSelect.addEventListener("change", () => {
        state.style = styleSelect.value;
        randomize(root, state, 0);
      });
    }
    const isInteractiveTarget = (target) => {
      if (!target || !(target instanceof Element)) return false;
      if (target.closest(".colors-hex")) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const copyHex = async (hexBtn) => {
      const hex = hexBtn.dataset.hex || hexBtn.textContent || "";
      if (!hex) return;
      try {
        await navigator.clipboard.writeText(hex);
        hexBtn.classList.add("colors-hex--copied");
        const prev = hexBtn.getAttribute("aria-label");
        hexBtn.setAttribute("aria-label", "Copied");
        window.setTimeout(() => {
          hexBtn.classList.remove("colors-hex--copied");
          if (prev) hexBtn.setAttribute("aria-label", prev);
        }, 1200);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(hexBtn);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("copy");
          sel.removeAllRanges();
        }
      }
    };

    root.querySelectorAll(".box").forEach((boxEl, index) => {
      boxEl.addEventListener("click", (e) => {
        if (isInteractiveTarget(e.target)) return;
        state.boxes[index].locked = !state.boxes[index].locked;
        boxEl.classList.toggle("locked", state.boxes[index].locked);
      });
      const hexBtn = boxEl.querySelector(".colors-hex");
      if (hexBtn) {
        hexBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void copyHex(hexBtn);
        });
      }
    });

    const onKeydown = (e) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (!document.contains(root)) {
        document.removeEventListener("keydown", onKeydown, true);
        document.removeEventListener("keyup", onKeyup, true);
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
    };

    const onKeyup = (e) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (!document.contains(root)) {
        document.removeEventListener("keydown", onKeydown, true);
        document.removeEventListener("keyup", onKeyup, true);
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      randomize(root, state, 0);
    };

    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("keyup", onKeyup, true);
  };

  const scan = () => {
    document.querySelectorAll(".colors-command:not([data-colors-mounted])").forEach(mount);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
