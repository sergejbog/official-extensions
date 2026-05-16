export const outgoingHosts = ["api.openverse.org"];
export const type = "images";

const API_URL = "https://api.openverse.org/v1/images/";
const PAGE_SIZE = 20;

const OV_SIZE_MAP = {
  small: "small",
  medium: "medium",
  large: "large",
};

const OV_ASPECT_MAP = {
  square: "square",
  tall: "tall",
  wide: "wide",
};

export default class OpenverseEngine {
  isClientExposed = false;
  name = "Openverse";
  bangShortcut = "openverse";

  executeSearch = async (query, page = 1, _timeFilter, context) => {
    const doFetch = context?.fetch ?? fetch;
    const imageFilter = context?.imageFilter ?? {};

    const params = new URLSearchParams({
      q: query,
      page: String(Math.max(1, page || 1)),
      page_size: String(PAGE_SIZE),
    });

    if (OV_SIZE_MAP[imageFilter.size]) {
      params.set("size", OV_SIZE_MAP[imageFilter.size]);
    }

    if (OV_ASPECT_MAP[imageFilter.layout]) {
      params.set("aspect_ratio", OV_ASPECT_MAP[imageFilter.layout]);
    }

    if (imageFilter.nsfw === "off") {
      params.set("mature", "true");
    }

    try {
      const response = await doFetch(`${API_URL}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "Accept-Language": context?.buildAcceptLanguage?.() ?? "en,en-US;q=0.9",
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const items = data?.results ?? [];

      return items
        .map((item) => ({
          title: item.title ?? "",
          url: item.foreign_landing_url ?? item.url ?? "",
          snippet: item.creator
            ? `By ${item.creator}${item.license ? ` — ${item.license}` : ""}`
            : (item.license ?? ""),
          source: this.name,
          thumbnail: item.thumbnail ?? item.url ?? "",
          imageUrl: item.url ?? item.thumbnail ?? "",
        }))
        .filter((r) => r.url && r.thumbnail);
    } catch {
      return [];
    }
  };
}
