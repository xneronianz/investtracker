/**
 * probe-projids.js — Test Finnomena API endpoints for missing funds
 * Finnomena fund codes found from their website pages
 */
const https = require('https');

function get(hostname, path, headers = {}) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: { 'accept': 'application/json', 'User-Agent': 'Mozilla/5.0', ...headers }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.substring(0, 500) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

// Finnomena fund codes from their website
const FUNDS = [
  { name: 'SCBCHA-SSF',    code: 'F000017HYC' },
  { name: 'SCBCHA(SSFE)',  code: null },  // need to fetch
  { name: 'SCBGOLDH-SSF', code: null },
  { name: 'UCHINA-SSF',   code: null },
  { name: 'ABGDD-SSF',    code: 'F00001CO3S' },
];

async function main() {
  console.log('Testing Finnomena API endpoints...\n');

  // Try various API patterns with SCBCHA-SSF code F000017HYC
  const code = 'F000017HYC';
  const endpoints = [
    `/fn3/api/fund/public/${code}/nav/latest`,
    `/fn3/api/fund/public/nav?fund=${code}`,
    `/fn3/api/fund/${code}/nav/latest`,
    `/api/fund/public/${code}/nav/latest`,
    `/fn3/api/fund/public/SCBCHA-SSF/nav/latest`,
    `/fn3/api/fund/nav?symbol=SCBCHA-SSF`,
    `/fn3/api/fund/public/nav/latest?symbol=SCBCHA-SSF`,
  ];

  for (const path of endpoints) {
    const r = await get('www.finnomena.com', path);
    console.log(`${path.substring(0,50)}: ${r.status} ${r.body.substring(0,80)}`);
    await new Promise(r => setTimeout(r, 200));
  }

  // Also try the Morningstar ID (F000017HYC starts with F = Morningstar format)
  // Try Morningstar direct API
  console.log('\nTrying Morningstar API...');
  const msEndpoints = [
    `/api/rest/v2/security/F000017HYC/nav`,
    `/api/rest/v3/security/F000017HYC/navs`,
  ];
  for (const path of msEndpoints) {
    const r = await get('api.morningstar.com', path);
    console.log(`morningstar${path.substring(0,40)}: ${r.status} ${r.body.substring(0,80)}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

main().catch(e => console.error(e.message));
