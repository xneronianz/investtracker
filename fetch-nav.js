/**
 * fetch-nav.js v20 — added client-side date-recency safety net after discovering
 * K-GOLD-A(A), K-US500X-A(A), SCBS&P500(SSFE) received significantly wrong NAVs.
 * Root cause: start_nav_date/end_nav_date query params may be silently ignored by
 * the SEC API, returning full history since fund inception (e.g. dates from 2010)
 * instead of the intended recent window — v19 blindly picked "latest of whatever
 * came back," which could be a decade-old NAV. v20 re-validates every item's
 * nav_date client-side and only accepts entries genuinely within the lookback
 * window; if none qualify, returns null (fund keeps its last known-good cached
 * NAV) rather than risk applying wrong data.
 *
 * v19 — migrated to the new SEC Open Data API (secopendata.sec.or.th)
 * The legacy api-portal.sec.or.th portal shut down 2026-06-30; the old
 * /FundDailyInfo/{proj_id}/dailynav/{date} path is gone. New endpoint:
 *   GET https://api.sec.or.th/v2/fund/daily-info/nav
 *       ?proj_id=...&start_nav_date=YYYY-MM-DD&end_nav_date=YYYY-MM-DD
 * Same auth header (Ocp-Apim-Subscription-Key) but the KEY VALUE must be
 * freshly issued by re-subscribing on the new portal — old keys don't carry over.
 * Response is now a paginated wrapper: { message, page_size, next_cursor, items: [...] }
 * — one GET now returns every NAV in the date window (was: up to 8 separate
 * single-date calls per fund on the old API). last_val / nav_date field names unchanged.
 *
 * 52 funds total, proj_ids verified via Finnomena factsheet URLs
 * Note: SSF/SSFE/SSFA share classes may use same proj_id as parent — NAV differs by <0.2%
 *
 * GitHub Secrets: SEC_KEY_DAILYINFO (must be re-issued from the new portal)
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_DI) { console.error('ERROR: SEC_KEY_DAILYINFO must be set'); process.exit(1); }

// All funds below have confirmed proj_ids from Finnomena factsheet URLs.
// NAV from API may differ by <0.2% from SSF/SSFE/SSFA share class NAV due to fee structures.
const FUND_MAP = [
  ['ABGDD-SSF',             'M0250_2564'],   // confirmed
  ['ASP-ThaiESG',           'M0804_2566'],
  ['B-FUTURESSF',           'M0053_2563'],
  ['B-GLOBALRMF',           'M0495_2558'],
  ['B-INNOTECHRMF',         'M0667_2559'],
  ['B-INNOTECHSSF',         'M0078_2565'],
  ['ES-GINNO-SSF',          'M0479_2563'],   // confirmed
  ['K-CHANGE-SSF',          'M0131_2562'],
  ['KFCMEGASSF',            'M0397_2565'],
  ['KFGGSSF',               'M0379_2564'],
  ['KF-LATAM',              'M0028_2553'],
  ['K-GOLD-A(A)',           'M0447_2551'],
  ['K-US500X-A(A)',         'M0257_2564'],   // ← new: Kasikorn US500 Extra Fund A
  ['KKP CHINA-H-SSF',       'M0432_2565'],   // confirmed
  ['KKP EQ THAI ESG',       'M0851_2566'],
  ['KKP GB THAI ESG',       'M0840_2566'],
  ['KKP GNP RMF-UH',        'M0369_2561'],
  ['KKP EMXCN-H-SSF',      'M0077_2567'],
  ['KKP US500-UH-SSF',      'M0301_2567'],
  ['KT-BOND',               'M0758_2554'],
  ['K-VIETNAM-SSF',         'M0511_2565'],
  ['MEGA10CHINA-SSF',       'M0682_2566'],
  ['ONE-UGG-ASSF',          'M0717_2558'],
  ['PRINCIPAL GOPP-SSF',    'M0166_2560'],   // ← new: Principal Global Opportunity SSF
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562'],
  ['SCBAXJ(SSF)',           'M0513_2564'],
  ['SCBCHA-SSF',            'M0005_2558'],   // confirmed
  ['SCBCHA(SSFE)',          'M0005_2558'],   // confirmed — same proj_id as SCBCHA-SSF
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564'],
  ['SCBEUROPE(SSF)',        'M0274_2564'],
  ['SCBEUROPE(SSFE)',       'M0274_2564'],
  ['SCBGOLDH-SSF',          'M0856_2553'],   // confirmed
  ['SCBGOLDH(SSFE)',        'M0856_2553'],   // confirmed — same proj_id as SCBGOLDH-SSF, manual (share-class ambiguity)
  ['SCBNDQ(SSF)',           'M0311_2564'],   // confirmed
  ['SCBNDQ(SSFE)',          'M0311_2564'],   // confirmed — same proj_id as SCBNDQ(SSF), manual (share-class ambiguity)
  ['SCBNEXT(SSFE)',         'M0163_2564'],
  ['SCBS&P500(SSFA)',       'M0643_2555'],   // confirmed
  ['SCBS&P500(SSFE)',       'M0643_2555'],   // confirmed — same proj_id as SCBS&P500(SSFA), manual (share-class ambiguity)
  ['SCBVIET(SSFA)',         'M0539_2564'],   // confirmed
  ['SCBVIET(SSFE)',         'M0539_2564'],   // confirmed — same proj_id as SCBVIET(SSFA)
  ['SCBWORLD(SSFE)',        'M0465_2564'],
  ['TDSThaiESG-A',         'M0793_2567'],
  ['TISCOCHA-SSF',         'M0258_2562'],   // confirmed
  ['TLA-GEQ',              'M0563_2568'],
  ['TLA-GFIX',             'M0070_2569'],   // ← new: Talis Global Fixed Income
  ['TLAWSRMF',             'M0948_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',            'M0533_2561'],   // confirmed
  ['UGIS-SSF',             'M0002_2560'],
  ['UOBSA-SSF',            'M0233_2550'],
  ['UOBSD-SSF',             'M0116_2549'],   // confirmed
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchNAV(projId) {
  // New API returns a list of NAV entries within a date range in ONE call —
  // no more looping through individual dates like the old API required.
  // A 10-day lookback comfortably covers weekends + most Thai public holidays.
  const startDate = dateStr(10);
  const endDate   = dateStr(0);
  const path = `/v2/fund/daily-info/nav?proj_id=${encodeURIComponent(projId)}` +
               `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=50`;

  const r = await get(path, KEY_DI);
  if (r.status !== 200 || !r.data || !Array.isArray(r.data.items) || r.data.items.length === 0) {
    return null;
  }

  // SAFETY NET: never trust that the server actually honored start_nav_date/end_nav_date.
  // If it silently ignores the filter (some government APIs document params they don't
  // fully implement), it can return the fund's ENTIRE history back to inception —
  // e.g. dates from 2010 — and blindly picking "the latest of whatever came back" would
  // apply a wildly outdated NAV as if it were current. So we always re-filter client-side
  // to only entries genuinely within our intended recent window before picking anything.
  const recentItems = r.data.items.filter(item => {
    const d = (item.nav_date || '').substring(0, 10);
    return d >= startDate && d <= endDate;
  });

  if (recentItems.length === 0) {
    // Server returned data, but none of it falls inside our recent window —
    // treat as a failed fetch rather than risk applying stale/wrong data.
    return null;
  }

  const sorted = recentItems.slice().sort((a, b) => (a.nav_date || '').localeCompare(b.nav_date || ''));
  const latest = sorted[sorted.length - 1];
  const nav = parseFloat(latest.last_val || 0);
  const navDate = (latest.nav_date || endDate).substring(0, 10);

  if (nav > 0) return { nav, nav_date: navDate };
  return null;
}

async function main() {
  console.log(`Fetching NAV for ${FUND_MAP.length} funds...`);
  console.log('Start:', new Date().toISOString());

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {}; }
  catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

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

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
