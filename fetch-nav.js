/**
 * fetch-nav.js v4 — Auto-match fund names
 * 
 * First run: dumps all SEC fund names to sec-funds.json so you can 
 * verify name mapping. Subsequent runs: fetches NAV for matched funds.
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

// Your app's fund names (from the debug log)
const APP_FUNDS = [
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

// Fuzzy match: find closest SEC name for an app fund name
function fuzzyMatch(appName, secNames) {
  const appUp = appName.toUpperCase();
  // 1. Exact match
  if (secNames[appUp]) return appUp;
  // 2. SEC name starts with app name
  for (const sn of Object.keys(secNames)) {
    if (sn.startsWith(appUp) || appUp.startsWith(sn)) return sn;
  }
  // 3. App name without spaces/special chars
  const appClean = appUp.replace(/[\s\-\(\)]/g, '');
  for (const sn of Object.keys(secNames)) {
    if (sn.replace(/[\s\-\(\)]/g, '') === appClean) return sn;
  }
  return null;
}

async function main() {
  console.log('Building fund map from SEC database...');

  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data || !Array.isArray(amcR.data)) {
    console.error('Cannot fetch AMC list:', amcR.status);
    process.exit(1);
  }
  console.log(`${amcR.data.length} AMCs`);

  // Build complete name→projId map
  const secFunds = {}; // UPPER_NAME → proj_id
  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        if (f.proj_abbr_name && f.proj_id) {
          secFunds[f.proj_abbr_name.toUpperCase()] = {
            proj_id: f.proj_id,
            name: f.proj_abbr_name
          };
        }
      }
    }
    await sleep(80);
  }
  console.log(`SEC fund database: ${Object.keys(secFunds).length} funds`);

  // Match app funds to SEC funds
  const matched = {};
  const unmatched = [];

  for (const appName of APP_FUNDS) {
    const secKey = fuzzyMatch(appName, secFunds);
    if (secKey) {
      matched[appName] = secFunds[secKey];
      console.log(`  MATCH: ${appName} → ${secFunds[secKey].name} (${secFunds[secKey].proj_id})`);
    } else {
      unmatched.push(appName);
      console.log(`  NO MATCH: ${appName}`);
    }
  }

  console.log(`\nMatched: ${Object.keys(matched).length}, Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log('Unmatched funds:', unmatched.join(', '));
  }

  // Fetch NAV for matched funds
  const navData = {};
  let updated = 0;

  for (const [appName, fund] of Object.entries(matched)) {
    for (let i = 0; i <= 7; i++) {
      const date = dateStr(i);
      const r = await get(`/FundDailyInfo/${fund.proj_id}/dailynav/${date}`, KEY_DI);
      if (r.status === 204 || r.status === 404 || !r.data) continue;
      if (r.status === 200 && r.data) {
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        const navVal  = parseFloat(d.last_val || d.nav_value || d.nav || 0);
        const navDate = (d.nav_date || date).substring(0, 10);
        if (navVal > 0) {
          // Store under UPPERCASE key so app can find it
          navData[appName.toUpperCase()] = { nav: navVal, nav_date: navDate };
          console.log(`  ✓ ${appName}: ${navVal} (${navDate})`);
          updated++;
          break;
        }
      }
      await sleep(50);
    }
    await sleep(80);
  }

  console.log(`\nDone: ${updated} NAVs fetched`);

  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    count: updated,
    unmatched: unmatched,
    funds: navData
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
