/**
 * fetch-historical-nav.js — bulk backfill of historical NAV data (default: up to
 * 10 years) for every fund in FUND_MAP + fund-overrides.json.
 *
 * Reliability hardening v4 (2026-07-17): after the v3 fix, ABGDD-SSF's entry
 * count was STILL unchanged (1032, same as before any of these fixes) despite
 * a completely clean run. Root cause found: 6-month chunks were still often
 * exceeding page_size=100 for dense funds (~108 entries/6mo for ABGDD-SSF),
 * meaning most chunks STILL required following next_cursor to a second page —
 * v2/v3 shortened the sequence length but never actually eliminated cursor
 * continuation. Separately, re-examining the user's own manual test: it also
 * had a non-empty next_cursor (>100 items existed for that window), but only
 * page 1 was ever checked — page 2 of that "proof" was never actually
 * verified either. This points at next_cursor continuation ITSELF as the
 * likely culprit, not sequence length. Fixed by shrinking chunks to 2 months
 * (~35-40 entries even for the densest funds, verified against actual entry
 * counts) — small enough that virtually every chunk should complete in a
 * single page, never invoking next_cursor at all. Added explicit logging
 * whenever a chunk DOES need a second page, to directly observe whether
 * cursor usage correlates with any remaining gaps. This roughly triples the
 * chunk count (67 vs 23 for an 11-year range) and will take noticeably
 * longer to run.
 *
 * Reliability hardening v3 (2026-07-17): the v2 chunking approach exposed a
 * NEW bug — chunks entirely before a fund's inception date (or "today" before
 * that day's NAV publishes) legitimately return HTTP 204 "No Content", which
 * the retry logic was wrongly treating as a failure, burning 3 retries per
 * empty pre-inception chunk across every fund and falsely flagging them all
 * as "POSSIBLY TRUNCATED". 204 is now treated as a clean, successful "no data
 * here" result — no retry, no truncation flag. Verified against mocked
 * pre-inception, transient-failure-then-recovery, and persistent-failure
 * scenarios.
 *
 * Reliability hardening v2 (2026-07-17): a clean re-run (0 HTTP failures per
 * the v1 retry hardening below) STILL came back with a specific ~5-month
 * window essentially empty for a fund confirmed via manual API testing to have
 * complete data there. That means the server can return valid 200 responses
 * with a chunk of records silently missing partway through a LONG continuous
 * cursor sequence — undetectable by HTTP-failure-only retry logic. Fixed by
 * splitting each fund's full date range into independent ~6-month chunks, each
 * with its own short (~1-2 page) pagination sequence, mirroring the narrow
 * query proven to work. This will take somewhat longer overall (more total
 * HTTP round-trips), trading some speed for actual data completeness.
 *
 * Reliability hardening v1 (2026-07-16): added retry-with-backoff (up to 3 attempts)
 * per paginated page, plus explicit logging of any page failure or truncation —
 * previously a single failed page silently broke pagination with zero visibility.
 * Output now includes a "truncated_funds" list flagging anything that may still
 * be incomplete after retries. NOTE: this does NOT explain a bounded gap (data
 * missing for a specific historical window with data present before AND after) —
 * that pattern, especially if consistent across multiple unrelated funds, points
 * toward a genuine gap in SEC's own historical data for that period rather than
 * a pagination bug in this script. Verify against the live API directly before
 * assuming a script fix will resolve it.
 *
 * FUND_MAP synced 2026-07-15 with fetch-nav.js v25 — all 36 class-filtered fund
 * entries now match exactly (was previously stuck at an older copy with only 18
 * class filters, meaning historical backfills for the other 18 funds were still
 * silently pulling potentially wrong/mixed-class data even after fetch-nav.js's
 * daily fetch was fixed). Keep these two FUND_MAPs in sync by hand going forward
 * — if you fix a fund's class filter in one script, mirror it in the other.
 *
 * This is DELIBERATELY SEPARATE from fetch-nav.js:
 *   - fetch-nav.js runs daily (scheduled), fetches only the LATEST NAV per fund,
 *     fast (~1 call/fund), keeps the app snappy.
 *   - fetch-historical-nav.js runs ONLY when manually triggered, fetches years
 *     of history per fund (many paginated calls/fund), can take a long time.
 * They are never meant to run on the same schedule — this script is occasional/
 * on-demand, not part of the daily cadence.
 *
 * Output: nav-history-bulk.json — { generated_at, years_back, funds: { NAME: [{date,nav}, ...] } }
 * The app merges this in itself: dates where SEC has data REPLACE the app's
 * existing value (since class-name-aware fetching is authoritative); dates
 * the app has that SEC doesn't cover are PRESERVED untouched; dates SEC has
 * that the app doesn't are ADDED. Nothing is ever deleted by this process.
 *
 * FUND_MAP below is kept in sync with fetch-nav.js's FUND_MAP by hand — if you
 * add/edit a fund in one, mirror the change in the other.
 */

const https = require('https');
const fs = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const HOST = 'api.sec.or.th';
const YEARS_BACK = parseInt(process.env.YEARS_BACK || '10', 10);

const FUND_MAP = [
  ['ABGDD-SSF',             'M0250_2564', 'ABGDD-SSF'],   // confirmed — proj_id also has ABGDD-R, ABGDD-A siblings   // confirmed
  ['ASP-ThaiESG',           'M0804_2566'],
  ['B-FUTURESSF',           'M0053_2563'],
  ['B-GLOBALRMF',           'M0495_2558'],
  ['B-INNOTECHRMF',         'M0667_2559'],
  ['B-INNOTECHSSF',         'M0078_2565'],
  ['ES-GINNO-SSF',          'M0479_2563', 'ES-GINNO-SSF'],   // confirmed — proj_id also has ES-GINNO-A sibling   // confirmed
  ['K-CHANGE-SSF',          'M0131_2562', 'K-CHANGE-SSF'],  // FIXED 2026-07-15 — proj_id has 3 classes (K-CHANGE-A(A), K-CHANGE-C(A) too); ~0.13% real divergence
  ['KFCMEGASSF',            'M0397_2565'],
  ['KFGGSSF',               'M0379_2564'],
  ['KF-LATAM',              'M0028_2553'],
  ['K-GOLD-A(A)',           'M0447_2551', 'K-GOLD-A(A)'],   // FIXED 2026-07-10 — proj_id also has K-GOLD-A(D); without class filter we were silently getting A(D)'s NAV under the A(A) name
  ['K-US500X-A(A)',         'M0257_2564', 'K-US500X-A(A)'], // FIXED 2026-07-10 — proj_id also has K-US500X-C(A); without class filter we were silently getting C(A)'s NAV under the A(A) name
  ['KKP CHINA-H-SSF',       'M0432_2565', 'KKP CHINA-H-SSF'],   // confirmed — proj_id also has KKP CHINA-H, KKP CHINA-H-F siblings   // confirmed
  ['KKP EQ THAI ESG',       'M0851_2566'],
  ['KKP GB THAI ESG',       'M0840_2566'],
  ['KKP GNP RMF-UH',        'M0369_2561'],
  ['KKP EMXCN-H-SSF',      'M0077_2567', 'KKP EMXCN-H-SSF'],  // FIXED 2026-07-15 — proj_id has 3 classes (KKP EMXCN-H, KKP EMXCN-H-M too); divergence tiny (~0.002%) but exact match costs nothing
  ['KKP US500-UH-SSF',      'M0301_2567', 'KKP US500-UH-SSF'],  // FIXED 2026-07-15 — proj_id has 4 classes (KKP US500-UH, -M, -E too); ~0.003% divergence
  ['KT-BOND',               'M0758_2554'],
  ['K-VIETNAM-SSF',         'M0511_2565'],
  ['MEGA10CHINA-SSF',       'M0682_2566', 'MEGA10CHINA-SSF'],  // FIXED 2026-07-15 — proj_id also has MEGA10CHINA-A; ~0.035% divergence
  ['ONE-UGG-ASSF',          'M0717_2558', 'ONE-UGG-ASSF'],  // FIXED 2026-07-15 — proj_id also has ONE-UGG-RA; ~0.13% divergence
  ['PRINCIPAL GOPP-SSF',    'M0166_2560', 'PRINCIPAL GOPP-SSF'],  // FIXED 2026-07-15 — proj_id has 3 classes (GOPP-A, GOPP-C too); ~1.07% real divergence, was completely unfiltered
  ['PRINCIPAL iPROPEN-SSF', 'M0625_2562', 'PRINCIPAL iPROPEN-SSF'],  // FIXED 2026-07-15 — proj_id has 4 classes (iPROPEN-A/C/D too); ~0.12% divergence
  ['SCBAXJ(SSF)',           'M0513_2564', 'SCBAXJ(SSF)'],  // FIXED 2026-07-15 — proj_id has 4 classes (A/P/E too); ~7.83% real divergence, was completely unfiltered
  ['SCBCHA-SSF',            'M0005_2558', 'SCBCHA-SSF'],     // confirmed — proj_id has 6 classes (SCBCHA, SCBCHAE, SCBCHAP, SCBCHAA too)
  ['SCBCHA(SSFE)',          'M0005_2558', 'SCBCHA(SSFE)'],   // confirmed — real divergence from SCBCHA-SSF, exact match required (SSF is a substring of SSFE)
  ['SCBCOMP',               'M0882_2554'],
  ['SCBCTECH(SSFE)',        'M0120_2564', 'SCBCTECH(SSFE)'],  // FIXED 2026-07-15 — proj_id has 5 classes (SCBCTECHA/E/P, SCBCTECH-SSF too); was unfiltered, likely picking up wrong class's NAV
  ['SCBEUROPE(SSF)',        'M0274_2564', 'SCBEUROPE(SSF)'],  // FIXED 2026-07-15 — proj_id has 5 classes; SSF vs SSFE confirmed ~4.33% real divergence, exact match required (SSF substring of SSFE)
  ['SCBEUROPE(SSFE)',       'M0274_2564', 'SCBEUROPE(SSFE)'], // FIXED 2026-07-15 — see above; SCBEUROPE(SSF)/(SSFE) previously showed IDENTICAL values (8.7625/8.7625) confirming both were getting the wrong, unfiltered "latest" class
  ['SCBGOLDH-SSF',          'M0856_2553', 'SCBGOLDH-SSF'],   // confirmed — proj_id has 5 classes total
  ['SCBGOLDH(SSFE)',        'M0856_2553', 'SCBGOLDH(SSFE)'], // confirmed — ~1.85% real divergence from SCBGOLDH-SSF
  ['SCBJAPAN(SSF)',         'M0386_2564', 'SCBJAPAN(SSF)'],  // NEW 2026-07-10 — proj_id has 4 classes (A/P too); ~3.95%/~4% real divergence confirmed by both live API test and user's historical Finnomena data
  ['SCBJAPAN(SSFE)',        'M0386_2564', 'SCBJAPAN(SSFE)'], // NEW 2026-07-10 — exact match required (SSF substring of SSFE)
  ['SCBNDQ(SSF)',           'M0311_2564', 'SCBNDQ(SSF)'],    // confirmed — proj_id has 5 classes total (A/E/P too)
  ['SCBNDQ(SSFE)',          'M0311_2564', 'SCBNDQ(SSFE)'],   // confirmed — ~1.95% real divergence, exact match required (SSF substring of SSFE)
  ['SCBNEXT(SSFE)',         'M0163_2564', 'SCBNEXT(SSFE)'],   // FIXED 2026-07-15 — proj_id has 4 classes (A/E too, plus bare "(SSF)" which is a DIFFERENT class from "(SSFE)"); ~2.14% real divergence confirmed, exact match required (SSF substring of SSFE)
  ['SCBS&P500(SSFA)',      'M0643_2555', 'SCBS&P500(SSFA)'],   // confirmed — proj_id has 6 classes total
  ['SCBS&P500(SSFE)',      'M0643_2555', 'SCBS&P500(SSFE)'],   // confirmed — ~7.2% real divergence from SSFA (NOT fee drift)
  ['SCBVIET(SSFA)',        'M0539_2564', 'SCBVIET(SSFA)'],   // confirmed — proj_id has 5 classes (A/E/SSF too — note bare "(SSF)" is a DIFFERENT class from "(SSFA)")
  ['SCBVIET(SSFE)',        'M0539_2564', 'SCBVIET(SSFE)'],   // confirmed — ~6.57% real divergence from SSFA, exact match required
  ['SCBWORLD(SSFE)',        'M0465_2564', 'SCBWORLD(SSFE)'],  // FIXED 2026-07-15 — proj_id has 5 classes (A/E/P too, plus bare "(SSF)" distinct from "(SSFE)"); ~3.78% real divergence confirmed, exact match required
  ['TDSThaiESG-A',         'M0793_2567', 'TDSThaiESG-A'],  // FIXED 2026-07-15 — proj_id also has TDSThaiESG-D; ~0.0015% divergence, exact match for future-proofing
  ['TISCOCHA-SSF',         'M0258_2562', 'TISCOCHA-SSF'],  // FIXED 2026-07-15 — proj_id also has TISCOCHA-A; ~0.03% divergence
  ['TLA-GEQ',              'M0563_2568'],
  ['TLA-GFIX',             'M0070_2569'],   // ← new: Talis Global Fixed Income
  ['TLAWSRMF',             'M0948_2568'],
  ['TLFVMR-ASIAX',         'M0096_2567'],
  ['UCHINA-SSF',            'M0533_2561', 'UCHINA-SSF'],   // confirmed — proj_id also has UCHINA (non-SSF) sibling   // confirmed
  ['UGIS-SSF',             'M0002_2560', 'UGIS-SSF'],  // FIXED 2026-07-15 — proj_id has 3 classes (UGIS-A, UGIS-N too); ~0.015% divergence
  ['UOBSA-SSF',            'M0233_2550', 'UOBSA-SSF'],  // FIXED 2026-07-15 — proj_id also has UOBSA; ~0.03% divergence
  ['UOBSD-SSF',             'M0116_2549', 'UOBSD-SSF'],  // FIXED 2026-07-15 — proj_id also has UOBSD; currently ~0% divergence (identical) but exact match added for future-proofing
];

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// Fetches one page (with retry) for a single, bounded sub-window. Kept separate
// from fetchFullHistory so each chunk gets its own independent, short pagination
// sequence — see the comment on fetchFullHistory for why this matters.
async function fetchChunk(projId, className, startDate, endDate, fundNameForLogging, chunkLabel) {
  let allItems = [];
  let cursor = '';
  let page = 0;
  const MAX_PAGES = 15; // a 6-month chunk needs at most a couple of pages normally
  const MAX_RETRIES_PER_PAGE = 3;
  let truncated = false;

  while (page < MAX_PAGES) {
    let path = `/v2/fund/daily-info/nav?proj_id=${encodeURIComponent(projId)}` +
               `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=100`;
    if (className) path += `&fund_class_name=${encodeURIComponent(className)}`;
    if (cursor) path += `&next_cursor=${encodeURIComponent(cursor)}`;

    let r = null;
    let attempt = 0;
    while (attempt < MAX_RETRIES_PER_PAGE) {
      r = await get(path);
      // HTTP 204 = "No Content" — a legitimate, successful response meaning
      // there's genuinely no data for this window (e.g. a chunk entirely
      // before the fund's inception date, or querying "today" before that
      // day's NAV has been published yet). This is NOT a failure and must
      // never be retried or flagged as truncated — doing so wasted 3 retries
      // per legitimately-empty chunk across every fund's pre-inception years.
      if (r.status === 204) break;
      if (r.status === 200 && r.data && Array.isArray(r.data.items)) break;
      attempt++;
      if (attempt < MAX_RETRIES_PER_PAGE) {
        console.log(`    ⚠ ${fundNameForLogging || projId} [${chunkLabel}]: page ${page} failed (status ${r.status}), retry ${attempt}/${MAX_RETRIES_PER_PAGE}...`);
        await sleep(500 * attempt);
      }
    }
    if (r && r.status === 204) break; // clean, legitimate end of data for this chunk
    if (!r || r.status !== 200 || !r.data || !Array.isArray(r.data.items)) {
      console.log(`    ✗ ${fundNameForLogging || projId} [${chunkLabel}]: page ${page} FAILED after ${MAX_RETRIES_PER_PAGE} attempts (status ${r ? r.status : 'no response'})`);
      truncated = true;
      break;
    }

    allItems = allItems.concat(r.data.items);
    cursor = r.data.next_cursor || '';
    page++;
    if (cursor) {
      // DIAGNOSTIC: with 2-month chunks this should be rare/never for most
      // funds — if this fires, it directly confirms whether next_cursor
      // continuation itself (not just long sequences) correlates with any
      // remaining data gaps, since we can now see exactly which chunks
      // needed it and cross-reference against what's missing afterward.
      console.log(`    ↪ ${fundNameForLogging || projId} [${chunkLabel}]: page ${page} returned ${r.data.items.length} items, following cursor to page ${page + 1}...`);
    }
    if (!cursor) break;
    await sleep(120);
  }

  if (page >= MAX_PAGES) {
    console.log(`    ⚠ ${fundNameForLogging || projId} [${chunkLabel}]: hit the ${MAX_PAGES}-page cap for this chunk`);
    truncated = true;
  }

  return { items: allItems, truncated };
}

// RELIABILITY FIX (2026-07-17): previously fetched the ENTIRE date range (up to
// 11 years) as ONE continuous cursor-paginated sequence. A manual test proved
// the SEC API has complete data for a specific window (June-Nov 2024) when
// queried narrowly and directly — but a full historical bulk run still came
// back with that window essentially empty, DESPITE reporting "0 failed" (no
// HTTP-level errors). That means the server can return valid 200 responses
// with a chunk of records silently missing partway through a LONG cursor
// sequence — something our old retry logic (which only checks for HTTP
// failures, not data completeness) could never detect or catch.
//
// The fix: split the full range into independent ~6-month chunks, each fetched
// with its OWN short, bounded pagination sequence (typically just 1-2 pages) —
// exactly mirroring the narrow query that was proven to work. If any one
// chunk's cursor sequence has an issue, it can't affect any other chunk.
async function fetchFullHistory(projId, className, yearsBack, fundNameForLogging) {
  const endDate = dateStr(0);
  const startD = new Date();
  startD.setFullYear(startD.getFullYear() - yearsBack);
  const overallStartDate = startD.toISOString().split('T')[0];

  // Build ~6-month chunk boundaries from overallStartDate to endDate
  const chunks = [];
  let chunkStart = new Date(overallStartDate);
  const finalEnd = new Date(endDate);
  while (chunkStart <= finalEnd) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setMonth(chunkEnd.getMonth() + 2); // 2 months, not 6 — see comment above fetchFullHistory
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    const actualEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;
    chunks.push({
      start: chunkStart.toISOString().split('T')[0],
      end: actualEnd.toISOString().split('T')[0]
    });
    chunkStart = new Date(actualEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  let allItems = [];
  let truncated = false;
  for (const chunk of chunks) {
    const label = `${chunk.start}→${chunk.end}`;
    const result = await fetchChunk(projId, className, chunk.start, chunk.end, fundNameForLogging, label);
    allItems = allItems.concat(result.items);
    if (result.truncated) truncated = true;
    await sleep(100); // brief pause between chunks
  }

  // Same defense-in-depth as fetch-nav.js: never trust the server's date/class
  // filtering blindly — re-validate every item client-side.
  let filtered = allItems.filter(item => {
    const d = (item.nav_date || '').substring(0, 10);
    return d >= overallStartDate && d <= endDate;
  });
  if (className) {
    const wanted = className.toUpperCase();
    filtered = filtered.filter(item => (item.fund_class_name || '').toUpperCase() === wanted);
  }

  // Dedupe by date (last-seen wins in case of any overlap across chunks/pages)
  const byDate = {};
  filtered.forEach(item => {
    const d = (item.nav_date || '').substring(0, 10);
    const nav = parseFloat(item.last_val || 0);
    if (d && nav > 0) byDate[d] = nav;
  });

  return {
    history: Object.keys(byDate).sort().map(date => ({ date, nav: byDate[date] })),
    truncated: truncated
  };
}

async function main() {
  // Apply the same override mechanism as fetch-nav.js: fund-overrides.json
  // (pushed by the app's Fund Details "SEC Project ID / Fund Class" fields)
  // takes priority over the hardcoded FUND_MAP above, per fund.
  let overrides = {};
  try {
    const raw = JSON.parse(fs.readFileSync('fund-overrides.json', 'utf8'));
    overrides = raw.overrides || {};
    console.log(`Loaded ${Object.keys(overrides).length} fund override(s) from fund-overrides.json`);
  } catch (e) {}

  const effectiveMap = FUND_MAP.map(([name, projId, className]) => {
    const ov = overrides[name];
    if (ov && ov.proj_id) return [name, ov.proj_id, ov.fund_class || undefined];
    return [name, projId, className];
  });
  const mappedNames = new Set(FUND_MAP.map(e => e[0]));
  for (const [name, ov] of Object.entries(overrides)) {
    if (!mappedNames.has(name) && ov.proj_id) {
      effectiveMap.push([name, ov.proj_id, ov.fund_class || undefined]);
    }
  }

  console.log(`Fetching ${YEARS_BACK}-year historical NAV for ${effectiveMap.length} funds...`);
  console.log('This can take a long time (many paginated calls per fund) — that is expected.');
  console.log('Start:', new Date().toISOString());

  const result = {};
  const truncatedFunds = [];
  let okCount = 0, failCount = 0;

  for (const [name, projId, className] of effectiveMap) {
    try {
      const { history, truncated } = await fetchFullHistory(projId, className, YEARS_BACK, name);
      if (history.length > 0) {
        result[name.toUpperCase()] = history;
        const flag = truncated ? '  ⚠ POSSIBLY TRUNCATED' : '';
        console.log(`  ✓ ${name}: ${history.length} entries (${history[0].date} → ${history[history.length - 1].date})${flag}`);
        if (truncated) truncatedFunds.push(name);
        okCount++;
      } else {
        console.log(`  ✗ ${name}: no historical data returned`);
        failCount++;
      }
    } catch (e) {
      console.log(`  ✗ ${name}: error — ${e.message}`);
      failCount++;
    }
    await sleep(150); // pace between funds
  }

  console.log(`\nDone: ${okCount} funds fetched, ${failCount} failed`);
  if (truncatedFunds.length > 0) {
    console.log(`⚠ ${truncatedFunds.length} fund(s) had a page failure or hit the page cap — re-run may be needed for: ${truncatedFunds.join(', ')}`);
  }
  console.log('End:', new Date().toISOString());

  fs.writeFileSync('nav-history-bulk.json', JSON.stringify({
    generated_at: new Date().toISOString(),
    years_back: YEARS_BACK,
    truncated_funds: truncatedFunds,
    funds: result
  }));
  console.log('nav-history-bulk.json written');
}

main().catch(e => { console.error(e); process.exit(1); });
