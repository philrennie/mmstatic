// Directory data for every file in src/content/news (not edited via the CMS)
export default {
  layout: "post.njk",
  section: "news",
  permalink: (data) => `/news/${data.page.fileSlug}/`,
};
