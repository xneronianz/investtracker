/**
 * fetch-nav.js v11 — Same approach as Cloudflare Worker (confirmed working)
 * Step 1: Scan AMC list to find proj_id by exact fund name match
 * Step 2: Fetch NAV by proj_id + date
 * This is exactly what the Worker does and it works.
 *
 * GitHub Secrets: SEC_KEY_FACTSHEET, SEC_KEY_DAILYINFO
 */

const https = require('https');
const fs    = require('fs');

const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_FS || !KEY_DI) {
  console.error('ERROR: Both SEC_KEY_FACTSHEET and SEC_KEY_DAILYINFO must be set');
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
        try { resolve({ status: res.statusCode, ok: res.statusCode === 200, data: body ? JSON.parse(body) : null }); }
        catch(e) { resolve({ status: res.statusCode, ok: false, data: null }); }
      });
    });
    req.on('error', e => resolve({ status: 0, ok: false, data: null }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, ok: false, data: null }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function buildProjIdMap() {
  console.log('Building proj_id map from AMC list...');
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.ok || !Array.isArray(amcR.data)) {
    throw new Error('Cannot fetch AMC list: ' + amcR.status);
  }
  console.log(`${amcR.data.length} AMCs found`);

  const needed = new Set(FUND_NAMES.map(n => n.toUpperCase()));
  const projMap = {}; // UPPER_NAME → proj_id

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.ok && Array.isArray(r.data)) {
      for (const f of r.data) {
        const nameUp = (f.proj_abbr_name || '').toUpperCase();
        if (needed.has(nameUp) && f.proj_id && !projMap[nameUp]) {
          projMap[nameUp] = f.proj_id;
          console.log(`  Found: ${f.proj_abbr_name} → ${f.proj_id}`);
        }
      }
    }
    await sleep(80);
  }

  console.log(`proj_id map: ${Object.keys(projMap).length}/${FUND_NAMES.length} funds found`);
  return projMap;
}

async function fetchNAV(projId) {
  for (let i = 0; i <= 7; i++) {
    const date = dateStr(i);
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 204 || r.status === 404 || !r.data) continue;
    if (r.ok && r.data) {
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
  console.log(`Fetching NAV for ${FUND_NAMES.length} funds (Worker method)...`);
  console.log('Start:', new Date().toISOString());

  const projMap = await buildProjIdMap();

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {}; }
  catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

  for (const name of FUND_NAMES) {
    const projId = projMap[name.toUpperCase()];
    if (!projId) {
      console.log(`  ✗ ${name}: proj_id not found in AMC list`);
      failed++;
      continue;
    }
    const result = await fetchNAV(projId);
    if (result) {
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date}) [${projId}]`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: no NAV data [${projId}]`);
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
