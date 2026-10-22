# markminors.co.uk

Static rebuild of [Mark Minors: Director & Vision Mixer](https://www.markminors.co.uk/). It replaces the old Symfony "Broderick" CMS.

- **[Eleventy 3](https://www.11ty.dev/)** builds plain HTML and CSS with no front-end framework. Images are resized to WebP and JPEG at build time.
- **[Pages CMS](https://pagescms.org/)** is the admin. It edits the Markdown and JSON files in this repo and commits to `main`.
- **GitHub Actions** builds the site and deploys it to **GitHub Pages** on every push.
- The **contact form** posts to a small **Cloudflare Worker** (`worker/`). The Worker checks Cloudflare **Turnstile** and sends the message with **Resend**.

```
src/
  _data/site.json         homepage and site settings (hero, showreel, bio, contact, socials)
  _data/contact.json      form endpoint and Turnstile site key (not in the CMS)
  content/news/*.md       news posts   → /news/<filename>/
  content/reviews/*.md    film reviews → /reviews/<filename>/
  media/uploads/          images (CMS uploads go here, served at /media/uploads/)
  _includes/              Nunjucks layouts and partials
  assets/                 CSS and JS
worker/                   contact-form Cloudflare Worker and its tests
.pages.yml                Pages CMS configuration
```

## Local development

```sh
npm install
npm start          # http://localhost:8080. Drafts are shown and labelled
npm run build      # production build into _site/. Drafts are left out
```

Content migrated from the old database keeps its old URLs (`/news/kit-for-hire`, etc.). GitHub Pages adds the trailing slash itself.

Drafts: any post with `draft: true` is built locally but never published. All the old film reviews came across as drafts, because the old Reviews section was switched off. In the CMS, untick **Draft** on a review to publish it. The **Film reviews** menu link only appears when at least one review is published and *Homepage & site settings → Sections → Film reviews → Show in menu* is ticked.

## One-time setup

### 1. GitHub Pages

1. Go to the repo's **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
2. Push to `main`, or run the workflow by hand. The site appears at `https://philrennie.github.io/mmstatic/`. The build adds the `/mmstatic` prefix automatically.
3. When you're ready to switch the domain:
   1. Go to **Settings → Pages → Custom domain**, enter `www.markminors.co.uk` and tick **Enforce HTTPS**.
   2. At the DNS host, point `www` at GitHub with `CNAME www → philrennie.github.io`.
   3. Point the apex `markminors.co.uk` at GitHub with `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`. Optionally add `AAAA` records too: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153` and `2606:50c0:8003::153`.
   4. Verify the domain under your GitHub account's **Settings → Pages**. This stops anyone else claiming it.
   5. Re-run the workflow so the prefix drops away.
   6. Don't touch the MX records. Email for `markminors.co.uk` isn't affected.

### 2. Pages CMS

1. Sign in at <https://app.pagescms.org> with GitHub and install the Pages CMS GitHub App on `philrennie/mmstatic`.
2. Open the repo. You'll see **News**, **Film reviews** and **Homepage & site settings**.
3. To give Mark access, either add him as a collaborator on the repo (he'll need a GitHub account), or invite him by email from Pages CMS's **Collaborators** screen (no GitHub account needed).

Each save is a commit, and the site rebuilds in about a minute.

Notes for editors:
- **Video link**: paste a YouTube or Vimeo page link. The site embeds it with the privacy-friendly players (`youtube-nocookie`, Vimeo `dnt=1`), so no cookie banner is needed.
- **Pin to top** (News): keeps a post first on the News page and in the homepage "Latest posts". *Kit for hire!* uses it. On the old site this was done by giving it a 2030 date.
- New posts get their URL from the title when first created. Renaming a post later doesn't change its URL.

### 3. Contact form (Cloudflare Worker + Turnstile + Resend)

Everything here fits in the free tiers.

**a. Turnstile** (Cloudflare dashboard → Turnstile → Add widget)
- Hostnames: `www.markminors.co.uk`, `markminors.co.uk`, `philrennie.github.io`
- Widget mode: **Managed**
- Copy the **site key** into `src/_data/contact.json` → `turnstileSiteKey`. The site key is public.
- Keep the **secret key** for step c.

**b. Resend** (<https://resend.com>)
- Add the domain `markminors.co.uk` and add the DNS records (SPF/DKIM) it asks for. These sit alongside the existing mail setup, so nothing about Mark's inbox changes.
- Create an API key with the **Sending access** permission only.

**c. Deploy the Worker**
```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put TURNSTILE_SECRET   # from step a
npx wrangler secret put RESEND_API_KEY     # from step b
npx wrangler secret put TO_EMAIL           # mark@markminors.co.uk
npm run deploy
```
Copy the URL it prints (e.g. `https://markminors-contact.<you>.workers.dev`) into `src/_data/contact.json` → `endpoint`, then commit.

Optionally, route the Worker on a subdomain such as `forms.markminors.co.uk` instead of `workers.dev`. That needs the zone on Cloudflare. Not required.

**How spam and abuse are handled** (all checks run on the server, in `worker/src/index.js`):

| Layer | What it stops |
|---|---|
| Origin allow-list (`ALLOWED_ORIGINS`) and CORS | Other sites posting to the endpoint |
| Per-IP rate limit, 3 per minute | Floods |
| 32 KB body cap, length checks on each field | Oversized payloads |
| Honeypot field `website` | Naive form-filling bots. They get a fake "success" |
| Minimum fill time of 3 s | Scripted instant submits. These also get a fake "success" |
| Turnstile token verified with Cloudflare, including hostname and action | Headless or automated submissions |
| Over 5 links in the message | Link spam. Silently dropped |
| Newlines stripped from name and subject, plain-text email only, visitor address only ever in `reply_to` | Header and HTML injection |
| Recipient address and API keys stored as Worker secrets | Harvesting the address, or reusing the endpoint as an open relay |

The form works without JavaScript too: the Worker answers with a redirect to `/contact/thanks/` or `/contact/error/`. Turnstile needs JavaScript, though, so no-JS posts land on the error page, which shows the email address instead.

Tests: `cd worker && npm test` runs 14 unit tests with `node --test`. CI runs them on every push.

**Alternative if you'd rather not run a Worker:** point `contact.json → endpoint` at a hosted form service, such as [Web3Forms](https://web3forms.com) with its hCaptcha option, or Formspree. You'd need to adjust `assets/js/contact.js` to match that service's field names and response. The Worker is preferred because the recipient stays secret and the spam checks are under your control.

## Migration notes

- The content was exported from `mmnew-full-20261022.sql.gz` (the old Symfony/Doctrine `page`, `newsitem`, `reviewitem` and `site` tables).
- Embedded YouTube and Vimeo iframes were pulled out of post bodies into the **Video link** field.
- The old `/media/cache/*` thumbnails are gone. Eleventy Image makes the responsive sizes at build time.
- The cookie banner and Google Analytics (Universal Analytics, which stopped working in 2023) have been dropped. The site sets no cookies.
