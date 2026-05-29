/**
 * discover-proj-ids.js v3
 *
 * USAGE: SEC_KEY_DAILYINFO=your_key node discover-proj-ids.js
 *
 * Changes from v2:
 * - First verifies API key works using 3 known funds
 * - Only tries YESTERDAY's date (not 10 dates) to keep it fast
 * - Scans a tighter range focused on BBL, KKP, Talis AMCs
 * - Completes in ~10 minutes instead of 1 hour
 */

const https = require('https');
const KEY   = process.env.SEC_KEY_DAILYINFO;
const BASE  = 'api.sec.or.th';

if (!KEY) { console.error('ERROR: SEC_KEY_DAILYINFO env var required'); process.exit(1); }

// ── Funds we need to find ───────────────────────────────────────────────────
const TARGETS = [
  'B-GLOBALRMF',
  'B-INNOTECHRMF',
  'KKP GNP RMF-UH',
  'TLAWSRMF',
];

// ── Known-working funds to verify key before scanning ───────────────────────
const KNOWN = [
  ['B-FUTURESSF',  'M0053_2563'],  // BBLAM
  ['KKP EQ THAI ESG', 'M0851_2566'], // KKP
  ['TLA-GEQ',      'M0563_2568'],  // Talis
];

// ── Date helpers ─────────────────────────────────────────────────────────────
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
// Try last 5 weekdays only (avoids weekends with no NAV)
function recentDates() {
  const out = [];
  for (let i = 1; i <= 7 && out.length < 5; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(path) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null, raw: body }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: body }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null, raw: '' }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, data: null, raw: 'TIMEOUT' }); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Try fetching NAV for a proj_id across recent dates ─────────────────────
async function tryFetch(projId, dates) {
  for (const date of dates) {
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`);
    if (r.status === 200 && r.data) {
      const items = Array.isArray(r.data) ? r.data : [r.data];
      if (items.length > 0 && items[0]) {
        // Extract all string fields — one of them will be the fund abbreviation
        const names = [];
        for (const [k, v] of Object.entries(items[0])) {
          if (typeof v === 'string' && v.trim().length > 0 && v.length < 80) {
            names.push(`${k}=${v.trim()}`);
          }
        }
        const nav = parseFloat(items[0].last_val || items[0].nav_value || items[0].nav || 0);
        return { nav, date, names, projId };
      }
    }
    if (r.status === 429) { console.log('  ⏳ Rate limited, waiting 30s...'); await sleep(30000); }
    await sleep(20);
  }
  return null;
}

// ── Scan a specific range ─────────────────────────────────────────────────────
function buildRange(nMin, nMax, years) {
  const out = [];
  for (const y of years)
    for (let n = nMin; n <= nMax; n++)
      out.push(`M${String(n).padStart(4,'0')}_${y}`);
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const dates = recentDates();
  console.log(`\nUsing dates: ${dates.join(', ')}\n`);

  // ── STEP 1: Verify API key works ─────────────────────────────────────────
  console.log('STEP 1: Testing API key with 3 known funds...\n');
  let keyWorks = false;
  for (const [name, projId] of KNOWN) {
    const r = await tryFetch(projId, dates);
    if (r && r.nav > 0) {
      console.log(`  ✓ ${name} (${projId}): NAV = ${r.nav} on ${r.date}`);
      keyWorks = true;
    } else {
      const raw = await get(`/FundDailyInfo/${projId}/dailynav/${dates[0]}`);
      console.log(`  ✗ ${name} (${projId}): status=${raw.status} body="${raw.raw.slice(0,100)}"`);
    }
    await sleep(200);
  }

  if (!keyWorks) {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('❌ API KEY NOT WORKING — cannot scan for funds.');
    console.log('═══════════════════════════════════════════════════');
    console.log('\nPossible fixes:');
    console.log('1. Go to https://developer.sec.or.th → My Applications');
    console.log('2. Regenerate your SEC_KEY_DAILYINFO subscription key');
    console.log('3. Update the secret in GitHub: Settings → Secrets → Actions');
    console.log('4. Run this workflow again\n');
    process.exit(1);
  }

  console.log('\n✓ API key works! Starting proj_id scan...\n');

  // ── STEP 2: Scan focused ranges ──────────────────────────────────────────
  // Known patterns:
  //   B-FUTURESSF    = M0053_2563  → B-GLOBALRMF/B-INNOTECHRMF nearby (BBL, 2564-2568)
  //   TLFVMR-ASIAX   = M0096_2567  → TLAWSRMF nearby (Talis, 2565-2568)
  //   KKP EQ TH ESG  = M0851_2566  → KKP GNP RMF-UH (KKP, 2563-2568)

  const ranges = [
    // BBL Asset Management (Bualuang) — B-* funds
    ...buildRange(1,   200, [2562, 2563, 2564, 2565, 2566, 2567, 2568]),
    // Talis — TLA* funds
    ...buildRange(1,   200, [2565, 2566, 2567, 2568]),
    // KKP — wider range (uses higher numbers)
    ...buildRange(200, 900, [2563, 2564, 2565, 2566, 2567, 2568]),
  ];

  // Deduplicate (ranges overlap intentionally but no need to scan twice)
  const candidates = [...new Set(ranges)];
  console.log(`Scanning ${candidates.length} candidate proj_ids...\n`);

  const found = {};
  const targetUpper = TARGETS.map(t => t.toUpperCase());
  let scanned = 0, validCount = 0, samplesPrinted = 0;

  for (const projId of candidates) {
    scanned++;
    const result = await tryFetch(projId, [dates[0], dates[1]]); // only try 2 dates for speed

    if (result && result.nav > 0) {
      validCount++;

      // Print first 5 samples so you can see the actual field names
      if (samplesPrinted < 5) {
        console.log(`  SAMPLE ${projId}: nav=${result.nav} fields: ${result.names.slice(0,6).join(', ')}`);
        samplesPrinted++;
      }

      // Match against targets — check all string fields
      for (const nameKV of result.names) {
        const val = nameKV.split('=').slice(1).join('=').toUpperCase().trim();
        for (let i = 0; i < targetUpper.length; i++) {
          if ((val === targetUpper[i] || val.replace(/\s/g,'') === targetUpper[i].replace(/\s/g,''))
              && !found[TARGETS[i]]) {
            found[TARGETS[i]] = projId;
            console.log(`\n✓ FOUND: ${TARGETS[i]}  →  '${projId}'   field: ${nameKV}\n`);
          }
        }
      }
    }

    if (scanned % 200 === 0) {
      console.log(`  scanned ${scanned}/${candidates.length} | valid responses: ${validCount} | found: ${Object.keys(found).length}/${TARGETS.length}`);
    }
    if (Object.keys(found).length === TARGETS.length) { console.log('\n✓ All found! Stopping.'); break; }
    await sleep(50);
  }

  // ── RESULTS ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('RESULTS — paste into fetch-nav.js FUND_MAP:');
  console.log('═══════════════════════════════════════════════════');
  for (const t of TARGETS) {
    if (found[t]) console.log(`  ['${t}',\t'${found[t]}'],`);
    else          console.log(`  // ['${t}',\t'???'],    <— NOT FOUND`);
  }
  console.log(`\nScanned: ${scanned} | Valid responses: ${validCount} | Matched: ${Object.keys(found).length}/${TARGETS.length}`);

  if (validCount > 0 && Object.keys(found).length < TARGETS.length) {
    console.log('\n⚠ Some funds not found. They may have slightly different name formats.');
    console.log('Check the SAMPLE lines above to see what name fields the API returns.');
    console.log('The fund name in the API may differ slightly from what you entered.');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
