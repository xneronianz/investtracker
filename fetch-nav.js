/**
 * fetch-nav.js v6 — SEC API for 39 funds + Finnomena scrape for UOBSA-SSF
 * Runs in ~2 minutes. Only needs SEC_KEY_DAILYINFO secret.
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_DI) {
  console.error('ERROR: SEC_KEY_DAILYINFO must be set');
  process.exit(1);
}

// Verified proj_id map from SEC database scan 2026-03-27
const FUND_MAP = [
  ['ABGDD-SSF',             'M0020_2539'],
  ['ASP-ThaiESG',           'M0804_2566'],
  ['B-FUTURESSF',           'M0053_2563'],
  ['B-INNOTECHSSF',         'M0078_2565'],
  ['ES-GINNO-SSF',          'M0479_2563'],
  ['K-CHANGE-SSF',          'M0131_2562'],
  ['KFCMEGASSF',            'M0397_2565'],
  ['KFGGSSF',               'M0379_2564'],
  ['KF-LATAM',              'M0028_2553'],
  ['K-GOLD-A(A)',           'M0447_2551'],
  ['KKP EQ THAI ESG',       'M0851_2566'],
  ['KKP GB THAI ESG',       'M0840_2566'],
  ['KKP EMXCN-H-SSF',      'M0077_2567'],
  ['KKP US500-UH-SSF',      'M0301_2567'],
  ['KT-BOND',               'M0758_2554'],
  ['K-VIETNAM-SSF',         'M0511_2565'],
  ['MEGA10CHINA-SSF',       'M0595_2565'],
  ['ONE-UGG-ASSF',          'M0717_2558'],
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562'],
  ['SCBAXJ(SSF)',           'M0513_2564'],
  ['SCBCHA-SSF',            'M0341_2564'],
  ['SCBCHA(SSFE)',          'M0341_2564'],
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564'],
  ['SCBEUROPE(SSF)',        'M0274_2564'],
  ['SCBEUROPE(SSFE)',       'M0274_2564'],
  ['SCBGOLDH-SSF',          'M0396_2564'],
  ['SCBNDQ(SSF)',           'M0311_2564'],
  ['SCBNEXT(SSFE)',         'M0163_2564'],
  ['SCBS&P500(SSFA)',       'M0357_2564'],
  ['SCBVIET(SSFA)',         'M0539_2564'],
  ['SCBVIET(SSFE)',         'M0539_2564'],
  ['SCBWORLD(SSFE)',        'M0465_2564'],
  ['TDSThaiESG-A',         'M0793_2567'],
  ['TISCOCHA-SSF',         'M0258_2562'],
  ['TLA-GEQ',              'M0563_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',           'M0628_2563'],
  ['UGIS-SSF',             'M0002_2560'],
];

// Funds to fetch from Finnomena (not in SEC Factsheet API)
const FINNOMENA_FUNDS = [
  'UOBSA-SSF',
];

function get(path, key) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

// Fetch a URL and return the HTML body
function fetchHtml(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NAV-fetcher/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'th,en;q=0.9'
      }
    }, res => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHtml(res.headers.location).then(resolve);
        return;
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end();
  });
}

// Extract NAV from Finnomena fund page
// Tries multiple patterns since the page uses React/SSR
async function fetchFinnomenaNAV(fundName) {
  const url = `https://www.finnomena.com/fund/${encodeURIComponent(fundName)}`;
  console.log(`  Fetching Finnomena: ${url}`);
  const res = await fetchHtml(url);

  if (!res.body) {
    console.log(`  Finnomena: empty response for ${fundName}`);
    return null;
  }

  // Pattern 1: JSON-LD or script data with nav
  // Pattern 2: meta tags
  // Pattern 3: text pattern like "13.5052" near date pattern
  const body = res.body;

  // Try to find NAV in JSON embedded in page (Next.js __NEXT_DATA__)
  const nextDataMatch = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Navigate the Next.js data structure to find NAV
      const pageProps = nextData?.props?.pageProps;
      if (pageProps) {
        // Try various paths where NAV might be stored
        const nav = pageProps?.fund?.nav ||
                    pageProps?.fundData?.nav ||
                    pageProps?.initialData?.nav ||
                    pageProps?.data?.nav;
        const navDate = pageProps?.fund?.nav_date ||
                        pageProps?.fundData?.nav_date ||
                        pageProps?.initialData?.nav_date ||
                        pageProps?.data?.nav_date;
        if (nav && parseFloat(nav) > 0) {
          console.log(`  Finnomena Next.js data: ${nav} (${navDate})`);
          return { nav: parseFloat(nav), nav_date: (navDate || '').substring(0, 10) };
        }
        // Try to find nav anywhere in the props
        const str = JSON.stringify(pageProps);
        const navMatch = str.match(/"nav[_\s]?(?:value|price|unit)?"\s*:\s*"?([\d.]+)"?/i);
        if (navMatch) {
          console.log(`  Finnomena JSON pattern: ${navMatch[1]}`);
          return { nav: parseFloat(navMatch[1]), nav_date: '' };
        }
      }
    } catch(e) {
      console.log(`  Finnomena JSON parse error: ${e.message}`);
    }
  }

  // Fallback: regex scan for NAV-like number near the fund name
  // Look for patterns like: 13.5052 or "nav":"13.5052"
  const navPatterns = [
    /"nav"\s*:\s*"?([\d]{1,3}\.[\d]{2,6})"?/,
    /"last_val"\s*:\s*"?([\d]{1,3}\.[\d]{2,6})"?/,
    /"navValue"\s*:\s*"?([\d]{1,3}\.[\d]{2,6})"?/,
    /"unitPrice"\s*:\s*"?([\d]{1,3}\.[\d]{2,6})"?/,
  ];
  for (const pattern of navPatterns) {
    const m = body.match(pattern);
    if (m && parseFloat(m[1]) > 0) {
      console.log(`  Finnomena regex: ${m[1]}`);
      return { nav: parseFloat(m[1]), nav_date: '' };
    }
  }

  console.log(`  Finnomena: could not extract NAV for ${fundName}`);
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchNAV(projId) {
  for (let i = 0; i <= 7; i++) {
    const date = dateStr(i);
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 204 || r.status === 404 || !r.data) continue;
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const navVal  = parseFloat(d.last_val || d.nav_value || d.nav || 0);
      const navDate = (d.nav_date || date).substring(0, 10);
      if (navVal > 0) return { nav: navVal, nav_date: navDate };
    }
    await sleep(30);
  }
  return null;
}

async function main() {
  console.log(`Fetching NAV for ${FUND_MAP.length} funds from SEC + ${FINNOMENA_FUNDS.length} from Finnomena`);
  console.log('Start:', new Date().toISOString());

  // Load existing data to preserve entries
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {};
  } catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

  // SEC API funds
  for (const [name, projId] of FUND_MAP) {
    const result = await fetchNAV(projId);
    if (result) {
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: no NAV data`);
      failed++;
    }
    await sleep(80);
  }

  // Finnomena funds
  for (const name of FINNOMENA_FUNDS) {
    const result = await fetchFinnomenaNAV(name);
    if (result && result.nav > 0) {
      // Use today's date if nav_date not found
      if (!result.nav_date) result.nav_date = dateStr(0);
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name} (Finnomena): ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name} (Finnomena): failed`);
      failed++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`);
  console.log('End:', new Date().toISOString());

  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    count: updated,
    funds: { ...existing, ...navData }
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
