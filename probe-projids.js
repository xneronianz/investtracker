/**
 * probe-projids.js — Test SEC FundDailyInfo search endpoints + fundcheck API
 */
const https = require('https');
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

function get(hostname, path, key) {
  return new Promise((resolve) => {
    const headers = { 'accept': 'application/json' };
    if (key) headers['Ocp-Apim-Subscription-Key'] = key;
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.substring(0, 200) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const FUNDS = ['SCBCHA-SSF', 'SCBCHA(SSFE)', 'SCBGOLDH-SSF', 'UCHINA-SSF', 'ABGDD-SSF'];

async function main() {
  console.log('Testing endpoints for missing SSF funds...\n');

  for (const name of FUNDS) {
    const enc = encodeURIComponent(name);
    console.log(`\n=== ${name} ===`);

    const tests = [
      [BASE, `/FundDailyInfo/fund/search?fund_name=${enc}`, KEY_DI],
      [BASE, `/FundDailyInfo/fund?fund_name=${enc}`, KEY_DI],
      [BASE, `/FundDailyInfo/search?fund_name=${enc}`, KEY_DI],
      [BASE, `/FundDailyInfo/v2/fund/search?fund_name=${enc}`, KEY_DI],
      [BASE, `/FundDailyInfo/fund/info?fund_name=${enc}`, KEY_DI],
      [BASE, `/FundFactsheet/fund?fund_name=${enc}`, KEY_FS],
      [BASE, `/FundFactsheet/fund/search?fund_name=${enc}`, KEY_FS],
      [BASE, `/FundDailyInfo/fund/class?fund_name=${enc}`, KEY_DI],
    ];

    for (const [host, path, key] of tests) {
      const r = await get(host, path, key);
      if (r.status !== 404) {
        console.log(`  ${path.split('?')[0]}: ${r.status} ${r.body.substring(0,120)}`);
      }
      await sleep(100);
    }
  }

  // Try fundcheck.sec.or.th directly
  console.log('\n=== fundcheck.sec.or.th API test ===');
  const fundcheckTests = [
    '/api/fund/nav?fund_name=SCBCHA-SSF',
    '/public/api/v2/fund/general-info/profiles?fund_class_name=SCBCHA-SSF',
    '/public/api/fund?fund_class_name=SCBCHA-SSF',
    '/api/v1/fund/nav?fund_class_name=SCBCHA-SSF',
  ];
  for (const path of fundcheckTests) {
    const r = await get('fundcheck.sec.or.th', path, null);
    console.log(`  ${path.split('?')[0]}: ${r.status} ${r.body.substring(0,120)}`);
    await sleep(300);
  }

  console.log('\nDone');
}

main().catch(e => console.error(e.message));
