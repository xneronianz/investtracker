/**
 * fetch-nav.js v8 — Uses fund.sec.or.th/public/api (no key needed)
 * Fetches NAV by fund_class_name directly — works for SSF/SSFE share classes
 * No API key required. Runs server-side in GitHub Actions (no CORS issue).
 */

const https = require('https');
const fs    = require('fs');

// All 40 funds by their exact fund_class_name in SEC database
const FUND_NAMES = [
  'ABGDD-SSF', 'ASP-ThaiESG', 'B-FUTURESSF', 'B-INNOTECHSSF',
  'ES-GINNO-SSF', 'K-CHANGE-SSF', 'KFCMEGASSF', 'KFGGSSF',
  'KF-LATAM', 'K-GOLD-A(A)', 'KKP EMXCN-H-SSF', 'KKP EQ THAI ESG',
  'KKP GB THAI ESG', 'KKP US500-UH-SSF', 'KT-BOND', 'K-VIETNAM-SSF',
  'MEGA10CHINA-SSF', 'ONE-UGG-ASSF', 'PRINCIPAL iPROPEN-SSF',
  'SCBAXJ(SSF)', 'SCBCHA-SSF', 'SCBCHA(SSFE)', 'SCBCOMP',
  'SCBCTECH(SSFE)', 'SCBEUROPE(SSF)', 'SCBEUROPE(SSFE)', 'SCBGOLDH-SSF',
  'SCBNDQ(SSF)', 'SCBNEXT(SSFE)', 'SCBS&P500(SSFA)', 'SCBVIET(SSFA)',
  'SCBVIET(SSFE)', 'SCBWORLD(SSFE)', 'TDSThaiESG-A', 'TISCOCHA-SSF',
  'TLA-GEQ', 'TLFVMR-ASIAX', 'UCHINA-SSF', 'UGIS-SSF', 'UOBSA-SSF'
];

const BASE = 'fund.sec.or.th';

function get(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: body.substring(0,100) }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: null, err: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, data: null, err: 'timeout' }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchFundNAV(name) {
  // Step 1: get proj_id via fund_class_name search
  const encoded = encodeURIComponent(name);
  const profileR = await get(`/public/api/v2/fund/general-info/profiles?fund_class_name=${encoded}`);

  if (!profileR.data || !Array.isArray(profileR.data) || !profileR.data.length) {
    return { error: `profile not found (status ${profileR.status})` };
  }

  // Find exact match on fund_class_name
  const match = profileR.data.find(p =>
    (p.fund_class_name || '').toUpperCase() === name.toUpperCase()
  ) || profileR.data[0];

  const projId = match.proj_id;
  if (!projId) return { error: 'no proj_id in profile' };

  // Step 2: get daily NAV
  const navR = await get(`/public/api/v2/fund/daily-info/profiles?proj_id=${encodeURIComponent(projId)}&fund_class_name=${encoded}`);

  if (!navR.data || !Array.isArray(navR.data) || !navR.data.length) {
    return { error: `no NAV data (status ${navR.status})` };
  }

  // Sort by date descending, take latest
  navR.data.sort((a, b) => (b.nav_date || b.date || '').localeCompare(a.nav_date || a.date || ''));
  const latest = navR.data[0];
  const navVal  = parseFloat(latest.last_val || latest.nav_value || latest.nav || 0);
  const navDate = (latest.nav_date || latest.date || '').substring(0, 10);

  if (!navVal || !navDate) return { error: 'invalid NAV value' };
  return { nav: navVal, nav_date: navDate };
}

async function main() {
  console.log(`Fetching NAV for ${FUND_NAMES.length} funds via fund.sec.or.th...`);
  console.log('Start:', new Date().toISOString());

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {}; }
  catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

  for (const name of FUND_NAMES) {
    const result = await fetchFundNAV(name);
    if (result.nav) {
      navData[name.toUpperCase()] = { nav: result.nav, nav_date: result.nav_date };
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: ${result.error}`);
      failed++;
    }
    await sleep(200); // 200ms between requests
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
