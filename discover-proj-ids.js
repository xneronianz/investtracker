/**
 * discover-proj-ids.js — One-time helper to find SEC proj_ids for new funds.
 *
 * USAGE:
 *   SEC_KEY_DAILYINFO=your_key node discover-proj-ids.js
 *
 * Or run in GitHub Actions manually (workflow_dispatch trigger).
 *
 * Approach: tries the SEC FundFactsheet endpoint for each candidate proj_id
 * in narrow AMC-specific year/number ranges. Reports matches to console.
 * Scans ~6000 candidates @ 30ms each ≈ 3 minutes.
 *
 * Output: paste the printed proj_ids into fetch-nav.js FUND_MAP.
 */

const https = require('https');
const KEY = process.env.SEC_KEY_DAILYINFO;
const BASE = 'api.sec.or.th';

if (!KEY) {
  console.error('ERROR: SEC_KEY_DAILYINFO env var required');
  process.exit(1);
}

// Funds we're hunting for (case-insensitive match against API response).
const TARGETS = [
  'B-GLOBALRMF',
  'B-INNOTECHRMF',
  'KKP GNP RMF-UH',
  'TLAWSRMF',
];

// AMC-specific scan ranges based on patterns in existing FUND_MAP:
//   BBL Asset funds (B-*): M0001-M0200, years 2553-2568
//   KKP funds: M0001-M0999, years 2563-2568
//   Talis (TLA*): M0500-M0700, years 2563-2568
// We dedupe and union these so the scan does each proj_id only once.
function buildScanList() {
  const set = new Set();
  // BBL
  for (let y = 2553; y <= 2568; y++) {
    for (let n = 1; n <= 200; n++) set.add(`M${String(n).padStart(4, '0')}_${y}`);
  }
  // KKP
  for (let y = 2563; y <= 2568; y++) {
    for (let n = 1; n <= 999; n++) set.add(`M${String(n).padStart(4, '0')}_${y}`);
  }
  // Talis
  for (let y = 2563; y <= 2568; y++) {
    for (let n = 500; n <= 700; n++) set.add(`M${String(n).padStart(4, '0')}_${y}`);
  }
  return Array.from(set);
}

function get(path) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Try both common SEC endpoints to extract a fund's abbreviation/name.
async function getFundName(projId) {
  // Endpoint 1: class_fund — usually returns class-level info incl. abbreviations
  const r1 = await get(`/FundFactsheet/fund/class_fund/${projId}`);
  if (r1.status === 200 && r1.data) {
    const items = Array.isArray(r1.data) ? r1.data : [r1.data];
    const names = [];
    for (const it of items) {
      for (const k of ['fund_abbr_name','proj_abbr_name','class_abbr_name','unique_class_id','fund_name','proj_name']) {
        if (it && it[k]) names.push(String(it[k]));
      }
    }
    if (names.length) return names;
  }
  // Endpoint 2: factsheet via DailyInfo — sometimes includes proj name
  const r2 = await get(`/FundDailyInfo/${projId}/dailynav/${new Date().toISOString().slice(0,10)}`);
  if (r2.status === 200 && r2.data) {
    const items = Array.isArray(r2.data) ? r2.data : [r2.data];
    const names = [];
    for (const it of items) {
      for (const k of ['proj_abbr_name','fund_abbr_name','class_abbr_name','unique_class_id']) {
        if (it && it[k]) names.push(String(it[k]));
      }
    }
    if (names.length) return names;
  }
  return null;
}

async function main() {
  const candidates = buildScanList();
  console.log(`Scanning ${candidates.length} candidate proj_ids for: ${TARGETS.join(', ')}`);
  console.log(`Estimated time: ~${Math.ceil(candidates.length * 0.05 / 60)} minutes\n`);

  const found = {};
  const targetUpper = TARGETS.map(t => t.toUpperCase());
  let scanned = 0, hits = 0;

  for (const projId of candidates) {
    scanned++;
    const names = await getFundName(projId);
    if (names) {
      hits++;
      for (const n of names) {
        const u = n.toUpperCase().trim();
        for (let i = 0; i < targetUpper.length; i++) {
          if (u === targetUpper[i] && !found[TARGETS[i]]) {
            found[TARGETS[i]] = projId;
            console.log(`\n✓ FOUND: ${TARGETS[i]}  →  '${projId}'   (matched name: "${n}")\n`);
          }
        }
      }
    }
    if (scanned % 200 === 0) {
      console.log(`  scanned ${scanned}/${candidates.length}, valid responses: ${hits}, matched: ${Object.keys(found).length}/${TARGETS.length}`);
    }
    if (Object.keys(found).length === TARGETS.length) {
      console.log('\nAll targets found, stopping scan.');
      break;
    }
    await sleep(30);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('RESULTS — paste these into fetch-nav.js FUND_MAP:');
  console.log('═══════════════════════════════════════════════════');
  for (const t of TARGETS) {
    if (found[t]) console.log(`  ['${t}',\t'${found[t]}'],`);
    else          console.log(`  // ['${t}',\t'???'],    <— NOT FOUND, may need manual lookup`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
