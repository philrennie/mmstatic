import { HtmlBasePlugin } from "@11ty/eleventy";
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";

const isProduction = process.env.ELEVENTY_RUN_MODE === "build";

/** Turn a YouTube or Vimeo page URL into a privacy-friendly embed URL. */
function embedUrl(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/(\w+))?/);
  if (m) return `https://player.vimeo.com/video/${m[1]}?dnt=1${m[2] ? `&h=${m[2]}` : ""}`;
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—", pound: "£", eacute: "é" };
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m
  );

const byDateDesc = (a, b) => b.date - a.date;
const pinnedFirst = (a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || byDateDesc(a, b);

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/media": "media" });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico", "src/apple-touch-icon.png": "apple-touch-icon.png" });
  eleventyConfig.addPassthroughCopy({
    "node_modules/@fontsource/jost/files/jost-latin-{400,700}-normal.woff2": "assets/fonts",
  });

  // Lets the site work under a sub-path (e.g. philrennie.github.io/mmstatic/) before the domain moves
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // Responsive, compressed images for every <img> in the output
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    formats: ["webp", "jpeg"],
    widths: [480, 960, 1600, "auto"],
    htmlOptions: {
      imgAttributes: { loading: "lazy", decoding: "async" },
      pictureAttributes: {},
    },
    failOnError: false,
  });

  // Drafts: visible (and labelled) when running locally, never published
  eleventyConfig.addPreprocessor("drafts", "*", (data) => {
    if (data.draft && isProduction) return false;
  });

  const published = (api, glob) => api.getFilteredByGlob(glob).filter((p) => !(isProduction && p.data.draft));
  eleventyConfig.addCollection("news", (api) => published(api, "src/content/news/*.md").sort(pinnedFirst));
  eleventyConfig.addCollection("reviews", (api) => published(api, "src/content/reviews/*.md").sort(byDateDesc));
  eleventyConfig.addCollection("latest", (api) =>
    [...published(api, "src/content/news/*.md"), ...published(api, "src/content/reviews/*.md")].sort(pinnedFirst)
  );

  eleventyConfig.addFilter("embedUrl", embedUrl);
  eleventyConfig.addFilter("readableDate", (d) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  );
  // "28th November 2024", as on the old site
  eleventyConfig.addFilter("longDate", (d) => {
    const date = new Date(d);
    const n = date.getUTCDate();
    const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    return `${n}${suffix} ${date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  });
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("excerpt", (html = "", length = 200) => {
    let text = String(html)
      .replace(/<\/(p|li|h\d|div|figure)>|<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "");
    text = decodeEntities(text).replace(/\s+/g, " ").trim();
    if (text.length <= length) return text;
    return text.slice(0, text.lastIndexOf(" ", length)) + "…";
  });
  eleventyConfig.addFilter("stars", (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : ""));
  eleventyConfig.addFilter("nl2br", (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"));
  eleventyConfig.addFilter("absoluteUrl", (path, base) => new URL(path, base).href);

  eleventyConfig.addFilter("head", (arr = [], n) => arr.slice(0, n));
  eleventyConfig.addFilter("without", (arr = [], url) => arr.filter((p) => p.url !== url));

  // Previous / next within a collection
  eleventyConfig.addFilter("neighbours", (collection, url) => {
    const i = collection.findIndex((p) => p.url === url);
    return { newer: collection[i - 1], older: collection[i + 1] };
  });

  eleventyConfig.addGlobalData("isProduction", isProduction);
  eleventyConfig.addGlobalData("buildYear", new Date().getFullYear());

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    pathPrefix: process.env.PATH_PREFIX || "/",
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
