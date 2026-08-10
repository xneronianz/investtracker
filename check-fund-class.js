/**
 * check-fund-class.js — on-demand discovery tool. Given a single proj_id (via
 * the PROJ_ID env var), queries the SEC API UNFILTERED for a recent window and
 * reports every distinct fund_class_name found, with each one's latest NAV.
 *
 * This exists to close a real gap: adding a new fund previously required
 * manually guessing a fund_class_name string and typing it into the app's
 * override field, with no verification step — exactly what caused a real bug
 * (B-INNOTECHRMF override set to "INNOTECHRMF" when the actual class was
 * "main", silently breaking every fetch for that fund with zero error
 * message). This script replaces guessing with a real, displayed list of
 * classes to pick from, the same way every fund fix in this project's
 * history was actually verified — just automated and self-service now.
 *
 * Output: fund-class-check.json — { checked_at, proj_id, classes: [{name, latest_nav, latest_date, entries_seen}] }
 * or { checked_at, proj_id, error: "..." } if the lookup failed entirely.
 */

const https = require('https');
const fs = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const HOST = 'api.sec.or.th';
const PROJ_ID = process.env.PROJ_ID;

function get(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: HOST, path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': KEY_DI, 'accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); }
        catch (e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(20000, () => req.destroy());
    req.end();
  });
}

function dateStr(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function main() {
  const result = { checked_at: new Date().toISOString(), proj_id: PROJ_ID || null };

  if (!PROJ_ID) {
    result.error = 'No PROJ_ID provided.';
    fs.writeFileSync('fund-class-check.json', JSON.stringify(result, null, 2));
    console.log('No PROJ_ID provided — nothing to check.');
    return;
  }

  console.log(`Checking proj_id=${PROJ_ID} (unfiltered, last 14 days)...`);

  // 14-day unfiltered window — wide enough to catch classes that don't report
  // every single day, narrow enough to avoid pagination for a quick check.
  const startDate = dateStr(14);
  const endDate = dateStr(0);
  const path = `/v2/fund/daily-info/nav?proj_id=${encodeURIComponent(PROJ_ID)}` +
               `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=100`;

  const r = await get(path);

  if (r.status === 204) {
    result.error = `No data found for proj_id=${PROJ_ID} in the last 14 days. Double-check the Project ID is correct.`;
    console.log(result.error);
    fs.writeFileSync('fund-class-check.json', JSON.stringify(result, null, 2));
    return;
  }
  if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) {
    result.error = `SEC API returned an unexpected response (status ${r.status}). Try again in a moment.`;
    console.log(result.error);
    fs.writeFileSync('fund-class-check.json', JSON.stringify(result, null, 2));
    return;
  }
  if (r.data.items.length === 0) {
    result.error = `No data found for proj_id=${PROJ_ID} in the last 14 days. Double-check the Project ID is correct.`;
    console.log(result.error);
    fs.writeFileSync('fund-class-check.json', JSON.stringify(result, null, 2));
    return;
  }

  // Group by exact fund_class_name, keep the latest entry per class
  const byClass = {};
  r.data.items.forEach(item => {
    const cls = item.fund_class_name || '(unnamed)';
    const d = (item.nav_date || '').substring(0, 10);
    const nav = parseFloat(item.last_val || 0);
    if (!d || !(nav > 0)) return;
    if (!byClass[cls] || d > byClass[cls].latest_date) {
      byClass[cls] = { name: cls, latest_nav: nav, latest_date: d };
    }
  });
  Object.keys(byClass).forEach(cls => {
    byClass[cls].entries_seen = r.data.items.filter(i => (i.fund_class_name || '(unnamed)') === cls).length;
  });

  result.classes = Object.values(byClass).sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Found ${result.classes.length} class(es):`);
  result.classes.forEach(c => console.log(`  ${c.name}: latest ${c.latest_nav} on ${c.latest_date} (${c.entries_seen} entries in window)`));

  fs.writeFileSync('fund-class-check.json', JSON.stringify(result, null, 2));
  console.log('fund-class-check.json written');
}

main().catch(e => {
  fs.writeFileSync('fund-class-check.json', JSON.stringify({
    checked_at: new Date().toISOString(), proj_id: PROJ_ID || null, error: 'Unexpected error: ' + e.message
  }, null, 2));
  console.error(e);
});
