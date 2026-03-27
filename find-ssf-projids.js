/**
 * find-ssf-projids.js — Prints ALL fund names from ALL AMCs
 * so we can manually find the exact names SEC uses for SSF share classes
 * GitHub Secrets: SEC_KEY_FACTSHEET
 */
const https = require('https');
const fs = require('fs');
const KEY_FS = process.env.SEC_KEY_FACTSHEET;
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
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// AMCs that manage our missing funds
const TARGET_AMCS = {
  'ABGDD-SSF': 'Aberdeen',
  'ES-GINNO-SSF': 'Eastspring',
  'K-CHANGE-SSF': 'KASIKORN',
  'K-GOLD-A(A)': 'KASIKORN',
  'KKP EMXCN-H-SSF': 'KKP',
  'KKP US500-UH-SSF': 'KKP',
  'MEGA10CHINA-SSF': 'MFC',
  'ONE-UGG-ASSF': 'One Asset',
  'PRINCIPAL iPROPEN-SSF': 'Principal',
  'SCBAXJ(SSF)': 'SCB AM',
  'SCBCHA-SSF': 'SCB AM',
  'SCBGOLDH-SSF': 'SCB AM',
  'SCBS&P500(SSFA)': 'SCB AM',
  'TDSThaiESG-A': 'Tisco',
  'TISCOCHA-SSF': 'Tisco',
  'UCHINA-SSF': 'UOB',
  'UGIS-SSF': 'UOB',
  'UOBSA-SSF': 'UOB',
};

async function main() {
  const amcR = await get('/FundFactsheet/fund/amc', KEY_FS);
  console.log(`${amcR.data.length} AMCs\n`);

  const allFunds = [];

  for (const amc of amcR.data) {
    if (!amc.unique_id) continue;
    const r = await get(`/FundFactsheet/fund/amc/${amc.unique_id}`, KEY_FS);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const f of r.data) {
        allFunds.push({ name: f.proj_abbr_name, proj_id: f.proj_id, amc: amc.unique_id });
      }
    }
    await sleep(80);
  }

  // Write full list to file for inspection
  fs.writeFileSync('all-funds.json', JSON.stringify(allFunds, null, 2));
  console.log(`Total funds: ${allFunds.length}`);

  // Search for relevant funds
  const keywords = ['ABGDD', 'ESGINNO', 'ES-GINNO', 'KCHANGE', 'K-CHANGE',
    'KKP', 'MEGA10', 'ONE-UGG', 'ONEUGG', 'PRINCIPAL', 'iPROPEN',
    'SCBAXJ', 'SCBCHA', 'SCBGOLD', 'SCBSP', 'SCBS&P',
    'TDS', 'TISCO', 'UCHINA', 'UGIS', 'UOBSA'];

  console.log('\n=== Funds matching target keywords ===');
  for (const f of allFunds) {
    const nameUp = (f.name || '').toUpperCase();
    if (keywords.some(k => nameUp.includes(k.toUpperCase()))) {
      console.log(`${f.name} | ${f.proj_id}`);
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
