/**
 * probe-projids.js v3 — Comprehensive probe for all 4 wrong funds
 * Checks multiple dates to find exact NAV matches
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

// Print NAV for all dates in last 7 days for a proj_id
async function probeAllDates(projId, desc, targetNav) {
  const results = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date('2026-03-27'); d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0];
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${date}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(row.last_val || 0);
      if (nav > 0) results.push(`${date}=${nav}`);
    }
    await sleep(50);
  }
  const matchDay = results.find(s => Math.abs(parseFloat(s.split('=')[1]) - targetNav) < 0.005);
  const flag = matchDay ? ' ← MATCH!' : '';
  if (results.length > 0) {
    console.log(`  ${projId} (${desc}): ${results.join(' | ')}${flag}`);
  } else {
    console.log(`  ${projId} (${desc}): no data`);
  }
}

// Scan ALL funds from a specific AMC for a target NAV
async function scanAllFundsForNAV(targetNav, label, keyword) {
  console.log(`\n=== Full scan for ${label} (target NAV ~${targetNav}) ===`);
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data) { console.log('AMC list failed'); return; }
  
  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const name = (f.proj_abbr_name || '').toUpperCase();
        if (!keyword || name.includes(keyword.toUpperCase())) {
          const nr = await get(`/FundDailyInfo/${f.proj_id}/dailynav/2026-03-25`, KEY_DI);
          if (nr.status === 200 && nr.data) {
            const row = Array.isArray(nr.data) ? nr.data[0] : nr.data;
            const nav = parseFloat(row.last_val || 0);
            if (Math.abs(nav - targetNav) < 0.02) {
              console.log(`  *** MATCH: ${f.proj_abbr_name} | ${f.proj_id} | NAV=${nav}`);
            }
          }
          await sleep(80);
        }
      }
    }
    await sleep(80);
  }
}

async function main() {
  // === SCBCHA-SSF: target 9.1684 ===
  console.log('=== SCBCHA-SSF candidates (target: 9.1684) ===');
  await probeAllDates('M0005_2558', 'SCBCHAFUND', 9.1684);
  await probeAllDates('M0341_2564', 'prev guess M0341', 9.1684);

  // === KKP US500-UH-SSF: target 11.4498 ===
  console.log('\n=== KKP US500-UH-SSF candidates (target: 11.4498) ===');
  await probeAllDates('M0301_2567', 'KKP US500-UH FUND current', 11.4498);
  await probeAllDates('M0298_2567', 'KKP US500-H FUND', 11.4498);
  await probeAllDates('M0869_2568', 'KKP US500 RMF-UH', 11.4498);
  await probeAllDates('M0965_2567', 'KKP EWUS500-UH', 11.4498);

  // === SCBGOLDH-SSF: target 17.0167 ===
  console.log('\n=== SCBGOLDH-SSF candidates (target: 17.0167) ===');
  await probeAllDates('M0396_2564', 'original guess', 17.0167);
  await probeAllDates('M0856_2553', 'SCBGOLDHFUND', 17.0167);

  // === ABGDD-SSF: target 11.1788 ===
  console.log('\n=== ABGDD-SSF candidates (target: 11.1788) ===');
  await probeAllDates('M0250_2564', 'ABGDD-M', 11.1788);
  await probeAllDates('M0570_2565', 'ABGDD-RMF', 11.1788);

  // Full NAV scan for SCBGOLDH (~17.0167) - scan all SCB funds
  await scanAllFundsForNAV(17.0167, 'SCBGOLDH-SSF', 'SCBGOLD');

  // Full NAV scan for ABGDD (~11.1788) - scan all ABGDD funds
  await scanAllFundsForNAV(11.1788, 'ABGDD-SSF', 'ABGDD');

  // Full NAV scan for SCBCHA (~9.1684) - scan all SCBCHA funds
  await scanAllFundsForNAV(9.1684, 'SCBCHA-SSF', 'SCBCHA');

  // Full NAV scan for KKP US500 (~11.4498)
  await scanAllFundsForNAV(11.4498, 'KKP US500-UH-SSF', 'KKP US500');

  console.log('\nDone');
}

main().catch(e => console.error(e.message));
