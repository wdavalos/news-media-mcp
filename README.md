# News Media MCP

AI-native access to Google News search, article content, and top headlines via public RSS feed.

## What

MCP server providing AI agents programmatic access to:
- **News search** — query Google News and get article metadata
- **Article fetch** — extract full content from news articles
- **Top headlines** — current trending headlines by category

## Tools

### `search_news`
Search Google News for a query. Returns article metadata including title, URL, source, published date, and snippet.
- **Params**: `query` (required), `location` (US/GB/DE/FR/etc.), `num_results` (1-100)
- **PPE**: $0.03/call

### `get_article`
Fetch full article content from a Google News URL. Returns title, content, source, and published date.
- **Params**: `url` (required, Google News article URL)
- **PPE**: $0.05/call

### `get_top_headlines`
Get current top headlines by category. Returns trending news across categories.
- **Params**: `category` (general/business/technology/science/health/sports/entertainment), `location`
- **PPE**: $0.03/call

## Data Source

Public Google News RSS index — no API key, no auth required.

## Use Cases

- Market intelligence monitoring
- Competitive analysis
- Brand mention tracking
- Content opportunity research
- News aggregation pipelines

## Quick Start

```bash
npm install
echo '{"tool": "search_news", "params": {"query": "AI artificial intelligence", "num_results": 5}}' | INPUT_STORE=1 apify run
```

## MCP Protocol

Standard JSON-RPC 2.0 over HTTP POST to `/mcp`:
```json
{"method": "tools/call", "params": {"name": "search_news", "arguments": {"query": "tech news"}}}
```

## Build

```bash
npm install
apify build
apify push
```

## Configuration

- **Memory**: 1024 MB
- **Timeout**: 3600s
- **Template**: ts-standby MCP actor
- **Port**: containerPort (not standbyPort)

## License

MIT