# YouTube Data API v3 — Quota Extension Request

**Application name:** TubLyTI
**Project type:** Internal analytics tool for YouTube content strategy
**Current quota:** 10,000 units/day
**Requested quota:** 50,000 units/day

## What TubLyTI does

TubLyTI is an internal content-strategy tool that helps YouTube creators identify under-served topics before they become saturated. It collects publicly available video metadata (titles, view counts, like counts, publish dates, comment threads) across ~1,500 channels per niche (currently 3 niches: personal finance, psychology, and AI tools) to compute a "Market Gap Index" — the ratio between audience demand (measured via Google Trends, Hacker News, Stack Exchange, and view velocity) and qualified supply (recent long-form videos from established channels).

## How we use the YouTube Data API

| Endpoint | Purpose | Daily cost (estimated) |
|---|---|---|
| `playlistItems.list` | Fetch recent uploads per channel (RSS fallback first; API only for channels with hidden RSS or >100 videos/month) | ~2,000 units |
| `videos.list` | Get view/like/comment counts and duration for videos discovered via RSS or playlist | ~3,500 units |
| `commentThreads.list` | Collect top-level comments on high-opportunity videos to detect viewer frustrations | ~2,000 units |
| `search.list` | Discover new channels for candidate evaluation (max 30 searches/week) | ~500 units/day avg |
| `channels.list` | Fetch channel details for newly discovered candidates | ~200 units |
| `channelSections.list` | Find channels recommended by already-followed channels | ~50 units |
| `videos.list (mostPopular)` | Scan trending videos in relevant categories | ~3 units |

**Total estimated daily usage:** ~8,300 units

## Why we need more quota

We are approaching the 10,000 unit ceiling as we scale to 1,500 channels per niche (~5,000 total). Our growth plan:

1. **More channels:** Each new niche adds ~1,500 channels to track. We plan to expand from 3 to 6 niches within 6 months.
2. **Better snapshots:** Daily view-count snapshots require `videos.list` calls. With 5,000 channels averaging 5 active videos each, that's 25,000 videos needing periodic snapshots.
3. **Comment analysis:** Our frustration detection system relies on `commentThreads.list`. We currently limit to 2,000 units/day for comments, but better coverage would improve our scoring accuracy.

With 50,000 units/day we can comfortably serve 6 niches with proper snapshot cadence and comment collection.

## Quota-conservation measures already in place

- **RSS-first video detection:** We check YouTube RSS feeds (zero quota) before falling back to `playlistItems.list`.
- **Tiered snapshots:** Videos >90 days old get weekly snapshots instead of daily, reducing `videos.list` calls by ~60%.
- **Weekly aggregation:** Old daily snapshots are compressed into `video_stats_weekly` rows.
- **Budget enforcement:** A `quota_plan` system allocates a fixed budget per task category (tracking, discovery, comments, reserve) to prevent any single pipeline step from consuming the entire quota.
- **Soft limit with early stop:** All pipeline steps check remaining quota before each API call and stop gracefully when approaching the daily limit.
- **No search.list in loops:** Channel updates use `playlistItems.list` (1 unit) instead of `search.list` (100 units).
- **Batch processing:** `videos.list` and `channels.list` calls batch up to 50 IDs per request.

## Compliance

- We only collect publicly available data through the official YouTube Data API.
- API keys are server-side only (never exposed to clients).
- We do not scrape or circumvent API limits.
- We comply with YouTube API Terms of Service.
- Data is stored securely in a Supabase Postgres database with Row Level Security enabled.

## Contact

Project owner: [Your Name]
Email: [Your Email]
GitHub: [Your Repository URL]
