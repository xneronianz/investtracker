// fetch-news.js v3 - No API key required
// Works on GitHub Actions which has full internet access
const https = require('https');
const http = require('http');
const fs = require('fs');

function fetchUrl(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
            }
        }, (res) => {
            if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
                const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
                return fetchUrl(loc, redirectCount + 1).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

function parseRSS(xml, source, badge) {
    const items = [];
    const raw = xml.replace(/\r\n/g, '\n');
    const blocks = raw.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const block of blocks.slice(0, 5)) {
        const get = (tag) => {
            const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
            const m = block.match(re);
            return m ? m[1].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').trim() : '';
        };
        const linkMatch = block.match(/<link[^>]*>([^<]+)<\/link>/) || block.match(/<link[^>]+href="([^"]+)"/) || block.match(/<guid[^>]*isPermaLink="true"[^>]*>([^<]+)<\/guid>/);
        const title = get('title');
        const desc = get('description') || get('summary') || get('content');
        const link = linkMatch ? linkMatch[1].trim() : '';
        const pubDate = get('pubDate') || get('published') || get('dc:date');
        if (title && title.length > 10) {
            items.push({
                title: title.substring(0, 150),
                body: desc.substring(0, 220) + (desc.length > 220 ? '...' : ''),
                link,
                date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
                source,
                badge
            });
        }
    }
    return items;
}

const FEEDS = [
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                          source: 'BBC Business',       badge: 'global'   },
    { url: 'https://www.bangkokpost.com/rss/data/business.xml',                        source: 'Bangkok Post',       badge: 'thai'     },
    { url: 'https://www.bangkokpost.com/rss/data/topstories.xml',                      source: 'Bangkok Post',       badge: 'thai'     },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',               source: 'NY Times',           badge: 'global'   },
    { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',                    source: 'CNBC Markets',       badge: 'global'   },
    { url: 'https://feeds.skynews.com/feeds/rss/business.xml',                         source: 'Sky News',           badge: 'global'   },
    { url: 'https://feed.infoq.com',                                                    source: 'InfoQ',              badge: 'global'   },
    { url: 'https://www.investing.com/rss/news_25.rss',                                source: 'Investing.com',      badge: 'global'   },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', source: 'CNBC Asia', badge: 'global' },
    { url: 'https://news.google.com/rss/search?q=Thailand+SET+stock+market&hl=en&gl=TH&ceid=TH:en', source: 'Google News TH', badge: 'thai' },
    { url: 'https://news.google.com/rss/search?q=thai+mutual+fund+investment&hl=en',  source: 'Google News',        badge: 'fund'     },
    { url: 'https://news.google.com/rss/search?q=China+stock+market+Hang+Seng&hl=en',source: 'Google News',        badge: 'global'   },
    { url: 'https://news.google.com/rss/search?q=US+stock+market+SP500+Nasdaq&hl=en', source: 'Google News',       badge: 'global'   },
    { url: 'https://news.google.com/rss/search?q=emerging+markets+Asia+fund&hl=en',   source: 'Google News',       badge: 'global'   },
    { url: 'https://news.google.com/rss/search?q=Thailand+baht+THB+economy&hl=en',    source: 'Google News',       badge: 'economic' },
];

async function main() {
    console.log('fetch-news.js v3 — fetching from RSS feeds...\n');
    const allItems = [];

    for (const feed of FEEDS) {
        try {
            process.stdout.write(`Fetching ${feed.source}: `);
            const { status, body } = await fetchUrl(feed.url);
            const hasItems = body.includes('<item>') || body.includes('<item ');
            console.log(`HTTP ${status}, ${body.length} bytes, items: ${hasItems}`);
            if (status === 200 && hasItems) {
                const items = parseRSS(body, feed.source, feed.badge);
                console.log(`  → parsed ${items.length} articles`);
                allItems.push(...items);
            }
        } catch(e) {
            console.log(`ERROR: ${e.message}`);
        }
    }

    // Deduplicate
    const seen = new Set();
    const unique = allItems.filter(i => {
        const key = i.title.toLowerCase().substring(0, 60);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });

    unique.sort((a, b) => new Date(b.date) - new Date(a.date));

    const output = { updated: new Date().toISOString(), items: unique.slice(0, 25) };
    fs.writeFileSync('news.json', JSON.stringify(output, null, 2));
    console.log(`\n✅ Saved ${unique.length} news items to news.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
