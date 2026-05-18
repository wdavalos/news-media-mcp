---
date: 2026-05-17
tags:
- apify
- mcp
- news
- google-news
- ppe
- fleet
- completed
title: "PRD: news-media-mcp — Google News MCP for AI Agents"
---

# PRD: news-media-mcp

## What

**news-media-mcp** — MCP server providing AI agents programmatic access to Google News search results, article content, and top headlines via the public Google News index (no auth required).

## Why

News aggregation is a core workflow for AI agents doing:
- Market intelligence
- Competitive analysis
- Content monitoring
- Trend detection

No-auth Google News access via structured scrape is the right data source: public, rich, real-time.

## Target Buyers

- Content marketers monitoring brand/industry news
- SEO tools tracking news mentions
- Market intelligence bots
- Social media schedulers
- Research agents

## Tools

### 1. `search_news`
Search Google News for a query. Returns article metadata.
- **params**: `query` (required), `location` (optional, default US), `num_results` (optional, default 20)
- **PPE**: $0.03/call

### 2. `get_article`
Fetch full article content from a Google News URL.
- **params**: `url` (required)
- **PPE**: $0.05/call

### 3. `get_top_headlines`
Get current top headlines by category.
- **params**: `category` (optional, default "general"), `location` (optional, default US)
- **PPE**: $0.03/call

## Data Source

Google News public index: `https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en`

No API key required. No auth. Public scrape.

## Tech

- **Template**: ts-standby MCP actor
- **Runtime**: `apify/actor-node:24`, Node 20+
- **Port**: `containerPort` (not `standbyPort`)
- **Build**: `npm install` + `apify build` + `apify push`
- **PPE**: `Actor.charge()` at 3¢/5¢ per tool call
- **GitHub**: `wdavalos/news-media-mcp`

## PPE Pricing

| Tool | Price |
|------|-------|
| search_news | $0.03 |
| get_article | $0.05 |
| get_top_headlines | $0.03 |

## GitHub Push

```bash
cd ~/Projects/apify-actors/news-media-mcp
git init
git add .
git commit -m "feat: news-media-mcp initial commit"
gh repo create wdavalos/news-media-mcp --public --source=. --push-if-empty
```

## Apify Deploy

```bash
apify push --actor wdavalos/news-media-mcp
```

## Post-Deploy

1. Verify actor: `apify actors get wdavalos/news-media-mcp`
2. Set PPE via API (all 3 tools in ONE call)
3. Set `isPublic: true` via API
4. Add SEO title/description via API

## No Cross-Sell

Do NOT mention or cross-sell `tech-scouting-report-mcp` or any competitor MCPs.