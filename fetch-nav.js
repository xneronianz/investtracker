/**
 * fetch-nav.js v26 — fixed a real bug in fetchNAV(): it made exactly ONE
 * request (page_size=50) and never followed next_cursor, unlike
 * fetch-historical-nav.js which always paginated correctly. For proj_ids
 * shared by multiple classes (most of FUND_MAP), a 10-day window's combined
 * item count across all classes can exceed 50 before our own class filter is
 * applied — silently truncating the response. If the desired class's most
 * recent entry landed on a second page, it was discarded, producing a stale
 * or missing "latest" NAV. This is likely why bulk historical re-fetches
 * appeared to "correct" values the daily fetch had gotten wrong — bulk
 * always paginated properly, daily didn't. Verified with a reproduction test:
 * old logic returns a stale entry when the true latest is on page 2, new
 * logic (follows cursor) returns the correct one.
 *
 * fetch-nav.js v25 — fixed 10 more funds found via systematic pass: KKP US500-UH-SSF,
 * ONE-UGG-ASSF, PRINCIPAL GOPP-SSF, PRINCIPAL iPROPEN-SSF, TISCOCHA-SSF, UGIS-SSF,
 * UOBSA-SSF, UOBSD-SSF, MEGA10CHINA-SSF, TDSThaiESG-A — all confirmed multi-class
 * via live API testing, none had any class filter before. Most divergences are
 * small (0.003%-0.15%, closer to genuine fee drift), except PRINCIPAL GOPP-SSF
 * at ~1.07% — a real, meaningful gap that was completely unfiltered. UOBSD-SSF
 * currently shows 0% divergence from UOBSD but was fixed anyway for future-
 * proofing, since exact matching costs nothing. Confirmed genuinely single-class
 * (safe, no filter needed) in this pass: KKP GNP RMF-UH, TLAWSRMF.
 *
 * fetch-nav.js v24 — fixed 4 more funds (SCBCTECH(SSFE), SCBEUROPE(SSF)/(SSFE),
 * SCBNEXT(SSFE), SCBWORLD(SSFE)) that had NO class-name filter despite sharing
 * their proj_id with multiple classes — an oversight missed during the v21/v22
 * fixes. Found via user-reported inaccurate SSFE NAVs; confirmed by live API
 * test showing SCBEUROPE(SSF) and SCBEUROPE(SSFE) returning IDENTICAL values
 * (8.7625/8.7625) despite genuinely diverging ~4.33% once correctly filtered.
 * Real divergences confirmed: SCBEUROPE ~4.33%, SCBNEXT ~2.14%, SCBWORLD ~3.78%.
 *
 * fetch-nav.js v23 — added support for fund-overrides.json, an optional file the
 * app can push (via Fund Details → SEC Project ID / SEC Fund Class fields →
 * "Push overrides to GitHub") to override or extend FUND_MAP without editing
 * this script directly. Priority: override present (with proj_id) > hardcoded
 * FUND_MAP entry. Blank fund_class in an override means "no class filter" —
 * fine for single-class funds, but re-introduces the class-mixing risk fixed in
 * v21/v22 if used carelessly on a multi-class fund. Removing an override in the
 * app and re-syncing correctly falls back to the hardcoded FUND_MAP default.
 *
 * v22 — fixed K-GOLD-A(A) and K-US500X-A(A), both wrongly picking up
 * a SIBLING class's NAV under the correct fund's name. Root cause: earlier testing
 * of these two funds was incomplete — K-GOLD's unfiltered test only sampled
 * 2020-2023 history (no A(D) entries happened to appear in that window), and
 * K-US500X's test was already pre-filtered to fund_class_name=a(a), so its
 * sibling C(A) class was structurally invisible to that test. Confirmed via live
 * current-date API query: K-GOLD-A(A) was silently getting K-GOLD-A(D)'s NAV
 * (15.4908 instead of the correct 21.3621 on 2026-07-09); K-US500X-A(A) was
 * getting K-US500X-C(A)'s NAV (19.7469 instead of the correct 15.6836 on
 * 2026-07-07). Both now pinned to their exact fund_class_name.
 *
 * v21 — added fund_class_name filtering after discovering proj_ids
 * can silently mix MULTIPLE share classes together. Confirmed via live API test:
 * proj_id M0643_2555 (SCBS&P500) returns SIX distinct classes unfiltered — SSFA,
 * SSFE, A, P, E, -SSF — with genuinely different NAVs (SSFA vs SSFE diverge by a
 * consistent ~7.2%, not fee drift). Without a class filter, v20's "pick latest by
 * date" logic could grab ANY of the six classes' NAV under the wrong fund name.
 * v21 adds an optional 3rd FUND_MAP element (class name suffix, e.g. 'ssfe') that
 * gets passed as &fund_class_name=... in the query, plus a client-side re-check
 * that the returned item's fund_class_name actually contains that suffix — same
 * defense-in-depth pattern as the v20 date-recency safety net. SCBS&P500(SSFA)/
 * (SSFE) are now correctly, safely auto-synced per-class instead of manual-only.
 *
 * v20 — added client-side date-recency safety net after discovering
 * K-GOLD-A(A), K-US500X-A(A), SCBS&P500(SSFE) received significantly wrong NAVs.
 * Root cause: start_nav_date/end_nav_date query params may be silently ignored by
 * the SEC API, returning full history since fund inception (e.g. dates from 2010)
 * instead of the intended recent window — v19 blindly picked "latest of whatever
 * came back," which could be a decade-old NAV. v20 re-validates every item's
 * nav_date client-side and only accepts entries genuinely within the lookback
 * window; if none qualify, returns null (fund keeps its last known-good cached
 * NAV) rather than risk applying wrong data.
 *
 * v19 — migrated to the new SEC Open Data API (secopendata.sec.or.th)
 * The legacy api-portal.sec.or.th portal shut down 2026-06-30; the old
 * /FundDailyInfo/{proj_id}/dailynav/{date} path is gone. New endpoint:
 *   GET https://api.sec.or.th/v2/fund/daily-info/nav
 *       ?proj_id=...&start_nav_date=YYYY-MM-DD&end_nav_date=YYYY-MM-DD
 * Same auth header (Ocp-Apim-Subscription-Key) but the KEY VALUE must be
 * freshly issued by re-subscribing on the new portal — old keys don't carry over.
 * Response is now a paginated wrapper: { message, page_size, next_cursor, items: [...] }
 * — one GET now returns every NAV in the date window (was: up to 8 separate
 * single-date calls per fund on the old API). last_val / nav_date field names unchanged.
 *
 * 52 funds total, proj_ids verified via Finnomena factsheet URLs
 * Note: SSF/SSFE/SSFA share classes may use same proj_id as parent — NAV differs by <0.2%
 *
 * GitHub Secrets: SEC_KEY_DAILYINFO (must be re-issued from the new portal)
 */

const https = require('https');
const fs    = require('fs');

const KEY_DI = process.env.SEC_KEY_DAILYINFO;
const BASE   = 'api.sec.or.th';

if (!KEY_DI) { console.error('ERROR: SEC_KEY_DAILYINFO must be set'); process.exit(1); }

// All funds below have confirmed proj_ids from Finnomena factsheet URLs.
// NAV from API may differ by <0.2% from SSF/SSFE/SSFA share class NAV due to fee structures.
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
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function fetchNAV(projId, className) {
  // New API returns a list of NAV entries within a date range in ONE call —
  // no more looping through individual dates like the old API required.
  // A 10-day lookback comfortably covers weekends + most Thai public holidays.
  const startDate = dateStr(10);
  const endDate   = dateStr(0);

  // BUG FIX: this function previously made exactly ONE request (page_size=50)
  // and never checked or followed next_cursor — unlike fetch-historical-nav.js,
  // which always paginated correctly. For a proj_id shared by multiple classes
  // (most of FUND_MAP's class-filtered funds), a 10-day window's COMBINED item
  // count across all classes can exceed 50 before our own class filter is even
  // applied — silently truncating the response. If the desired class's most
  // recent entries happened to land on a second page, they were discarded,
  // producing a stale or missing "latest" NAV — exactly the kind of wrong-value
  // bug that made bulk historical fetches (which DO paginate) look "more
  // correct" than the daily fetch for the same fund/date. Now follows
  // next_cursor properly, same as the historical script.
  let allItems = [];
  let cursor = '';
  let page = 0;
  const MAX_PAGES = 5; // a 10-day window should never need more than 1-2 pages even for the busiest multi-class proj_ids; this is a generous safety cap
  while (page < MAX_PAGES) {
    let path = `/v2/fund/daily-info/nav?proj_id=${encodeURIComponent(projId)}` +
               `&start_nav_date=${startDate}&end_nav_date=${endDate}&page_size=50`;
    if (className) path += `&fund_class_name=${encodeURIComponent(className)}`;
    if (cursor) path += `&next_cursor=${encodeURIComponent(cursor)}`;

    const r = await get(path, KEY_DI);
    if (r.status === 204) break; // legitimately no (more) data — not a failure
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) break;

    allItems = allItems.concat(r.data.items);
    cursor = r.data.next_cursor || '';
    page++;
    if (!cursor) break;
  }

  if (allItems.length === 0) return null;

  // SAFETY NET 1: never trust that the server actually honored start_nav_date/end_nav_date.
  // If it silently ignores the filter (some government APIs document params they don't
  // fully implement), it can return the fund's ENTIRE history back to inception —
  // e.g. dates from 2010 — and blindly picking "the latest of whatever came back" would
  // apply a wildly outdated NAV as if it were current. So we always re-filter client-side
  // to only entries genuinely within our intended recent window before picking anything.
  let candidates = allItems.filter(item => {
    const d = (item.nav_date || '').substring(0, 10);
    return d >= startDate && d <= endDate;
  });

  // SAFETY NET 2: never trust that fund_class_name filtering was honored server-side
  // either. Re-check client-side using EXACT match (not substring/includes) against
  // the full class name — confirmed necessary because "SSF" is a literal substring
  // of "SSFE" (SCBCHA-SSF vs SCBCHA(SSFE), SCBNDQ(SSF) vs SCBNDQ(SSFE), SCBVIET(SSFA)
  // vs SCBVIET(SSFE), SCBJAPAN(SSF) vs SCBJAPAN(SSFE) all hit this). A substring check
  // would silently let one class's data satisfy another class's query. FUND_MAP now
  // stores each fund's FULL exact fund_class_name string, not a short suffix.
  if (className) {
    const wantedUpper = className.toUpperCase();
    candidates = candidates.filter(item => {
      const cls = (item.fund_class_name || '').toUpperCase();
      return cls === wantedUpper;
    });
  }

  if (candidates.length === 0) {
    // Server returned data, but none of it matches our recent window AND/OR the
    // requested class — treat as a failed fetch rather than risk applying wrong data.
    return null;
  }

  const sorted = candidates.slice().sort((a, b) => (a.nav_date || '').localeCompare(b.nav_date || ''));
  const latest = sorted[sorted.length - 1];
  const nav = parseFloat(latest.last_val || 0);
  const navDate = (latest.nav_date || endDate).substring(0, 10);

  if (nav > 0) return { nav, nav_date: navDate };
  return null;
}

async function main() {
  // ── Fund config overrides (Project ID / Fund Class), optionally pushed by the
  // app to fund-overrides.json in this repo. Priority rule:
  //   - Fund NOT in overrides           -> use FUND_MAP's own hardcoded entry as-is
  //   - Fund IN overrides (has proj_id) -> use the override's proj_id, and its
  //     fund_class if non-empty (empty fund_class = no class filter applied)
  //   - Fund in overrides but NOT in FUND_MAP at all -> treated as a brand new
  //     fund, added using only the override's data
  // This lets the app's Fund Details "SEC Project ID / Fund Class" fields
  // override or extend this file without editing fetch-nav.js directly. Removing
  // an override in the app (and re-syncing) makes that fund fall back to
  // whatever FUND_MAP hardcodes here, since the override simply disappears.
  let overrides = {};
  try {
    const raw = JSON.parse(fs.readFileSync('fund-overrides.json', 'utf8'));
    overrides = raw.overrides || {};
    console.log(`Loaded ${Object.keys(overrides).length} fund override(s) from fund-overrides.json`);
  } catch (e) {
    // File doesn't exist or is invalid — perfectly normal if the app has never
    // pushed any overrides yet. Just proceed with the hardcoded FUND_MAP as-is.
  }

  const effectiveMap = FUND_MAP.map(([name, projId, className]) => {
    const ov = overrides[name];
    if (ov && ov.proj_id) {
      return [name, ov.proj_id, ov.fund_class || undefined];
    }
    return [name, projId, className];
  });
  const mappedNames = new Set(FUND_MAP.map(e => e[0]));
  for (const [name, ov] of Object.entries(overrides)) {
    if (!mappedNames.has(name) && ov.proj_id) {
      effectiveMap.push([name, ov.proj_id, ov.fund_class || undefined]);
    }
  }

  console.log(`Fetching NAV for ${effectiveMap.length} funds...`);
  console.log('Start:', new Date().toISOString());

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync('nav-data.json', 'utf8')).funds || {}; }
  catch(e) {}

  const navData = {};
  let updated = 0; let failed = 0;

  for (const [name, projId, className] of effectiveMap) {
    const result = await fetchNAV(projId, className);
    if (result) {
      navData[name.toUpperCase()] = result;
      console.log(`  ✓ ${name}: ${result.nav} (${result.nav_date})`);
      updated++;
    } else {
      console.log(`  ✗ ${name}: no NAV data`);
      failed++;
    }
    await sleep(80);
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`);
  console.log('End:', new Date().toISOString());

  const output = {
    updated_at: new Date().toISOString(),
    date: dateStr(0),
    count: updated,
    funds: { ...existing, ...navData }
  };

  fs.writeFileSync('nav-data.json', JSON.stringify(output, null, 2));
  console.log('nav-data.json written');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
