export const type = "images";
export const description = "Requires the [4play transport](https://github.com/degoog-org/official-extensions/tree/main/transports/degoog-fplay). Install it from the Store tab, then add the [browser extension](https://github.com/degoog-org/4play).";

const OPERA_MINI_VARIANTS = [
  { version: "6.1", presto: "2.8.119", release: "11.10", platforms: ["J2ME/MIDP"] },
  { version: "7.0", presto: "2.8.119", release: "11.10", platforms: ["J2ME/MIDP"] },
  { version: "7.1", presto: "2.8.119", release: "11.10", platforms: ["J2ME/MIDP"] },
  { version: "4.2", presto: "2.5.25", release: "10.54", platforms: ["S60"] },
];

const _pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const _randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const _gsaAgent = () => {
  const v = _pick(OPERA_MINI_VARIANTS);
  const platform = _pick(v.platforms);
  const build = _randInt(10000, 49999);
  const subMajor = _randInt(20, 49);
  const subMinor = _randInt(100, 3999);
  return `Opera/9.80 (${platform}; Opera Mini/${v.version}.${build}/${subMajor}.${subMinor}; U; en) Presto/${v.presto} Version/${v.release}`;
};

const TBS_MAP = { hour: "qdr:h", day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

const _resolveTbs = (timeFilter) => {
  if (!timeFilter || timeFilter === "any" || timeFilter === "custom") return null;
  return TBS_MAP[timeFilter] ?? null;
};

const _resolveCustomTbs = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return null;
  const parts = ["cdr:1"];
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) parts.push(`cd_min:${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) parts.push(`cd_max:${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
  }
  return parts.length > 1 ? parts.join(",") : null;
};

const GOOGLE_SIZE_MAP = {
  small: "imgsz:small",
  medium: "imgsz:medium",
  large: "imgsz:large",
  wallpaper: "imgsz:xlarge",
};

const GOOGLE_COLOR_MAP = {
  monochrome: "ic:gray",
  red: "ic:specific,isc:red",
  orange: "ic:specific,isc:orange",
  yellow: "ic:specific,isc:yellow",
  green: "ic:specific,isc:green",
  teal: "ic:specific,isc:teal",
  blue: "ic:specific,isc:blue",
  purple: "ic:specific,isc:purple",
  pink: "ic:specific,isc:pink",
  white: "ic:specific,isc:white",
  gray: "ic:specific,isc:gray",
  brown: "ic:specific,isc:brown",
  black: "ic:specific,isc:black",
};

const GOOGLE_TYPE_MAP = {
  photo: "itp:photo",
  clipart: "itp:clipart",
  lineart: "itp:lineart",
  animated: "itp:animated",
};

const GOOGLE_LAYOUT_MAP = {
  square: "iar:s",
  wide: "iar:w",
  tall: "iar:t",
};

const _buildImgTbs = (imgFilter) => {
  const parts = [];
  if (imgFilter?.size && imgFilter.size !== "any" && GOOGLE_SIZE_MAP[imgFilter.size]) parts.push(GOOGLE_SIZE_MAP[imgFilter.size]);
  if (imgFilter?.color && imgFilter.color !== "any" && GOOGLE_COLOR_MAP[imgFilter.color]) parts.push(GOOGLE_COLOR_MAP[imgFilter.color]);
  if (imgFilter?.type && imgFilter.type !== "any" && GOOGLE_TYPE_MAP[imgFilter.type]) parts.push(GOOGLE_TYPE_MAP[imgFilter.type]);
  if (imgFilter?.layout && imgFilter.layout !== "any" && GOOGLE_LAYOUT_MAP[imgFilter.layout]) parts.push(GOOGLE_LAYOUT_MAP[imgFilter.layout]);
  return parts.join(",");
};

export default class GoogleImagesEngine {
  isClientExposed = false;
  name = "Google Images";
  safeSearch = "off";
  settingsSchema = [
    {
      key: "outgoingTransport",
      label: "Outgoing HTTP client transport",
      type: "select",
      options: ["fetch", "curl", "curl-fallback"],
      default: "fplay",
      advanced: true,
    },
    {
      key: "safeSearch",
      label: "Safe Search",
      type: "select",
      options: ["off", "on"],
      description: "Filter explicit content from image results.",
    },
  ];

  configure(settings) {
    if (typeof settings.safeSearch === "string") this.safeSearch = settings.safeSearch;
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    const ijn = page - 1;
    const params = new URLSearchParams({
      q: query,
      tbm: "isch",
      asearch: "isch",
      async: `_fmt:json,p:1,ijn:${ijn}`,
    });

    const timeTbs = timeFilter === "custom"
      ? _resolveCustomTbs(context?.dateFrom, context?.dateTo)
      : _resolveTbs(timeFilter);
    const imgTbs = _buildImgTbs(context?.imageFilter);
    const tbs = [timeTbs, imgTbs].filter(Boolean).join(",");
    if (tbs) params.set("tbs", tbs);
    if (context?.lang) params.set("hl", context.lang);

    const nsfwOverride = context?.imageFilter?.nsfw;
    if (nsfwOverride === "on") params.set("safe", "active");
    else if (nsfwOverride === "off") params.delete("safe");
    else if (this.safeSearch === "on") params.set("safe", "active");

    const doFetch = context?.fetch ?? fetch;
    const response = await doFetch(`https://www.google.com/search?${params.toString()}`, {
      headers: {
        "User-Agent": _gsaAgent(),
        Accept: "*/*",
        "Accept-Language": context?.buildAcceptLanguage?.() || "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+",
      },
    });

    context?.sentinel?.(response, this.name);
    const text = await response.text();
    const jsonStart = text.indexOf('{"ischj":');
    if (jsonStart < 0) return [];

    const data = JSON.parse(text.substring(jsonStart));
    const metadata = data.ischj?.metadata || [];
    const results = [];

    for (const item of metadata) {
      const title = item.result?.page_title?.replace(/<[^>]+>/g, "") || "";
      const url = item.result?.referrer_url || "";
      const thumbnail = item.thumbnail?.url || "";
      if (title && url) {
        results.push({
          title,
          url,
          snippet: item.result?.site_title || "",
          source: this.name,
          thumbnail,
          imageUrl: item.original_image?.url || thumbnail,
        });
      }
    }

    return results;
  }
}
