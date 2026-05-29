/**
 * discover-proj-ids.js v2 — Uses only the DailyInfo API (same as fetch-nav.js)
 *
 * USAGE:
 *   SEC_KEY_DAILYINFO=your_key node discover-proj-ids.js
 *
 * Strategy:
 *   1. Hit /FundDailyInfo/{projId}/dailynav/{date} for recent dates
 *   2. Extract proj_abbr_name / fund_abbr_name from the response
 *   3. Match against target fund names
 *
 * IMPORTANT: All 4 target funds are RMF parent funds (not share classes),
 * so their NAVs should be directly in the DailyInfo endpoint.
 *
 * Output: paste the printed lines into fetch-nav.js FUND_MAP
 */

const https = require('https');
const KEY = process.env.SEC_KEY_DAILYINFO;
const BASE = 'api.sec.or.th';

if (!KEY) { console.error('ERROR: SEC_KEY_DAILYINFO env var required'); process.exit(1); }

const TARGETS = [
  'B-GLOBALRMF',
  'B-INNOTECHRMF',
  'KKP GNP RMF-UH',
  'TLAWSRMF',
];

// Generate recent dates to try (API only returns data for trading days)
function recentDates(n) {
  const dates = [];
  const d = new Date();
  for (let i = 1; i <= n; i++) {
    d.setDate(d.getDate() - 1);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// AMC-specific ranges based on known patterns in fetch-nav.js:
//   B-* (BBLAM/Bualuang): M0001-M0200, years 2553-2568
//   KKP*: M0001-M1000, years 2560-2568
//   TLA* (Talis): M0001-M0700, years 2560-2568
function buildScanList() {
  const entries = new Set();

  // BBLAM range (B-FUTURESSF=M0053_2563, B-INNOTECHSSF=M0078_2565 → RMF likely nearby)
  for (let y = 2558; y <= 2568; y++)
    for (let n = 1; n <= 200; n++)
      entries.add(`M${String(n).padStart(4,'0')}_${y}`);

  // KKP range (KKP EMXCN-H-SSF=M0077_2567, KKP US500=M0301_2567)
  for (let y = 2560; y <= 2568; y++)
    for (let n = 1; n <= 999; n++)
      entries.add(`M${String(n).padStart(4,'0')}_${y}`);

  // Talis range (TLA-GEQ=M0563_2568, TLFVMR=M0096_2567 → TLAWSRMF likely nearby)
  for (let y = 2560; y <= 2568; y++)
    for (let n = 1; n <= 700; n++)
      entries.add(`M${String(n).padStart(4,'0')}_${y}`);

  return Array.from(entries);
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
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extract all name-like fields from a DailyInfo response item
function extractNames(item) {
  if (!item || typeof item !== 'object') return [];
  const names = [];
  // All known name fields in SEC DailyInfo responses
  const fields = [
    'proj_abbr_name', 'fund_abbr_name', 'class_abbr_name',
    'unique_class_id', 'fund_name_th', 'fund_name_en',
    'proj_name_th', 'proj_name_en', 'abbr_name'
  ];
  for (const f of fields) {
    if (item[f] && typeof item[f] === 'string') names.push(item[f].trim());
  }
  return names;
}

async function tryProjId(projId, dates) {
  for (const date of dates) {
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`);
    if (r.status === 200 && r.data) {
      const items = Array.isArray(r.data) ? r.data : [r.data];
      const names = [];
      for (const item of items) names.push(...extractNames(item));
      if (names.length > 0) return { names, projId, date };
    }
    if (r.status === 429) {
      // Rate limited — wait 10s and retry
      console.log('  ⚠ Rate limited, waiting 10s...');
      await sleep(10000);
      const r2 = await get(`/FundDailyInfo/${projId}/dailynav/${date}`);
      if (r2.status === 200 && r2.data) {
        const items = Array.isArray(r2.data) ? r2.data : [r2.data];
        const names = [];
        for (const item of items) names.push(...extractNames(item));
        if (names.length > 0) return { names, projId, date };
      }
    }
    // 204 = no data for that date, try next date
    if (r.status !== 204 && r.status !== 404 && r.status !== 200) {
      // Unexpected status — skip this projId
      break;
    }
    await sleep(15);
  }
  return null;
}

async function main() {
  const candidates = buildScanList();
  const dates = recentDates(10); // try last 10 trading days
  const targetUpper = TARGETS.map(t => t.toUpperCase());
  console.log(`Scanning ${candidates.length} proj_ids for: ${TARGETS.join(', ')}`);
  console.log(`Using dates: ${dates.slice(0,3).join(', ')} ... (${dates.length} dates)`);
  console.log(`Estimated time: ~${Math.ceil(candidates.length * 0.06 / 60)} minutes\n`);

  const found = {};
  let scanned = 0;
  let validResponses = 0;

  // Print ALL names seen in first 50 valid responses — helps debug name format
  let samplePrinted = 0;

  for (const projId of candidates) {
    scanned++;
    const result = await tryProjId(projId, dates);

    if (result) {
      validResponses++;

      // Print first 20 valid responses as samples to understand name format
      if (samplePrinted < 20) {
        console.log(`  SAMPLE ${projId}: [${result.names.join(' | ')}]`);
        samplePrinted++;
      }

      for (const name of result.names) {
        const u = name.toUpperCase().replace(/\s+/g,' ').trim();
        for (let i = 0; i < targetUpper.length; i++) {
          if ((u === targetUpper[i] || u.includes(targetUpper[i])) && !found[TARGETS[i]]) {
            found[TARGETS[i]] = projId;
            console.log(`\n✓ FOUND: ${TARGETS[i]}  →  '${projId}'  (matched: "${name}" on ${result.date})\n`);
          }
        }
      }
    }

    if (scanned % 100 === 0) {
      console.log(`  scanned ${scanned}/${candidates.length}, valid: ${validResponses}, found: ${Object.keys(found).length}/${TARGETS.length}`);
    }

    if (Object.keys(found).length === TARGETS.length) {
      console.log('\n✓ All targets found!');
      break;
    }

    await sleep(50); // 50ms between requests — stays within rate limits
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('RESULTS — paste into fetch-nav.js FUND_MAP:');
  console.log('═══════════════════════════════════════════════════');
  for (const t of TARGETS) {
    if (found[t]) console.log(`  ['${t}',\t'${found[t]}'],`);
    else          console.log(`  // ['${t}',\t'???'],    <— NOT FOUND`);
  }

  console.log('\nTotal scanned:', scanned, '| Valid responses:', validResponses);
  if (validResponses === 0) {
    console.log('\n⚠ ZERO valid responses — possible causes:');
    console.log('  1. API key is wrong or expired');
    console.log('  2. SEC server is down');
    console.log('  3. Rate limit hit — wait 1 hour and retry');
    console.log('\nTest your key manually:');
    console.log(`  curl -H "Ocp-Apim-Subscription-Key: YOUR_KEY" \\`);
    console.log(`    "https://api.sec.or.th/FundDailyInfo/M0053_2563/dailynav/2026-05-28"`);
    console.log('  (M0053_2563 = B-FUTURESSF — known working fund from your FUND_MAP)');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
