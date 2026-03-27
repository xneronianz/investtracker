/**
 * fetch-nav.js v13 — Updated with correct proj_ids from full SEC dump
 * GitHub Secrets: SEC_KEY_DAILYINFO
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_DI) { console.error('ERROR: SEC_KEY_DAILYINFO must be set'); process.exit(1); }

// All proj_ids verified from full SEC AMC dump on 2026-03-27
// Format: [app_fund_name, proj_id, sec_name_for_reference]
const FUND_MAP = [
  ['ABGDD-SSF',             'M0250_2564'],  // ABGDD-M (closest — SSF not in DB)
  ['ASP-ThaiESG',           'M0804_2566'],
  ['B-FUTURESSF',           'M0053_2563'],
  ['B-INNOTECHSSF',         'M0078_2565'],
  ['ES-GINNO-SSF',          'M0038_2564'],  // T-ES-GINNO-SSF (FIXED from M0479_2563)
  ['K-CHANGE-SSF',          'M0131_2562'],  // K-CHANGE
  ['KFCMEGASSF',            'M0397_2565'],
  ['KFGGSSF',               'M0379_2564'],
  ['KF-LATAM',              'M0028_2553'],
  ['K-GOLD-A(A)',           'M0447_2551'],
  ['KKP EQ THAI ESG',       'M0851_2566'],
  ['KKP GB THAI ESG',       'M0840_2566'],
  ['KKP EMXCN-H-SSF',      'M0077_2567'],  // KKP EMXCN-H FUND
  ['KKP US500-UH-SSF',      'M0301_2567'],  // KKP US500-UH FUND
  ['KT-BOND',               'M0758_2554'],
  ['K-VIETNAM-SSF',         'M0511_2565'],
  ['MEGA10CHINA-SSF',       'M0682_2566'],  // MEGA10CHINA (FIXED from M0595_2565)
  ['ONE-UGG-ASSF',          'M0717_2558'],  // ONE-UGG
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562'],  // PRINCIPAL iPROPEN
  ['SCBAXJ(SSF)',           'M0513_2564'],  // SCBAXJ
  ['SCBCHA-SSF',            'M0005_2558'],  // SCBCHAFUND
  ['SCBCHA(SSFE)',          'M0005_2558'],  // SCBCHAFUND
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564'],
  ['SCBEUROPE(SSF)',        'M0274_2564'],
  ['SCBEUROPE(SSFE)',       'M0274_2564'],
  ['SCBGOLDH-SSF',          'M0856_2553'],  // SCBGOLDHFUND (FIXED from M0396_2564)
  ['SCBNDQ(SSF)',           'M0311_2564'],
  ['SCBNEXT(SSFE)',         'M0163_2564'],
  ['SCBS&P500(SSFA)',       'M0643_2555'],  // SCBS&P500FUND
  ['SCBVIET(SSFA)',         'M0539_2564'],
  ['SCBVIET(SSFE)',         'M0539_2564'],
  ['SCBWORLD(SSFE)',        'M0465_2564'],
  ['TDSThaiESG-A',         'M0793_2567'],  // TDSThaiESG
  ['TISCOCHA-SSF',         'M0258_2562'],  // TISCOCHA
  ['TLA-GEQ',              'M0563_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',           'M0533_2561'],  // UCHINA-M (FIXED from M0628_2563)
  ['UGIS-SSF',             'M0002_2560'],  // UGIS
  ['UOBSA-SSF',            'M0233_2550'],  // UOBSA-M
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
  for (let i = 0; i <= 7; i++) {
    const date = dateStr(i);
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 204 || r.status === 404 || !r.data) continue;
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav  = parseFloat(d.last_val || d.nav_value || d.nav || 0);
      const date2 = (d.nav_date || date).substring(0, 10);
      if (nav > 0) return { nav, nav_date: date2 };
    }
    await sleep(30);
  }
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
