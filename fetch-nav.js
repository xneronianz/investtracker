/**
 * fetch-nav.js v2 — Fast parallel fetching
 * Runs in GitHub Actions to fetch NAV from SEC Thailand API
 * Writes nav-data.json to repo root
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

// Run up to N promises concurrently
async function parallelMap(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    await sleep(200); // 200ms between batches
  }
  return results;
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('Step 1: Fetching AMC list...');
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data || !Array.isArray(amcR.data)) {
    console.error('Failed to fetch AMC list, status:', amcR.status);
    process.exit(1);
  }
  console.log(`Found ${amcR.data.length} AMCs`);

  // Step 2: Fetch all fund lists in parallel (5 at a time)
  console.log('Step 2: Building fund map in parallel...');
  const fundMap = {}; // ABBR_NAME_UPPER → proj_id

  await parallelMap(amcR.data, async (amc) => {
    if (!amc.unique_id) return;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        if (f.proj_abbr_name && f.proj_id) {
          fundMap[f.proj_abbr_name.toUpperCase()] = f.proj_id;
        }
      }
    }
  }, 5);

  console.log(`Fund map: ${Object.keys(fundMap).length} funds`);

  // Step 3: Fetch NAV for all funds in parallel (10 at a time)
  console.log('Step 3: Fetching NAV data in parallel...');
  const navData = {};
  const entries = Object.entries(fundMap);

  await parallelMap(entries, async ([name, projId]) => {
    // Try last 7 days for weekends/holidays
    for (let i = 0; i <= 7; i++) {
      const date = dateStr(i);
      const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
      if (r.status === 204 || r.status === 404 || !r.data) continue;
      if (r.status === 200 && r.data) {
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        const navVal = parseFloat(d.last_val || d.nav_value || d.nav || 0);
        const navDate = (d.nav_date || date).substring(0, 10);
        if (navVal > 0) {
          navData[name] = { nav: navVal, nav_date: navDate };
          break;
        }
      }
    }
  }, 10);

  console.log(`NAV fetched for ${Object.keys(navData).length} funds`);

  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    count: Object.keys(navData).length,
    funds: navData
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written successfully');

  // Print sample for verification
  const sample = Object.entries(navData).slice(0, 3);
  sample.forEach(([k,v]) => console.log(`  ${k}: ${v.nav} (${v.nav_date})`));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
