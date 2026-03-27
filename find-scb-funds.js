/**
 * find-scb-funds.js — Find correct proj_id for SCBCHA-SSF, SCBCHA(SSFE), SCBS&P500(SSFA)
 * GitHub Secrets: SEC_KEY_FACTSHEET
 */
const https = require('https');
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

const TARGETS = ['SCBCHA', 'SCBS&P', 'SCBSP', 'SCBS&P500'];

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
  if (!amcR.data) { console.error('Failed'); process.exit(1); }
  console.log('Searching for SCBCHA and SCBS&P500 funds...\n');

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const name = (f.proj_abbr_name || '').toUpperCase();
        if (TARGETS.some(t => name.includes(t))) {
          console.log(`${f.proj_abbr_name} | proj_id: ${f.proj_id}`);
        }
      }
    }
    await sleep(80);
  }
  console.log('\nDone');
}

main().catch(e => { console.error(e.message); process.exit(1); });
