/**
 * fetch-nav.js v3 — Direct fund lookup, no AMC loop
 * Only fetches NAV for funds explicitly listed below.
 * Much faster — no AMC iteration needed.
 *
 * GitHub Secrets required:
 *   SEC_KEY_FACTSHEET  — Fund Factsheet API key  
 *   SEC_KEY_DAILYINFO  — Fund Daily Info API key
 */

const https = require('https');
const fs    = require('fs');

const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_FS || !KEY_DI) {
  console.error('ERROR: SEC_KEY_FACTSHEET and SEC_KEY_DAILYINFO must be set');
  process.exit(1);
}

// ── Your fund list — edit this if you add/remove funds ────────────────────────
// These are the proj_abbr_name values from SEC database
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
        catch(e) { resolve({ status: res.statusCode, data: null, raw: body.substring(0,100) }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: null, err: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, data: null, err: 'timeout' }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// Step 1: find proj_id for one fund by searching AMC list
// We cache all fund→projId mappings after first full scan
let projIdCache = null;

async function buildProjIdCache() {
  if (projIdCache) return projIdCache;
  console.log('Building proj_id cache from AMC list...');
  
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data || !Array.isArray(amcR.data)) {
    throw new Error('Cannot fetch AMC list: ' + amcR.status);
  }
  console.log(`${amcR.data.length} AMCs found`);

  projIdCache = {};
  let found = 0;
  const needed = new Set(FUND_NAMES.map(n => n.toUpperCase()));

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    // Stop early if we've found all needed funds
    if (found >= needed.size) {
      console.log('All funds found early, stopping AMC scan');
      break;
    }

    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const nameUp = (f.proj_abbr_name || '').toUpperCase();
        if (needed.has(nameUp) && f.proj_id) {
          projIdCache[nameUp] = f.proj_id;
          found++;
          console.log(`  Found: ${f.proj_abbr_name} → ${f.proj_id}`);
        }
      }
    }
    await sleep(100); // 100ms between AMC requests
  }

  console.log(`proj_id cache built: ${Object.keys(projIdCache).length} funds found`);
  return projIdCache;
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
    await sleep(50);
  }
  return null;
}

async function main() {
  console.log(`Fetching NAV for ${FUND_NAMES.length} funds...`);
  console.log('Start time:', new Date().toISOString());

  const cache = await buildProjIdCache();
  const navData = {};
  let updated = 0; let failed = 0;

  for (const name of FUND_NAMES) {
    const projId = cache[name.toUpperCase()];
    if (!projId) {
      console.log(`  SKIP: ${name} — not found in SEC database`);
      failed++;
      continue;
    }

    const result = await fetchNAV(projId);
    if (result) {
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: no NAV data`);
      failed++;
    }
    await sleep(100); // 100ms between funds
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`);
  console.log('End time:', new Date().toISOString());

  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    count: updated,
    funds: navData
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
