/**
 * fetch-nav.js
 * Runs in GitHub Actions — fetches latest NAV for all funds from SEC Thailand API
 * and writes nav-data.json to the repo root.
 *
 * Environment variables (set as GitHub Secrets):
 *   SEC_KEY_FACTSHEET  — Fund Factsheet API key
 *   SEC_KEY_DAILYINFO  — Fund Daily Info API key
 */

const https = require('https');
const fs    = require('fs');

const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_FS || !KEY_DI) {
  console.error('ERROR: SEC_KEY_FACTSHEET and SEC_KEY_DAILYINFO must be set as secrets');
  process.exit(1);
}

// HTTP GET helper
function get(path, key) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE,
      path,
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'accept': 'application/json'
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null });
        } catch(e) {
          resolve({ status: res.statusCode, data: null, raw: body.substring(0, 200) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('Fetching AMC list...');
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data || !Array.isArray(amcR.data)) {
    console.error('Failed to fetch AMC list:', amcR.status, amcR.raw);
    process.exit(1);
  }
  console.log(`Found ${amcR.data.length} AMCs`);

  // Build full fund map: abbr_name → proj_id
  console.log('Building fund map...');
  const fundMap = {}; // proj_abbr_name → proj_id

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    try {
      const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
      if (r.status === 200 && Array.isArray(r.data)) {
        for (const f of r.data) {
          if (f.proj_abbr_name && f.proj_id) {
            fundMap[f.proj_abbr_name.toUpperCase()] = f.proj_id;
          }
        }
      }
      await sleep(50);
    } catch(e) {
      console.warn(`AMC ${amc.unique_id} failed:`, e.message);
    }
  }
  console.log(`Fund map built: ${Object.keys(fundMap).length} funds`);

  // Fetch NAV for each fund in the map
  // Try last 7 days to handle weekends/holidays
  const navData = {}; // proj_abbr_name → { nav, nav_date }
  let count = 0;

  for (const [name, projId] of Object.entries(fundMap)) {
    for (let i = 0; i <= 7; i++) {
      const date = dateStr(i);
      try {
        const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
        if (r.status === 204 || r.status === 404 || !r.data) continue;
        if (r.status === 200 && r.data) {
          const d = Array.isArray(r.data) ? r.data[0] : r.data;
          const navVal = parseFloat(d.last_val || d.nav_value || d.nav || 0);
          const navDate = (d.nav_date || date).substring(0, 10);
          if (navVal > 0) {
            navData[name] = { nav: navVal, nav_date: navDate };
            count++;
            break;
          }
        }
      } catch(e) {
        // skip
      }
      await sleep(30);
    }
    await sleep(50);
  }

  console.log(`NAV fetched for ${count} funds`);

  // Write output
  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    funds: navData
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written successfully');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
