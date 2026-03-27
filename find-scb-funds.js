/**
 * find-scb-funds.js v2 — Find SCBCHA-SSF, SCBCHA(SSFE), SCBS&P500(SSFA)
 * Prints ALL SCBCHA and SCBSP/SCBS&P fund names to find exact match
 */
const https = require('https');
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

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

async function main() {
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data) { process.exit(1); }

  // Also try Daily Info API to find UOBSA-SSF by brute force date scan
  // We know UOB AMC is C0000000623
  // Try fetching fund list from a different endpoint

  console.log('=== All SCBCHA* and SCBS&P* funds ===\n');

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const name = (f.proj_abbr_name || '').toUpperCase();
        const projName = (f.proj_name_en || f.proj_name_th || '').toUpperCase();
        if (name.startsWith('SCBCHA') || name.includes('SCBS&P') || name.includes('SCBSP500')) {
          console.log(`"${f.proj_abbr_name}" | proj_id: ${f.proj_id} | name: ${f.proj_name_en || f.proj_name_th || ''}`);
        }
      }
    }
    await sleep(80);
  }
  console.log('\n=== Searching for UOBSA-SSF in UOB AMC (C0000000623) ===\n');
  const uobR = await get('/FundFactsheet/fund/amc/C0000000623', KEY_FS);
  if (uobR.status === 200 && Array.isArray(uobR.data)) {
    const ssf = uobR.data.filter(f => (f.proj_abbr_name||'').toUpperCase().includes('UOBSA'));
    ssf.forEach(f => console.log(`"${f.proj_abbr_name}" | proj_id: ${f.proj_id} | ${f.proj_name_en||f.proj_name_th||''}`));
    if (ssf.length === 0) {
      console.log('No UOBSA* funds found in UOB AMC via Factsheet API');
      console.log('Total UOB funds:', uobR.data.length);
      // Print all UOB fund names for reference
      uobR.data.slice(0,20).forEach(f => console.log(' -', f.proj_abbr_name, '|', f.proj_id));
    }
  }
  console.log('\nDone');
}

main().catch(e => { console.error(e.message); process.exit(1); });
