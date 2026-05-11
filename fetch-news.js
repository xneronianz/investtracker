// fetch-news.js v5 - 10 categories with flag labels
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
                'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
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
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const block of blocks.slice(0, 4)) {
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
    // 🇹🇭 Thai
    { url: 'https://www.bangkokpost.com/rss/data/business.xml',                                          source: 'Bangkok Post',  badge: 'thai'      },
    { url: 'https://www.bangkokpost.com/rss/data/topstories.xml',                                        source: 'Bangkok Post',  badge: 'thai'      },
    { url: 'https://news.google.com/rss/search?q=Thailand+SET+index+stock+market&hl=en&gl=TH',          source: 'Google News',   badge: 'thai'      },
    { url: 'https://news.google.com/rss/search?q=Thailand+baht+THB+Bank+of+Thailand&hl=en',             source: 'Google News',   badge: 'thai'      },
    // 🌐 Global
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                                            source: 'BBC Business',  badge: 'global'    },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',                                 source: 'NY Times',      badge: 'global'    },
    { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',                                      source: 'CNBC Markets',  badge: 'global'    },
    // 🇺🇸 US
    { url: 'https://news.google.com/rss/search?q=US+stock+market+S%26P500+Nasdaq+Wall+Street&hl=en',    source: 'Google News',   badge: 'us'        },
    { url: 'https://news.google.com/rss/search?q=Federal+Reserve+rate+US+economy+inflation&hl=en',      source: 'Google News',   badge: 'us'        },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135',        source: 'CNBC US',       badge: 'us'        },
    // 🇨🇳 China
    { url: 'https://news.google.com/rss/search?q=China+stock+market+Hang+Seng+CSI+Shanghai&hl=en',      source: 'Google News',   badge: 'china'     },
    { url: 'https://news.google.com/rss/search?q=China+economy+PBOC+yuan+trade+tariff&hl=en',           source: 'Google News',   badge: 'china'     },
    // 🇻🇳 Vietnam
    { url: 'https://news.google.com/rss/search?q=Vietnam+VN-Index+stock+market+economy&hl=en',          source: 'Google News',   badge: 'vietnam'   },
    { url: 'https://news.google.com/rss/search?q=Vietnam+dong+investment+fund&hl=en',                   source: 'Google News',   badge: 'vietnam'   },
    // 💼 Fund
    { url: 'https://news.google.com/rss/search?q=Thai+mutual+fund+NAV+SSF+RMF+investment&hl=en',        source: 'Google News',   badge: 'fund'      },
    { url: 'https://news.google.com/rss/search?q=Krungsri+SCB+Finnomena+fund+Thailand&hl=en',           source: 'Google News',   badge: 'fund'      },
    // 🏦 Economic
    { url: 'https://news.google.com/rss/search?q=Thailand+GDP+inflation+monetary+policy&hl=en',         source: 'Google News',   badge: 'economic'  },
    { url: 'https://news.google.com/rss/search?q=global+economic+outlook+IMF+World+Bank+2026&hl=en',    source: 'Google News',   badge: 'economic'  },
    // 🌏 EM
    { url: 'https://news.google.com/rss/search?q=emerging+markets+Asia+EM+ETF+fund&hl=en',              source: 'Google News',   badge: 'em'        },
    { url: 'https://news.google.com/rss/search?q=ASEAN+Southeast+Asia+investment+2026&hl=en',           source: 'Google News',   badge: 'em'        },
    // 📊 Bond
    { url: 'https://news.google.com/rss/search?q=bond+yield+treasury+fixed+income+market&hl=en',        source: 'Google News',   badge: 'bond'      },
    { url: 'https://news.google.com/rss/search?q=Thailand+government+bond+yield+debt&hl=en',            source: 'Google News',   badge: 'bond'      },
    // 🪙 Commodity
    { url: 'https://news.google.com/rss/search?q=gold+price+commodity+market+2026&hl=en',               source: 'Google News',   badge: 'commodity' },
    { url: 'https://news.google.com/rss/search?q=crude+oil+copper+commodity+price&hl=en',               source: 'Google News',   badge: 'commodity' },
];

async function main() {
    console.log('fetch-news.js v5 — 10 categories with flags...\n');
    const allItems = [];
    const labels = { thai:'🇹🇭', global:'🌐', us:'🇺🇸', china:'🇨🇳', vietnam:'🇻🇳', fund:'💼', economic:'🏦', em:'🌏', bond:'📊', commodity:'🪙' };

    for (const feed of FEEDS) {
        try {
            process.stdout.write(`${labels[feed.badge]||'?'} [${feed.badge}] ${feed.source.substring(0,20)}: `);
            const { status, body } = await fetchUrl(feed.url);
            const hasItems = body.includes('<item>') || body.includes('<item ');
            if (status === 200 && hasItems) {
                const items = parseRSS(body, feed.source, feed.badge);
                console.log(`✓ ${items.length} articles`);
                allItems.push(...items);
            } else {
                console.log(`✗ HTTP ${status}`);
            }
        } catch(e) {
            console.log(`✗ ${e.message}`);
        }
    }

    const seen = new Set();
    const unique = allItems.filter(i => {
        const key = i.title.toLowerCase().substring(0, 60);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
    unique.sort((a, b) => new Date(b.date) - new Date(a.date));

    const output = { updated: new Date().toISOString(), items: unique.slice(0, 50) };
    fs.writeFileSync('news.json', JSON.stringify(output, null, 2));
    console.log(`\n✅ Saved ${unique.length} items across 10 categories to news.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
