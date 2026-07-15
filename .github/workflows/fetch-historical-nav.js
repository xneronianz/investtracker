/**
 * fetch-historical-nav.js — bulk backfill of historical NAV data (default: up to
 * 10 years) for every fund in FUND_MAP + fund-overrides.json.
 *
 * This is DELIBERATELY SEPARATE from fetch-nav.js:
 *   - fetch-nav.js runs daily (scheduled), fetches only the LATEST NAV per fund,
 *     fast (~1 call/fund), keeps the app snappy.
 *   - fetch-historical-nav.js runs ONLY when manually triggered, fetches years
 *     of history per fund (many paginated calls/fund), can take a long time.
 * They are never meant to run on the same schedule — this script is occasional/
 * on-demand, not part of the daily cadence.
 *
 * Output: nav-history-bulk.json — { generated_at, years_back, funds: { NAME: [{date,nav}, ...] } }
 * The app merges this in itself: dates where SEC has data REPLACE the app's
 * existing value (since class-name-aware fetching is authoritative); dates
 * the app has that SEC doesn't cover are PRESERVED untouched; dates SEC has
 * that the app doesn't are ADDED. Nothing is ever deleted by this process.
 *
 * FUND_MAP below is kept in sync with fetch-nav.js's FUND_MAP by hand — if you
 * add/edit a fund in one, mirror the change in the other.
 */

const https = require('https');
const fs = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const HOST = 'api.sec.or.th';
const YEARS_BACK = parseInt(process.env.YEARS_BACK || '10', 10);

const FUND_MAP = [
  ['ABGDD-SSF',             'M0250_2564', 'ABGDD-SSF'],
  ['ASP-ThaiESG',           'M0804_2566'],
  ['B-FUTURESSF',           'M0053_2563'],
  ['B-GLOBALRMF',           'M0495_2558'],
  ['B-INNOTECHRMF',         'M0667_2559'],
  ['B-INNOTECHSSF',         'M0078_2565'],
  ['ES-GINNO-SSF',          'M0479_2563', 'ES-GINNO-SSF'],
  ['K-CHANGE-SSF',          'M0131_2562'],
  ['KFCMEGASSF',            'M0397_2565'],
  ['KFGGSSF',               'M0379_2564'],
  ['KF-LATAM',              'M0028_2553'],
  ['K-GOLD-A(A)',           'M0447_2551', 'K-GOLD-A(A)'],
  ['K-US500X-A(A)',         'M0257_2564', 'K-US500X-A(A)'],
  ['KKP CHINA-H-SSF',       'M0432_2565', 'KKP CHINA-H-SSF'],
  ['KKP EQ THAI ESG',       'M0851_2566'],
  ['KKP GB THAI ESG',       'M0840_2566'],
  ['KKP GNP RMF-UH',        'M0369_2561'],
  ['KKP EMXCN-H-SSF',      'M0077_2567'],
  ['KKP US500-UH-SSF',      'M0301_2567'],
  ['KT-BOND',               'M0758_2554'],
  ['K-VIETNAM-SSF',         'M0511_2565'],
  ['MEGA10CHINA-SSF',       'M0682_2566'],
  ['ONE-UGG-ASSF',          'M0717_2558'],
  ['PRINCIPAL GOPP-SSF',    'M0166_2560'],
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562'],
  ['SCBAXJ(SSF)',           'M0513_2564'],
  ['SCBCHA-SSF',            'M0005_2558', 'SCBCHA-SSF'],
  ['SCBCHA(SSFE)',          'M0005_2558', 'SCBCHA(SSFE)'],
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564'],
  ['SCBEUROPE(SSF)',        'M0274_2564'],
  ['SCBEUROPE(SSFE)',       'M0274_2564'],
  ['SCBGOLDH-SSF',          'M0856_2553', 'SCBGOLDH-SSF'],
  ['SCBGOLDH(SSFE)',        'M0856_2553', 'SCBGOLDH(SSFE)'],
  ['SCBJAPAN(SSF)',         'M0386_2564', 'SCBJAPAN(SSF)'],
  ['SCBJAPAN(SSFE)',        'M0386_2564', 'SCBJAPAN(SSFE)'],
  ['SCBNDQ(SSF)',           'M0311_2564', 'SCBNDQ(SSF)'],
  ['SCBNDQ(SSFE)',          'M0311_2564', 'SCBNDQ(SSFE)'],
  ['SCBNEXT(SSFE)',         'M0163_2564'],
  ['SCBS&P500(SSFA)',      'M0643_2555', 'SCBS&P500(SSFA)'],
  ['SCBS&P500(SSFE)',      'M0643_2555', 'SCBS&P500(SSFE)'],
  ['SCBVIET(SSFA)',        'M0539_2564', 'SCBVIET(SSFA)'],
  ['SCBVIET(SSFE)',        'M0539_2564', 'SCBVIET(SSFE)'],
  ['SCBWORLD(SSFE)',        'M0465_2564'],
  ['TDSThaiESG-A',         'M0793_2567'],
  ['TISCOCHA-SSF',         'M0258_2562'],
  ['TLA-GEQ',              'M0563_2568'],
  ['TLA-GFIX',             'M0070_2569'],
  ['TLAWSRMF',             'M0948_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',            'M0533_2561', 'UCHINA-SSF'],
  ['UGIS-SSF',             'M0002_2560'],
  ['UOBSA-SSF',            'M0233_2550'],
  ['UOBSD-SSF',             'M0116_2549'],
];

function get(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: HOST, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': KEY_DI, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch (e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(20000, () => req.destroy());
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchFullHistory(projId, className, yearsBack) {
  const endDate = dateStr(0);
  const startD = new Date();
  startD.setFullYear(startD.getFullYear() - yearsBack);
  const startDate = startD.toISOString().split('T')[0];

  let allItems = [];
  let cursor = '';
  let page = 0;
  const MAX_PAGES = 60; // safety cap: 60 * page_size(100) = 6000 entries — comfortably covers 10yrs even of dense data

  while (page < MAX_PAGES) {
    let path = `/v2/fund/daily-info/nav?proj_id=${encodeURIComponent(projId)}` +
               `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=100`;
    if (className) path += `&fund_class_name=${encodeURIComponent(className)}`;
    if (cursor) path += `&next_cursor=${encodeURIComponent(cursor)}`;

    const r = await get(path);
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) break;

    allItems = allItems.concat(r.data.items);
    cursor = r.data.next_cursor || '';
    page++;
    if (!cursor) break;
    await sleep(120); // pace paginated calls to stay well under API rate limits
  }

  // Same defense-in-depth as fetch-nav.js: never trust the server's date/class
  // filtering blindly — re-validate every item client-side.
  let filtered = allItems.filter(item => {
    const d = (item.nav_date || '').substring(0, 10);
    return d >= startDate && d <= endDate;
  });
  if (className) {
    const wanted = className.toUpperCase();
    filtered = filtered.filter(item => (item.fund_class_name || '').toUpperCase() === wanted);
  }

  // Dedupe by date (last-seen wins in case of any overlap across pages)
  const byDate = {};
  filtered.forEach(item => {
    const d = (item.nav_date || '').substring(0, 10);
    const nav = parseFloat(item.last_val || 0);
    if (d && nav > 0) byDate[d] = nav;
  });

  return Object.keys(byDate).sort().map(date => ({ date, nav: byDate[date] }));
}

async function main() {
  // Apply the same override mechanism as fetch-nav.js: fund-overrides.json
  // (pushed by the app's Fund Details "SEC Project ID / Fund Class" fields)
  // takes priority over the hardcoded FUND_MAP above, per fund.
  let overrides = {};
  try {
    const raw = JSON.parse(fs.readFileSync('fund-overrides.json', 'utf8'));
    overrides = raw.overrides || {};
    console.log(`Loaded ${Object.keys(overrides).length} fund override(s) from fund-overrides.json`);
  } catch (e) {}

  const effectiveMap = FUND_MAP.map(([name, projId, className]) => {
    const ov = overrides[name];
    if (ov && ov.proj_id) return [name, ov.proj_id, ov.fund_class || undefined];
    return [name, projId, className];
  });
  const mappedNames = new Set(FUND_MAP.map(e => e[0]));
  for (const [name, ov] of Object.entries(overrides)) {
    if (!mappedNames.has(name) && ov.proj_id) {
      effectiveMap.push([name, ov.proj_id, ov.fund_class || undefined]);
    }
  }

  console.log(`Fetching ${YEARS_BACK}-year historical NAV for ${effectiveMap.length} funds...`);
  console.log('This can take a long time (many paginated calls per fund) — that is expected.');
  console.log('Start:', new Date().toISOString());

  const result = {};
  let okCount = 0, failCount = 0;

  for (const [name, projId, className] of effectiveMap) {
    try {
      const history = await fetchFullHistory(projId, className, YEARS_BACK);
      if (history.length > 0) {
        result[name.toUpperCase()] = history;
        console.log(`  ✓ ${name}: ${history.length} entries (${history[0].date} → ${history[history.length - 1].date})`);
        okCount++;
      } else {
        console.log(`  ✗ ${name}: no historical data returned`);
        failCount++;
      }
    } catch (e) {
      console.log(`  ✗ ${name}: error — ${e.message}`);
      failCount++;
    }
    await sleep(150); // pace between funds
  }

  console.log(`\nDone: ${okCount} funds fetched, ${failCount} failed`);
  console.log('End:', new Date().toISOString());

  fs.writeFileSync('nav-history-bulk.json', JSON.stringify({
    generated_at: new Date().toISOString(),
    years_back: YEARS_BACK,
    funds: result
  }));
  console.log('nav-history-bulk.json written');
}

main().catch(e => { console.error(e); process.exit(1); });
