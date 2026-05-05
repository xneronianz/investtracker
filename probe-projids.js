/**
 * probe-projids.js — Find KKP CHINA-H-SSF proj_id
 * Target NAV: 11.0917 as of 2026-04-29
 * Known KKP SSF funds are in 2567 range: M0077_2567, M0301_2567
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

const DATE = '2026-04-29';
const TARGET_NAV = 11.0917;
const TOLERANCE = 0.005;

async function scanRange(year, start, end) {
  console.log(`Scanning ${year} range ${start}-${end}...`);
  for (let n = start; n <= end; n++) {
    const projId = `M${String(n).padStart(4,'0')}_${year}`;
    const r = await get(`/FundDailyInfo/${projId}/dailynav/${DATE}`, KEY_DI);
    if (r.status === 200 && r.data) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      const nav = parseFloat(d.last_val || 0);
      if (nav > 0 && Math.abs(nav - TARGET_NAV) < TOLERANCE) {
        console.log(`*** MATCH KKP CHINA-H-SSF: ${projId} NAV=${nav}`);
      }
    }
    await sleep(40);
  }
}

async function main() {
  console.log(`Searching for KKP CHINA-H-SSF NAV=${TARGET_NAV} on ${DATE}`);
  // Focus on 2567 first (same as other KKP SSF funds), then wider
  await scanRange('2567', 1, 600);
  await scanRange('2566', 1, 400);
  await scanRange('2568', 1, 200);
  console.log('Done');
}

main().catch(e => console.error(e.message));
