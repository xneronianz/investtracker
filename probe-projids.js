/**
 * probe-projids.js — Probe specific proj_ids to find correct ones
 * for SCBGOLDH-SSF and ABGDD-SSF
 */
const https = require('https');
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
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
  const date = '2026-03-25';
  
  // Probe candidates for SCBGOLDH-SSF
  // Finnomena shows 17.0167 — need to find which proj_id returns this
  const scbGoldCandidates = [
    ['M0396_2564', 'was original SCBGOLDH-SSF guess'],
    ['M0856_2553', 'SCBGOLDHFUND (old, giving 19.9179)'],
    ['M0241_2554', 'SCBGOLDFUND'],
    ['M0778_2554', 'SCBGOLDHRMF'],
  ];
  
  console.log('=== Probing SCBGOLDH-SSF candidates (target NAV ~17.0167) ===');
  for (const [projId, desc] of scbGoldCandidates) {
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      console.log(`  ${projId} (${desc}): NAV=${nav} date=${d.nav_date||date}`);
    } else {
      console.log(`  ${projId} (${desc}): status=${r.status} no data`);
    }
    await sleep(200);
  }

  // Probe candidates for ABGDD-SSF
  // Finnomena shows ~11.1788
  console.log('\n=== Probing ABGDD-SSF candidates (target NAV ~11.1788) ===');
  const abgddCandidates = [
    ['M0250_2564', 'ABGDD-M (giving 11.203)'],
    ['M0570_2565', 'ABGDD-RMF'],
    ['M0020_2539', 'original ABG parent'],
  ];
  
  for (const [projId, desc] of abgddCandidates) {
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      console.log(`  ${projId} (${desc}): NAV=${nav} date=${d.nav_date||date}`);
    } else {
      console.log(`  ${projId} (${desc}): status=${r.status} no data`);
    }
    await sleep(200);
  }
  
  // Also search all ABGDD* and SCBGOLDH* funds in factsheet
  console.log('\n=== Searching factsheet for ABGDD* and SCBGOLDH* ===');
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (amcR.data) {
    for (const amc of amcR.data) {
      if (!amc.unique_id) continue;
      const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
      if (r.status === 200 && Array.isArray(r.data)) {
        for (const f of r.data) {
          const name = (f.proj_abbr_name || '').toUpperCase();
          if (name.startsWith('ABGDD') || name.startsWith('SCBGOLDH')) {
            console.log(`  ${f.proj_abbr_name} | ${f.proj_id}`);
          }
        }
      }
      await sleep(80);
    }
  }
  console.log('\nDone');
}

main().catch(e => console.error(e.message));
