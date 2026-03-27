/**
 * fetch-nav.js v9
 * Uses api.sec.or.th FundDailyInfo with fund_name parameter directly
 * This endpoint supports share class names like ABGDD-SSF, SCBCHA-SSF etc.
 *
 * GitHub Secrets required:
 *   SEC_KEY_DAILYINFO  — Fund Daily Info API key
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_DI) {
  console.error('ERROR: SEC_KEY_DAILYINFO must be set');
  process.exit(1);
}

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
    req.on('error', e => resolve({ status: 0, data: null, err: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, data: null, err: 'timeout' }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchByFundName(name) {
  // Use the v2 endpoint that accepts fund_name (share class name)
  const encoded = encodeURIComponent(name);
  const r = await get(`/FundDailyInfo/v2/fund/daily-info/nav?fund_name=${encoded}`, KEY_DI);
  if (r.status === 200 && Array.isArray(r.data) && r.data.length > 0) {
    r.data.sort((a, b) => (b.nav_date||b.date||'').localeCompare(a.nav_date||a.date||''));
    const d = r.data[0];
    const nav  = parseFloat(d.last_val || d.nav_value || d.nav || 0);
    const date = (d.nav_date || d.date || '').substring(0, 10);
    if (nav > 0 && date) return { nav, nav_date: date };
  }
  return null;
}

async function main() {
  console.log(`Fetching NAV for ${FUND_NAMES.length} funds via FundDailyInfo v2...`);
  console.log('Start:', new Date().toISOString());

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {}; }
  catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

  for (const name of FUND_NAMES) {
    const result = await fetchByFundName(name);
    if (result) {
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: not found`);
      failed++;
    }
    await sleep(150);
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`);

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
