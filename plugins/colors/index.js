/**
 * @fccview here!
 * This is something I toyed with years ago when i first saw the "coolors" website.
 * I recently resurfaced and cloned my old codepen: https://codepen.io/riofriz/pen/PwzEYqX and
 * decided to bring it into degoog for the fun of it.
 * 
 * Hope you like my take on the tool!
 */

let template = "";

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _encodeSeeds = (args) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((t) => encodeURIComponent(t)).join("|");
};

export default {
  isClientExposed: false,
  name: "Colors",
  description: "Generate a five-color palette. Space to shuffle, click to lock.",
  trigger: "colors",
  aliases: ["coolors", "palette", "colour", "colours"],
  naturalLanguagePhrases: [
    "color palette",
    "colour palette",
    "generate colors",
    "random palette",
    "coolors",
  ],

  settingsSchema: [],

  init(ctx) {
    template = ctx.template;
  },

  execute(args) {
    const seeds = _encodeSeeds(args);
    const html = template.replace("{{seeds}}", _esc(seeds));
    return {
      title: "Colors",
      html,
    };
  },
};
