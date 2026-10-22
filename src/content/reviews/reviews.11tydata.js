// Directory data for every file in src/content/reviews (not edited via the CMS)
export default {
  layout: "post.njk",
  section: "reviews",
  permalink: (data) => `/reviews/${data.page.fileSlug}/`,
};
