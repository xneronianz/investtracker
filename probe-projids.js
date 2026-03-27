/**
 * probe-projids.js v5 — Try SEC API v1 endpoint with fund_class_name
 * The v2 returned 404 but maybe v1 works differently
 * Also try the secopendata.sec.or.th endpoint
 */
const https = require('https');
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const KEY_FS = process.env.SEC_KEY_FACTSHEET;

function get(hostname, path, key) {
  return new Promise((resolve) => {
    const headers = { 'accept': 'application/json' };
    if (key) headers['Ocp-Apim-Subscription-Key'] = key;
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null, raw: body.substring(0,200) }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: body.substring(0,200) }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: null, raw: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, data: null, raw: 'timeout' }); });
    req.end();
  });
}

async function main() {
  const BASE = 'api.sec.or.th';
  const testFund = 'SCBCHA-SSF';
  const encoded = encodeURIComponent(testFund);

  console.log(`Testing various endpoints for fund: ${testFund}\n`);

  const endpoints = [
    // v1 endpoints
    [`/FundDailyInfo/v1/fund/daily-info/nav?fund_name=${encoded}`, KEY_DI],
    [`/FundDailyInfo/v1/fund/daily-info/nav?fund_class_name=${encoded}`, KEY_DI],
    // Different path formats
    [`/FundDailyInfo/fund/nav?fund_name=${encoded}`, KEY_DI],
    [`/FundDailyInfo/fund/nav?fund_class_name=${encoded}`, KEY_DI],
    // Factsheet endpoints
    [`/FundFactsheet/fund/nav?fund_name=${encoded}`, KEY_FS],
    [`/FundFactsheet/v2/fund/nav?fund_name=${encoded}`, KEY_FS],
    // Try secopendata subdomain
  ];

  for (const [path, key] of endpoints) {
    const r = await get(BASE, path, key);
    console.log(`${path.split('?')[0]}: status=${r.status} raw=${r.raw}`);
  }

  // Try secopendata.sec.or.th
  console.log('\nTrying secopendata.sec.or.th...');
  const r1 = await get('secopendata.sec.or.th', `/api/fund/nav?fund_class_name=${encoded}`, KEY_DI);
  console.log(`secopendata /api/fund/nav: status=${r1.status} raw=${r1.raw}`);

  const r2 = await get('secopendata.sec.or.th', `/sec-open-apis/fund/nav?fund_class_name=${encoded}`, KEY_DI);
  console.log(`secopendata /sec-open-apis/fund/nav: status=${r2.status} raw=${r2.raw}`);

  // Also try the old approach with a range of proj_ids but wider
  // SCBCHA-SSF target: 9.1684 — try 2566+ range which we haven't scanned
  console.log('\nScanning M0xxx_2566 range 1-200 for SCBCHA-SSF (9.1684)...');
  const DATE = '2026-03-25';
  for (let n = 1; n <= 200; n++) {
    const projId = `M${String(n).padStart(4,'0')}_2566`;
    const r = await get(BASE, `/FundDailyInfo/${projId}/dailynav/${DATE}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      if (nav > 0) {
        if (Math.abs(nav - 9.1684) < 0.005) console.log(`*** MATCH SCBCHA-SSF: ${projId} NAV=${nav}`);
        if (Math.abs(nav - 17.0167) < 0.005) console.log(`*** MATCH SCBGOLDH-SSF: ${projId} NAV=${nav}`);
        if (Math.abs(nav - 11.1788) < 0.005) console.log(`*** MATCH ABGDD-SSF: ${projId} NAV=${nav}`);
        if (Math.abs(nav - 7.3504) < 0.005) console.log(`*** MATCH UCHINA-SSF: ${projId} NAV=${nav}`);
        if (Math.abs(nav - 12.6199) < 0.005) console.log(`*** MATCH MEGA10CHINA-SSF: ${projId} NAV=${nav}`);
        if (Math.abs(nav - 18.1796) < 0.005) console.log(`*** MATCH K-CHANGE-SSF: ${projId} NAV=${nav}`);
      }
    }
    await new Promise(r => setTimeout(r, 40));
  }

  console.log('\nDone');
}

main().catch(e => console.error(e.message));
