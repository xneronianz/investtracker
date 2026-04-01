/**
 * probe-projids.js — Find proj_ids for SCBCHA-SSF (9.1539) and SCBCHA(SSFE) (9.4725)
 * Brute force scan across all year ranges
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

const DATE = '2026-03-28'; // Friday before 30 March (Sunday)
const TARGETS = [
  { name: 'SCBCHA-SSF',   nav: 9.1539 },
  { name: 'SCBCHA(SSFE)', nav: 9.5193 },
  { name: 'SCBGOLDH-SSF', nav: 17.5469 },
  { name: 'ABGDD-SSF',    nav: 11.18 },
  { name: 'UCHINA-SSF',   nav: 7.1761 },
];

async function scanRange(year, start, end) {
  console.log(`Scanning ${year} range ${start}-${end}...`);
  for (let n = start; n <= end; n++) {
    const projId = `M${String(n).padStart(4,'0')}_${year}`;
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${DATE}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      if (nav > 0) {
        for (const t of TARGETS) {
          if (Math.abs(nav - t.nav) < 0.01) {
            console.log(`  *** MATCH ${t.name}: ${projId} NAV=${nav} (${d.nav_date||DATE})`);
          }
        }
      }
    }
    await sleep(40);
  }
}

async function main() {
  console.log(`Scanning for SCBCHA-SSF (9.1539) and SCBCHA(SSFE) (9.4725) on ${DATE}`);
  // Scan all realistic year ranges
  for (const year of ['2562','2563','2564','2565','2566','2567','2568']) {
    await scanRange(year, 1, 800);
  }
  console.log('Done');
}

main().catch(e => console.error(e.message));
