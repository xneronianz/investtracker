/**
 * find-missing-funds.js
 * One-time script to find proj_id for 3 unmatched funds.
 * Run once in GitHub Actions to get the proj_id values.
 *
 * GitHub Secrets required:
 *   SEC_KEY_FACTSHEET
 */

const https = require('https');
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

const MISSING = [
  'KKP EMXCN-H-SSF',
  'KKP US500-UH-SSF', 
  'UOBSA-SSF'
];

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
  console.log('Fetching AMC list...');
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  if (!amcR.data) { console.error('Failed'); process.exit(1); }
  
  const needed = new Set(MISSING.map(n => n.toUpperCase()));
  console.log(`Searching for: ${MISSING.join(', ')}\n`);

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const nameUp = (f.proj_abbr_name || '').toUpperCase();
        // Check if this fund name contains any of our missing fund keywords
        for (const missing of MISSING) {
          const keywords = missing.toUpperCase().split(/[\s\-]+/).filter(k => k.length > 2);
          const matches = keywords.filter(k => nameUp.includes(k));
          if (matches.length >= 2) {
            console.log(`CANDIDATE for "${missing}": ${f.proj_abbr_name} | proj_id: ${f.proj_id}`);
          }
        }
      }
    }
    await sleep(80);
  }
  console.log('\nDone searching');
}

main().catch(e => { console.error(e.message); process.exit(1); });
