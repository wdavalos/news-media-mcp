/**
 * news-media-mcp
 * AI-native Google News API for autonomous workflows.
 * Programmatic access to news search, article content, and top headlines
 * via the public Google News RSS index (no auth required).
 */

import http from 'http';
import Apify, { Actor } from 'apify';

// ts-standby: Always init unconditionally, detect standby after
await Actor.init();

const isStandby = process.env.APIFY_META_ORIGIN === 'STANDBY';
const PORT = Actor.config.get('containerPort') || process.env.ACTOR_WEB_SERVER_PORT || 3000;
const MCP_PATH = '/mcp';

// MCP Tool Manifest
const MCP_TOOLS = [
  {
    name: 'search_news',
    description: 'Search Google News for a query and return article metadata. Returns title, URL, source, published date, and snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for news articles' },
        location: { type: 'string', description: 'Geographic location (US, GB, DE, FR, etc.)' },
        num_results: { type: 'integer', description: 'Maximum number of results to return (default: 20, max: 100)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_article',
    description: 'Fetch full article content from a Google News article URL. Returns title, content, source, and published date.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL of the article to fetch' }
      },
      required: ['url']
    }
  },
  {
    name: 'get_top_headlines',
    description: 'Get current top headlines by category. Returns trending news across categories like general, business, technology, science, health, sports.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'News category: general, business, technology, science, health, sports, entertainment (default: general)' },
        location: { type: 'string', description: 'Geographic location (US, GB, DE, FR, etc.)' }
      }
    }
  }
];

// HTTP Server for MCP Protocol (used in standby mode)
if (isStandby) {
  const server = http.createServer(async (req, res) => {
    // Handle readiness probe
    if (req.headers['x-apify-container-server-readiness-probe']) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    // Handle MCP requests
    if (req.method === 'POST' && req.url === '/mcp') {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > 1_000_000) { // 1MB limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const jsonBody = JSON.parse(body);
          const id = jsonBody.id ?? null;

          const reply = (result) => {
            const resp = id !== null
              ? { jsonrpc: '2.0', id, result }
              : result;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp));
          };

          const replyError = (code, message) => {
            const resp = id !== null
              ? { jsonrpc: '2.0', id, error: { code, message } }
              : { status: 'error', error: message };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp));
          };

          const method = jsonBody.method;

          // Standard MCP: initialize
          if (method === 'initialize') {
            return reply({
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'news-media-mcp', version: '1.0.0' }
            });
          }

          // Standard MCP: tools/list
          if (method === 'tools/list' || (!method && jsonBody.tool === 'list')) {
            return reply({ tools: MCP_TOOLS });
          }

          // Standard MCP: tools/call
          if (method === 'tools/call') {
            const toolName = jsonBody.params?.name;
            const toolArgs = jsonBody.params?.arguments || {};
            if (!toolName) return replyError(-32602, 'Missing params.name');
            // Wrap tool execution in 90s timeout to prevent standby from hanging
            const toolResult = await Promise.race([
              handleToolCall(toolName, toolArgs),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            return reply({
              content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
            });
          }

          // Legacy: tools/{toolName} method format
          if (method && method.startsWith('tools/')) {
            const toolName = method.slice(6);
            const toolArgs = jsonBody.params || {};
            const toolResult = await Promise.race([
              handleToolCall(toolName, toolArgs),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            return reply({
              content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
            });
          }

          // Legacy direct: {tool: "...", params: {...}}
          if (jsonBody.tool) {
            const toolResult = await Promise.race([
              handleToolCall(jsonBody.tool, jsonBody.params || {}),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', result: toolResult }));
            return;
          }

          replyError(-32601, `Method not found: ${method}`);
        } catch (error) {
          console.error('MCP error:', error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: error.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, () => {
    Actor.log.info(`News Media MCP listening on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close(() => Actor.exit());
  });
} else {
  // Batch mode: run tool and exit
  const input = await Actor.getInput();
  if (input) {
    const { tool, params = {} } = input;
    if (tool) {
      Actor.log.info(`Running tool: ${tool}`);
      const result = await handleToolCall(tool, params);
      await Actor.setValue('OUTPUT', result);
    }
  }
  await Actor.exit();
}

// Export handleRequest for MCP gateway compatibility
export default {
  handleRequest: async ({ request, log }) => {
    log.info("News Media MCP received request");
    try {
      const { method, params } = request;
      if (method === 'tools/list') {
        return { tools: MCP_TOOLS };
      }
      if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const result = await handleToolCall(name, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      return { error: 'Unknown method' };
    } catch (error) {
      log.error(error.message);
      return { error: error.message };
    }
  }
};

// Data Fetchers with 120s timeout
const TIMEOUT = 120000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// Google News RSS base URL
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss';

// Category to URL param mapping
function getCategoryParam(category) {
  const catMap = {
    'general': '',
    'business': '?topic=business',
    'technology': '?topic=tech',
    'science': '?topic=science',
    'health': '?topic=health',
    'sports': '?topic=sports',
    'entertainment': '?topic=entertainment'
  };
  return catMap[category?.toLowerCase()] || '';
}

// Location to CEID parameter mapping
function getCeidParam(location) {
  const locMap = {
    'US': 'US:en',
    'GB': 'GB:en',
    'DE': 'DE:de',
    'FR': 'FR:fr',
    'CA': 'CA:en',
    'AU': 'AU:en',
    'IN': 'IN:en',
    'JP': 'JP:ja',
    'BR': 'BR:pt'
  };
  return locMap[location?.toUpperCase()] || 'US:en';
}

// Search news via Google News RSS
async function searchNews(query, location, num_results) {
  try {
    const geo = location || 'US';
    const ceid = getCeidParam(geo);
    const limit = Math.min(num_results || 20, 100);
    const encodedQuery = encodeURIComponent(query);
    const url = `${GOOGLE_NEWS_RSS}/search?q=${encodedQuery}&hl=en-US&gl=${geo}&ceid=${ceid}`;

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Google News RSS error: ${response.status}`);

    const text = await response.text();

    // Parse RSS XML
    const articles = parseRSSArticles(text, limit);

    return {
      query,
      location: geo,
      total_results: articles.length,
      articles,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Search news failed:', error.message);
    return { query, articles: [], error: error.message };
  }
}

// Get top headlines via Google News RSS
async function getTopHeadlines(category, location) {
  try {
    const geo = location || 'US';
    const ceid = getCeidParam(geo);
    const catParam = getCategoryParam(category) || '';
    const encodedQuery = encodeURIComponent(category || 'top headlines');
    const url = `${GOOGLE_NEWS_RSS}/search?q=${encodedQuery}&hl=en-US&gl=${geo}&ceid=${ceid}`;

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Google News RSS error: ${response.status}`);

    const text = await response.text();

    // Parse RSS XML - get top 30 for headlines
    const articles = parseRSSArticles(text, 30);

    return {
      category: category || 'general',
      location: geo,
      total_results: articles.length,
      headlines: articles.map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
        published: a.published
      })),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Get top headlines failed:', error.message);
    return { category: category || 'general', headlines: [], error: error.message };
  }
}

// Fetch article content (from Google News article page)
async function getArticleContent(url) {
  try {
    // Validate URL is from Google News
    if (!url.includes('news.google.com')) {
      throw new Error('URL must be from news.google.com');
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Article fetch error: ${response.status}`);

    const html = await response.text();

    // Extract article content from HTML
    const article = extractArticleFromHtml(html, url);

    return {
      url,
      title: article.title,
      content: article.content,
      source: article.source,
      authors: article.authors,
      published: article.published,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Get article failed:', error.message);
    return { url, error: error.message };
  }
}

// Parse RSS XML to extract articles
function parseRSSArticles(xml, limit) {
  const articles = [];

  // Extract item blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && articles.length < limit) {
    const item = match[1];

    const title = extractXmlValue(item, 'title');
    const link = extractXmlValue(item, 'link');
    const description = extractXmlValue(item, 'description');
    const pubDate = extractXmlValue(item, 'pubDate');
    const source = extractXmlValue(item, 'source');

    if (title && link) {
      articles.push({
        title: cleanHtml(title),
        url: cleanUrl(link),
        snippet: cleanHtml(description || '').slice(0, 300),
        source: cleanHtml(source || extractSourceFromUrl(link)),
        published: pubDate ? new Date(pubDate).toISOString() : null
      });
    }
  }

  return articles;
}

// Extract value from XML tag
function extractXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

// Clean HTML entities and tags
function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Clean and normalize Google News URL
function cleanUrl(url) {
  if (!url) return '';
  // Remove Google's redirect tracking
  return url.replace(/url=/, '').split('&')[0];
}

// Extract source name from URL
function extractSourceFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    const match = url.match(/news\.google\.com\/.*?\/([^/]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '));
    const urlObj = new URL(url);
    return urlObj.hostname.replace('news.', '');
  } catch {
    return 'Unknown';
  }
}

// Extract article content from HTML
function extractArticleFromHtml(html, url) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? cleanHtml(titleMatch[1]) : 'No title';

  // Try to find meta description
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  const description = descMatch ? descHtml(descMatch[1]) : '';

  // Try to find article body
  const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  let content = '';
  if (bodyMatch) {
    content = cleanHtml(bodyMatch[1]).slice(0, 5000);
  } else {
    // Fallback: get meta description
    content = description;
  }

  // Try to find published date
  const dateMatch = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i) ||
                   html.match(/<time[^>]*datetime="([^"]+)"/i);
  const published = dateMatch ? dateMatch[1] : null;

  // Try to find source
  const sourceMatch = html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i);
  const source = sourceMatch ? sourceMatch[1] : extractSourceFromUrl(url);

  return { title, content, source, authors: [], published };
}

function descHtml(text) {
  return text.replace(/"/g, '"').trim();
}

// Main Tool Handler
async function handleToolCall(tool, args) {
  // PPE pricing map (in cents)
  const PPE_PRICES = {
    'search_news': 3,        // $0.03
    'get_article': 5,         // $0.05
    'get_top_headlines': 3   // $0.03
  };

  const price = PPE_PRICES[tool];
  if (price) {
    await Actor.charge({ eventName: tool, count: 1 });
  }

  switch (tool) {
    case 'search_news':
      return await searchNews(args.query, args.location, args.num_results);

    case 'get_article':
      return await getArticleContent(args.url);

    case 'get_top_headlines':
      return await getTopHeadlines(args.category, args.location);

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
