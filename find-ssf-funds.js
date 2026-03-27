/**
 * find-ssf-funds.js — Find correct proj_id for all SSF/SSFE share classes
 * Searches entire SEC database for fund names containing SSF/SSFE
 * GitHub Secrets: SEC_KEY_FACTSHEET
 */
const https = require('https');
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
const BASE = 'api.sec.or.th';

// The funds we need correct proj_ids for
const TARGETS = [
  'ABGDD-SSF',
  'K-CHANGE-SSF',
  'KKP EMXCN-H-SSF',
  'KKP US500-UH-SSF',
  'MEGA10CHINA-SSF',
  'PRINCIPAL iPROPEN-SSF',
  'SCBAXJ(SSF)',
  'SCBCHA-SSF',
  'SCBCHA(SSFE)',
  'SCBEUROPE(SSF)',
  'SCBEUROPE(SSFE)',
  'SCBGOLDH-SSF',
  'SCBNDQ(SSF)',
  'SCBNEXT(SSFE)',
  'SCBS&P500(SSFA)',
  'SCBVIET(SSFA)',
  'SCBVIET(SSFE)',
  'TISCOCHA-SSF',
  'UCHINA-SSF',
  'UGIS-SSF',
  'UOBSA-SSF',
];

const targetSet = new Set(TARGETS.map(t => t.toUpperCase()));

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
  console.log(`Searching ${amcR.data.length} AMCs for exact SSF/SSFE fund names...\n`);

  const found = {};

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        const nameUp = (f.proj_abbr_name || '').toUpperCase();
        // Exact match
        if (targetSet.has(nameUp)) {
          found[nameUp] = { proj_id: f.proj_id, sec_name: f.proj_abbr_name };
          console.log(`EXACT: "${f.proj_abbr_name}" | proj_id: ${f.proj_id}`);
        }
        // Near match — contains SSF or SSFE
        else if ((nameUp.includes('SSF') || nameUp.includes('SSFE') || nameUp.includes('SSFA')) &&
                 TARGETS.some(t => {
                   const tBase = t.toUpperCase().replace(/-SSF.*$/, '').replace(/\(SSF.*$/, '').replace(/\(SSFE.*$/, '').replace(/\(SSFA.*$/, '');
                   return nameUp.includes(tBase.substring(0, Math.min(tBase.length, 6)));
                 })) {
          console.log(`NEAR:  "${f.proj_abbr_name}" | proj_id: ${f.proj_id}`);
        }
      }
    }
    await sleep(80);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Found exact matches for ${Object.keys(found).length} / ${TARGETS.length} funds`);
  TARGETS.forEach(t => {
    const f = found[t.toUpperCase()];
    if (f) console.log(`  ✓ ${t} → ${f.proj_id}`);
    else console.log(`  ✗ ${t} → NOT FOUND`);
  });
}

main().catch(e => { console.error(e.message); process.exit(1); });
