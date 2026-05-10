// GitHub Action script: fetch-news.js
// Runs daily via GitHub Actions, saves news.json to repo

const https = require('https');
const fs = require('fs');

const queries = [
    { q: 'Thailand SET index stock market', badge: 'thai' },
    { q: 'Thai mutual fund investment NAV', badge: 'fund' },
    { q: 'China Hang Seng CSI stock market', badge: 'global' },
    { q: 'US S&P500 Nasdaq Federal Reserve rate', badge: 'global' },
    { q: 'Vietnam stock market VN-Index', badge: 'global' },
    { q: 'emerging markets Asia ETF fund', badge: 'global' },
    { q: 'Thailand baht THB exchange rate BOT', badge: 'economic' },
];

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'InvestTracker/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function main() {
    const allItems = [];
    const key = process.env.GNEWS_API_KEY || '';
    
    for (const { q, badge } of queries) {
        try {
            let url;
            if (key) {
                url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=3&apikey=${key}`;
            } else {
                // Use mediastack free with no key (limited)
                url = `https://api.mediastack.com/v1/news?access_key=${process.env.MEDIASTACK_KEY || ''}&keywords=${encodeURIComponent(q)}&languages=en&limit=3`;
            }
            const raw = await fetchUrl(url);
            const data = JSON.parse(raw);
            const articles = data.articles || data.data || [];
            articles.forEach(a => {
                allItems.push({
                    title: a.title,
                    body: (a.description || a.content || '').substring(0, 200),
                    link: a.url,
                    date: a.publishedAt || a.published_at || new Date().toISOString(),
                    source: a.source?.name || a.source || 'News',
                    badge
                });
            });
        } catch(e) {
            console.log(`Failed for query "${q}":`, e.message);
        }
    }

    // Deduplicate
    const seen = new Set();
    const unique = allItems.filter(i => {
        if (!i.title || seen.has(i.title)) return false;
        seen.add(i.title); return true;
    });

    const output = {
        updated: new Date().toISOString(),
        items: unique.slice(0, 20)
    };

    fs.writeFileSync('news.json', JSON.stringify(output, null, 2));
    console.log(`Saved ${unique.length} news items to news.json`);
}

main().catch(console.error);
