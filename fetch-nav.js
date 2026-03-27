/**
 * fetch-nav.js v14
 * SEC DailyInfo API for 37 funds + Cloudflare Worker for 3 missing funds
 * (SCBCHA-SSF, SCBGOLDH-SSF, ABGDD-SSF not in SEC Factsheet API)
 *
 * GitHub Secrets: SEC_KEY_DAILYINFO
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';
const WORKER = 'investtracker.shn-xneronianz.workers.dev';

if (!KEY_DI) { console.error('ERROR: SEC_KEY_DAILYINFO must be set'); process.exit(1); }

// Verified proj_ids from SEC database
const FUND_MAP = [
  ['ABGDD-SSF',             'WORKER'],     // not in SEC — use Cloudflare Worker
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
  ['MEGA10CHINA-SSF',       'M0682_2566'],
  ['ONE-UGG-ASSF',          'M0717_2558'],
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562'],
  ['SCBAXJ(SSF)',           'M0513_2564'],
  ['SCBCHA-SSF',            'WORKER'],     // not in SEC — use Cloudflare Worker
  ['SCBCHA(SSFE)',          'M0005_2558'], // SSFE class uses parent proj_id
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564'],
  ['SCBEUROPE(SSF)',        'M0274_2564'],
  ['SCBEUROPE(SSFE)',       'M0274_2564'],
  ['SCBGOLDH-SSF',          'WORKER'],     // not in SEC — use Cloudflare Worker
  ['SCBNDQ(SSF)',           'M0311_2564'],
  ['SCBNEXT(SSFE)',         'M0163_2564'],
  ['SCBS&P500(SSFA)',       'M0643_2555'],
  ['SCBVIET(SSFA)',         'M0539_2564'],
  ['SCBVIET(SSFE)',         'M0539_2564'],
  ['SCBWORLD(SSFE)',        'M0465_2564'],
  ['TDSThaiESG-A',         'M0793_2567'],
  ['TISCOCHA-SSF',         'M0258_2562'],
  ['TLA-GEQ',              'M0563_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',           'M0533_2561'],
  ['UGIS-SSF',             'M0002_2560'],
  ['UOBSA-SSF',            'M0233_2550'],
];

function secGet(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': KEY_DI, 'accept': 'application/json' }
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

function workerGet(fundName) {
  return new Promise((resolve) => {
    const path = `/nav?fund_name=${encodeURIComponent(fundName)}`;
    const req = https.request({
      hostname: WORKER, path, method: 'GET',
      headers: { 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: null, err: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchFromSEC(projId) {
  for (let i = 0; i <= 7; i++) {
    const date = dateStr(i);
    const r = await secGet(`/FundDailyInfo/${projId}/dailynav/${date}`);
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

async function fetchFromWorker(name) {
  const r = await workerGet(name);
  if (r.status === 200 && Array.isArray(r.data) && r.data.length > 0) {
    const d = r.data[0];
    const nav  = parseFloat(d.last_val || d.nav_value || d.nav || 0);
    const date = (d.nav_date || '').substring(0, 10);
    if (nav > 0 && date) return { nav, nav_date: date };
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
    let result = null;
    if (projId === 'WORKER') {
      result = await fetchFromWorker(name);
      if (result) console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date}) [Worker]`);
      else console.log(`  ✗ ${name}: Worker failed`);
    } else {
      result = await fetchFromSEC(projId);
      if (result) console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      else console.log(`  ✗ ${name}: no NAV data`);
    }

    if (result) { navData[name.toUpperCase()] = result; updated++; }
    else failed++;
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
