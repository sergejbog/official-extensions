const FALLBACK_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export default class RedditEngine {
  isClientExposed = false;
  name = "Reddit";
  bangShortcut = "r";
  includeNsfw = "false";
  sortBy = "hot";

  settingsSchema = [
    {
      key: "includeNsfw",
      label: "Include NSFW",
      type: "toggle",
      description: "Show NSFW posts in search results.",
    },
    {
      key: "sortBy",
      label: "Sort By",
      type: "select",
      options: ["hot", "relevance", "new", "top"],
      description: "How to sort Reddit search results.",
      default: "hot",
    },
  ];

  configure(settings) {
    if (typeof settings.includeNsfw === "string") this.includeNsfw = settings.includeNsfw;
    if (typeof settings.sortBy === "string") this.sortBy = settings.sortBy;
  }

  _mapTime(t) {
    if (!t || t === "any") return "all";
    return t;
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    const limit = 25;
    const params = new URLSearchParams({
      q: query, type: "link", sort: this.sortBy,
      t: this._mapTime(timeFilter), limit: String(limit),
      include_over_18: this.includeNsfw === "true" ? "1" : "0",
    });
    if (page > 1) params.set("count", String((page - 1) * limit));

    const url = `https://www.reddit.com/search.json?${params.toString()}`;
    const doFetch = context?.fetch ?? fetch;
    const response = await doFetch(url, {
      headers: {
        "User-Agent": context?.userAgent?.() ?? FALLBACK_UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": context?.buildAcceptLanguage?.() || "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    context?.sentinel?.(response, this.name);
    const data = await response.json();
    const results = [];
    for (const child of data?.data?.children ?? []) {
      const post = child.data;
      if (!post?.title) continue;
      const snippet = post.selftext ? post.selftext.substring(0, 200) : post.subreddit_name_prefixed;
      results.push({
        title: post.title,
        url: `https://www.reddit.com${post.permalink}`,
        snippet, source: this.name,
      });
    }
    return results;
  }
}
