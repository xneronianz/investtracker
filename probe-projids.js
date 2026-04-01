/**
 * probe-projids.js — Try SEC FundDailyInfo search endpoints
 * These funds exist on fundcheck.sec.or.th but not in FundFactsheet API
 */
const https = require('https');
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const KEY_DI = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

function get(path, key) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BASE, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.substring(0, 300) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MISSING = [
  { name: 'SCBCHA-SSF',    secName: 'SCBCHA-SSF' },
  { name: 'SCBCHA(SSFE)',  secName: 'SCBCHA(SSFE)' },
  { name: 'SCBGOLDH-SSF',  secName: 'SCBGOLDH-SSF' },
  { name: 'UCHINA-SSF',    secName: 'UCHINA-SSF' },
  { name: 'ABGDD-SSF',     secName: 'ABGDD-SSF' },
];

async function main() {
  console.log('Testing SEC FundDailyInfo search endpoints...\n');

  for (const f of MISSING) {
    const enc = encodeURIComponent(f.secName);
    console.log(`\n=== ${f.name} ===`);

    // Try FundDailyInfo search endpoints
    const paths = [
      [`/FundDailyInfo/fund/search?fund_name=${enc}`, KEY_DI],
      [`/FundDailyInfo/fund?fund_name=${enc}`, KEY_DI],
      [`/FundDailyInfo/search?fund_name=${enc}`, KEY_DI],
      [`/FundDailyInfo/v2/fund/search?fund_name=${enc}`, KEY_DI],
      [`/FundDailyInfo/fund/info?fund_name=${enc}`, KEY_DI],
      // Try FundFactsheet with fund name directly
      [`/FundFactsheet/fund?fund_name=${enc}`, KEY_DI],
      [`/FundFactsheet/fund/search?fund_name=${enc}`, KEY_DI],
      // Try the fund class specific endpoint
      [`/FundDailyInfo/fund/class?fund_name=${enc}`, KEY_DI],
    ];

    for (const [path, key] of paths) {
      const r = await get(path, key);
      if (r.status !== 404) {
        console.log(`  ${path.split('?')[0]}: ${r.status} ${r.body.substring(0,100)}`);
      }
      await sleep(100);
    }
  }

  // Also try fetching SCBCHA-SSF directly from fundcheck API
  console.log('\n=== Testing fundcheck.sec.or.th API ===');
  const fundcheckPaths = [
    '/api/fund/nav?fund_name=SCBCHA-SSF',
    '/public/api/v2/fund/general-info/profiles?fund_class_name=SCBCHA-SSF',
    '/public/api/fund?fund_class_name=SCBCHA-SSF',
  ];
  for (const path of fundcheckPaths) {
    const req = https.request({
      hostname: 'fundcheck.sec.or.th', path, method: 'GET',
      headers: { 'accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => console.log(`  fundcheck${path.split('?')[0]}: ${res.statusCode} ${body.substring(0,100)}`));
    });
    req.on('error', e => console.log(`  fundcheck error: ${e.message}`));
    req.setTimeout(10000, () => req.destroy());
    req.end();
    await sleep(500);
  }

  console.log('\nDone');
}

main().catch(e => console.error(e.message));
