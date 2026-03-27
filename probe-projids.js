/**
 * probe-projids.js v4 — Brute force scan near parent proj_ids
 * SCBGOLDH parent: M0856_2553 → scan M0xxx_2564 range for NAV ~17.0167
 * ABGDD parent: M0250_2564 → scan nearby for NAV ~11.1788
 * SCBCHA parent: M0005_2558 → scan M0xxx_2564 range for NAV ~9.1684
 *
 * Strategy: The SSF share classes were created around 2563-2565 (2020-2022)
 * Scan proj_ids in that year range for the target NAV values
 */
const https = require('https');
const KEY_DI = process.env.SEC_KEY_DAILYINFO;
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
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DATE = '2026-03-25';
const TARGETS = [
  { name: 'SCBGOLDH-SSF', nav: 17.0167 },
  { name: 'ABGDD-SSF',    nav: 11.1788 },
  { name: 'SCBCHA-SSF',   nav: 9.1684  },
];

async function scanRange(yearSuffix, startNum, endNum) {
  console.log(`\nScanning M0xxx_${yearSuffix} range ${startNum}–${endNum}...`);
  for (let n = startNum; n <= endNum; n++) {
    const projId = `M${String(n).padStart(4,'0')}_${yearSuffix}`;
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${DATE}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      if (nav > 0) {
        for (const t of TARGETS) {
          if (Math.abs(nav - t.nav) < 0.005) {
            console.log(`  *** MATCH ${t.name}: ${projId} NAV=${nav}`);
          }
        }
      }
    }
    await sleep(40);
  }
}

async function main() {
  console.log('Brute-force scanning for SSF proj_ids...');
  console.log(`Target NAVs on ${DATE}:`);
  TARGETS.forEach(t => console.log(`  ${t.name}: ${t.nav}`));

  // SCB SSF funds were registered around 2563-2565 (2020-2022)
  // SCBGOLDH-SSF, SCBCHA-SSF likely in 2564 range
  await scanRange('2563', 1, 600);
  await scanRange('2564', 1, 600);
  await scanRange('2565', 1, 300);

  console.log('\nDone');
}

main().catch(e => console.error(e.message));
