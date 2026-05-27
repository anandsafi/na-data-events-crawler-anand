# The Data Dispatch — PWA

Installable daily briefing for top Data & AI events in Ottawa, Toronto, Montréal, and Tier-1 USA + Canada conferences. No backend.

## Files

- `index.html` — the briefing UI (renders from `events.json`)
- `events.json` — the data; edit/replace this to update the briefing
- `manifest.webmanifest` — PWA manifest (name, icons, theme)
- `sw.js` — service worker (offline cache + daily background check + local notifications)
- `icon-192.png` / `icon-512.png` / `icon-maskable.png`

## Deploy (pick one)

PWAs require HTTPS. Easiest options:

**Cloudflare Pages** (free, fastest)
```
npx wrangler pages deploy ./data-dispatch-pwa --project-name data-dispatch
```

**Vercel** (drop the folder in)
```
vercel ./data-dispatch-pwa
```

**Netlify drop**
Drag the folder onto https://app.netlify.com/drop

**GitHub Pages**
Push the folder to a repo, enable Pages on the branch.

## Install on phone

- **iOS Safari**: open the URL → Share → *Add to Home Screen*. Then open from the icon (not from Safari) so the service worker stays alive.
- **Android Chrome**: open the URL → install prompt appears automatically, or use menu → *Install app*.

After installing, tap **Enable notifications** in the panel at the bottom.

## How the daily check works

- **Android / Chromium**: the service worker registers a `periodicsync` job that fires roughly every 24h. It fetches `events.json`, compares IDs against a `seen` set stored in the cache, and shows a local notification if there are new entries.
- **iOS (Safari PWA)**: there is no Periodic Background Sync. Instead, the on-open check runs each time you launch the installed app. New events fire a notification immediately.
- **Desktop Chrome/Edge/Firefox**: same as Android — periodic sync works once the page is installed.

No data leaves the device. No tracking, no server.

## Updating events.json

Two paths:

### Manual (no setup)
1. Edit `events.json` (or ask Claude to regenerate it from current searches)
2. Redeploy (or re-upload to your host)

### Automatic daily refresh — with Google crawl
A GitHub Action in `.github/workflows/refresh-events.yml` runs daily at 07:00 ET:

**1. Curated feed pull (free, always runs):**
- AI Tinkerers Ottawa + Toronto chapter pages
- Mila events page
- Vector Institute RSS feed

**2. Google crawl (via search API):**
- Across a query matrix of `{Ottawa, Toronto, Montréal} × {data engineering, AI summit, ML meetup, analytics, …}` plus bare conference queries
- 3 pages per query by default (≈30 results each), 5 pages on manual deep-crawl runs
- `tbs=qdr:m` filter — only results from the last month, so we're seeing genuinely fresh content
- Supports SerpAPI (`SERPAPI_KEY`) or Brave Search API (`BRAVE_KEY`) — falls back gracefully if neither is set

**3. Filter pipeline:**
- **Domain blocklist**: `conferencealerts.in`, `allconferencealert.com`, `conferenceindex.org`, `10times.com`, and other SEO-spam aggregators are dropped at ingestion
- **Title stopwords**: rejects listicles ("Top 10 AI Conferences", "Upcoming events in...", "Guide to...")
- **Date required** unless on `DOMAIN_ALLOWLIST` (Snowflake, Databricks, Mila, dbt, AWS, etc.)
- **Past events dropped**

**4. Multi-layer dedupe against everything already in `events.json`:**
- URL canonicalization (`www.` stripped, query stripped, trailing slash, lowercase)
- Title fuzzy match: substring containment + 75% token overlap, scoped per-city so the same event name in different cities doesn't collide
- ID generation from city + slugified-name + start-date

**5. Outputs:**
- `events.json` with net-new entries appended, `discovered_at = now()`
- `discovery-report.md` showing every accepted entry, every rejected candidate, and the reason — committed alongside the JSON so you can audit and tune the blocklist
- Discovery report also uploaded as a GitHub Actions artifact (30-day retention)

**Manual deep crawl:**
- Actions tab → "Refresh events.json" → "Run workflow" → toggle `deep_crawl: true` → runs at 5 pages per query (~75 search-API calls)

**Cost discipline:**
- Default daily run: ~45 search-API calls. Monthly: ~1,350. SerpAPI Developer plan ($75/mo, 5k searches) or Brave Search free tier (2k/mo) both fit.

**To enable:**
1. Push the folder to a GitHub repo
2. Settings → Secrets → add `SERPAPI_KEY` *or* `BRAVE_KEY`
3. Enable Actions
4. Connect the repo to Cloudflare Pages / Vercel / Netlify for auto-deploy on push

Each event entry:
```json
{
  "id": "unique-string",
  "city": "Toronto",                    // or omit for conferences
  "category": "city" | "conference",
  "name": "Event name",
  "when": "Human-readable date string",
  "starts": "2026-06-01",               // optional ISO date
  "where": "Venue",
  "url": "https://...",
  "blurb": "Why it matters in one sentence.",
  "flags": ["happening-now"]            // optional: happening-now, this-week, next-week, flagship
}
```

The `id` is the dedup key. New IDs trigger the "NEW" badge and a notification.

## How dedupe works

Two layers:

1. **In the Action (server side)**: candidate events are matched against existing `events.json` by both `id` (slug of city + name + start date) and exact URL. Past events (where `starts` is before today) are dropped. Only net-new entries are appended.

2. **In the PWA (client side)**: the service worker tracks both a `seen-ids` set and a `seen-watermark` (the highest `discovered_at` it has ever observed). On each sync it flags entries where either the id is unknown OR the `discovered_at` exceeds the watermark. This means re-deployments don't re-notify on entries you've already seen, but legitimately new entries added by the daily Action always trigger a notification.
