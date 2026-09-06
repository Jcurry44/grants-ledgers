(function () {
  'use strict';
  const DATA = window[document.documentElement.dataset.blob || 'OISHEI_DATA'];
  if (!DATA || !DATA.grants) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">Ledger data failed to load.</p>';
    return;
  }
  const YEARS = DATA.meta.years;
  const tieout = DATA.meta.tieout;
  const LATEST = YEARS[YEARS.length - 1];
  const PREV = YEARS.length > 1 ? YEARS[YEARS.length - 2] : null;   // a one-year record has no prior year

  // ---------- rows ----------
  // A small book embeds every row. A big one embeds a preview (its largest rows) and
  // names the full list in data-rows-src; that file is fetched while the meta-driven
  // page renders, and every row-derived figure is derived again when it lands. Until
  // then nothing row-derived is shown as a fact -- it waits, and says so.
  const ROOT_DS = document.documentElement.dataset;
  const ROWS_SRC = ROOT_DS.rowsSrc || null;
  const ROWS_TOTAL = Number(ROOT_DS.rowsTotal || ROOT_DS.n || DATA.grants.length);
  let rowsPending = ROWS_SRC !== null && DATA.grants.length < ROWS_TOTAL;
  let grants = DATA.grants, namedGrants, unitemized, namedTotal;
  let entities, aliasToId, entList, mergedEntities;
  let byYear, median, top5Share, latestDelta;
  let catTotals, catList;
  let firstYearOf, newIn, returningIn, movers;
  const incompleteYear = (y) => unitemized.some((g) => g.y === y);

  // ---------- formatting ----------
  // Money is written one way on this page. Filed amounts are whole dollars but derived
  // figures need not be (an even-count median lands on a half dollar), so a fractional
  // value keeps its cents rather than printing a bare "$219,950.5"; and a refund row --
  // 990-PF schedules do carry them -- reads "\u2212$948,215", never "$-948,215".
  const money = (n) => {
    let v = Number(n);
    if (!isFinite(v)) v = 0;
    const cents = Math.abs(v - Math.round(v)) > 1e-9;
    if (!cents) v = Math.round(v);                      // also normalises -0 to 0
    return (v < 0 ? '\u2212$' : '$') + Math.abs(v).toLocaleString('en-US',
      cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            : { maximumFractionDigits: 0 });
  };
  // Compact money, magnitude-general: K, M, B, T. Three significant figures, and the
  // unit is chosen AFTER rounding, so $999,999,999 promotes to $1.00B instead of
  // printing "$1000M" -- the defect that made a $6,311,161,824 year read "$6311.2M".
  // Below $10,000 the exact figure is both shorter and truer, so it is printed in full.
  const COMPACT_UNITS = [[1e3, 'K'], [1e6, 'M'], [1e9, 'B'], [1e12, 'T']];
  const moneyCompact = (n) => {
    const v = isFinite(Number(n)) ? Number(n) : 0;
    const a = Math.abs(v);
    if (a < 1e4) return money(v);
    let i = Math.max(0, Math.min(COMPACT_UNITS.length - 1, Math.floor(Math.log10(a) / 3) - 1));
    let s;
    for (;;) {
      const q = a / COMPACT_UNITS[i][0];
      s = q.toFixed(i === 0 ? 0 : (q < 9.995 ? 2 : 1));
      if (+s < 1000 || i === COMPACT_UNITS.length - 1) break;
      i++;                                              // rounding crossed the unit
    }
    return (v < 0 ? '\u2212$' : '$') + s + COMPACT_UNITS[i][1];
  };
  // Axis ticks are round numbers by construction, so they carry no trailing zeros and
  // abbreviate from $1K -- one axis must not read "$0, $5,000, $10K".
  const moneyTick = (v) => {
    if (v === 0) return '$0';
    const a = Math.abs(v);
    if (a < 1e3) return money(v);
    let i = Math.max(0, Math.min(COMPACT_UNITS.length - 1, Math.floor(Math.log10(a) / 3) - 1));
    let s;
    for (;;) {
      s = String(+(a / COMPACT_UNITS[i][0]).toFixed(2));
      if (+s < 1000 || i === COMPACT_UNITS.length - 1) break;
      i++;
    }
    return (v < 0 ? '\u2212$' : '$') + s + COMPACT_UNITS[i][1];
  };
  // A share of a total that can be zero -- or negative, once refund rows net out -- is
  // not a percentage. Nothing is printed rather than "NaN%" or "Infinity%".
  const share = (part, whole, unit, dp) => {
    if (!(whole > 0)) return '\u2014';
    const d = dp === undefined ? 1 : dp;
    const p = part / whole * 100;
    const s = p.toFixed(d);
    const u = unit === undefined ? '%' : unit;
    // a figure too small to round to the last place is not zero, and a refund that
    // rounds to zero is not "\u22120.00%" -- it is less than the smallest place shown
    if (+s === 0 && p !== 0) return (p < 0 ? '\u2212' : '') + '<' + Math.pow(10, -d).toFixed(d) + u;
    return s.replace('-', '\u2212') + u;
  };
  // Year-over-year change against a prior year of zero has no honest sign or size.
  const yoyPct = (cur, prev) => (typeof prev === 'number' && prev > 0) ? (cur - prev) / prev * 100 : null;
  // Bar widths are a geometry, not a figure: never negative, never past the track.
  const barPct = (v, max) => max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0;
  // Counts group their thousands, exactly as dollars do: a page that prints
  // "4,155 of 4155 recipients" in one sentence has two conventions and no rule.
  const num = (n) => Number(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const grantsWord = (n) => unitemized.length ? (n === 1 ? 'filed row' : 'filed rows') : (n === 1 ? 'grant' : 'grants');
  // n-safe language: this template was authored around one foundation with five filed
  // years and hundreds of recipients. Small ledgers are common (a single grant, a single
  // filed year), so every counted noun agrees with its number and no count is ever negative.
  const NUMWORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const numWord = (n) => (Number.isInteger(n) && n >= 0 && n < NUMWORDS.length) ? NUMWORDS[n] : Number(n).toLocaleString('en-US');
  const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, one, many) => (n === 1 ? one : (many || one + 's'));
  const orgsWord = (n) => plural(n, 'organization');
  const recipWord = (n) => plural(n, 'recipient');
  // tax periods FILED (and reconciled) -- not the same as years that carry grant rows:
  // a foundation can file five 990-PFs and pay grants in only one of them.
  const FILED_YEARS = Object.keys(tieout).length || YEARS.length;
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia('(max-width: 719px)').matches;

  // ---------- display casing (as-filed preserved in titles) ----------
  const _KEEPUP = new Set(['LLC','LLP','PLLC','PC','II','III','IV','YMCA','YWCA','BOCES','SUNY','WNY','CTNY','USA','NFTA','ECMC','ECC','WNED','WBFO','NY','DBA','LISC','JRO','AKG','AK360','MSNT','DEI']);
  const _SMALL = new Set(['of','and','the','for','in','at','on','to','a','an','de']);
  const _ACRO = new Set();
  const learnAcronyms = (rows) => rows.forEach((g) => {
    String(g.r + ' ' + g.p).replace(/\(([A-Z][A-Z0-9&-]{1,5})\)/g, (m, a) => {
      if (!['THE','A','AN','OF','AND','FOR','IN','TO','ON','AT','INC'].includes(a)) _ACRO.add(a);
      return m;
    });
  });
  const dc = (s) => String(s).split(/\s+/).map((w, i) => {
    const lead = (w.match(/^[("']+/) || [''])[0];
    const trail = (w.match(/[)"',.:]+$/) || [''])[0];
    const core = w.slice(lead.length, w.length - trail.length || undefined);
    if (!core) return w;
    const up = core.toUpperCase();
    if (_KEEPUP.has(up) || _ACRO.has(up)) return lead + up + trail;
    if (/\d/.test(core)) return w;
    const lower = core.toLowerCase();
    if (i > 0 && !lead && _SMALL.has(lower)) return lower + trail;
    let out = lower.replace(/^mc(\w)/, (m, c) => 'Mc' + c.toUpperCase());
    out = out.replace(/^o'(\w)/, (m, c) => "O'" + c.toUpperCase());
    out = out.replace(/^d'(\w)/, (m, c) => "D'" + c.toUpperCase());
    out = out.charAt(0).toUpperCase() + out.slice(1);
    out = out.replace(/([\/-])(\w)/g, (m, d, c) => d + c.toUpperCase());
    return lead + out + trail;
  }).join(' ');

  // ---------- canonical recipients ----------
  // Reviewed merges only: identical org filed under name variants (parenthetical
  // DBA/acronym, leading/trailing THE, INC punctuation). Method + list shown in
  // Methodology. Everything else stays a distinct as-filed entity.
  function canonKey(n) {
    let k = n.toUpperCase();
    k = k.replace(/\s*\([^)]*\)\s*/g, ' ');
    k = k.replace(/[^A-Z0-9 ]/g, ' ');
    k = k.replace(/\b(INC|LLC|LTD|CORP|CO|THE)\b/g, ' ');
    return k.replace(/\s+/g, ' ').trim();
  }
  const REVIEWED = new Set(window.LEDGER_MERGES || []);   // the page's confirmed merges
  const GRAND = DATA.meta.grand_total;
  // canonical recipients and the derived analytics are built by deriveModel(), below the
  // purpose rules they depend on -- once for an embedded book, twice for a fetched one

  // purpose taxonomy — two published steps. Step 1: keywords in the filed purpose,
  // field categories before mechanism categories (a scholarship for a science hall
  // is education; "capital campaign" alone is capital). Step 2: when the purpose
  // names no field at all, the same field words are read against the recipient's
  // filed name. No rule, no guess: the rest stays in "Other filed purposes."
  // The Methodology mapping table renders FROM these arrays — table and classifier
  // cannot drift apart.
  const NTEE_MAP = window.LEDGER_NTEE || null;         // the page's recipient-classification tier, if any
  const CAT_OTHER = 'Other filed purposes';
  const CAT_SUBJECTS = [
    { key: 'Education & youth',
      kw: 'SCHOLARSHIP|\\bSCHOOL|ACADEM|COLLEGE|\\bEDUCATION|STUDENT|\\bYOUTH\\b|\\bSTEM\\b|TEACHER|SAY YES|MENTOR|EARLY CHILDHOOD|LITERACY|K-12|K-8|PRE-K|PRESCHOOL|CLASSROOM|TUTORING|AFTER[- ]?SCHOOL|\\bLEARNING\\b|CHILD ?CARE|CITY YEAR|BOYS AND MEN OF COLOR|\\bPREP\\b|BOYS & GIRLS CLUB|BOYS AND GIRLS CLUB' },
    { key: 'Health & wellbeing',
      kw: '\\bHEALTHY?\\b|HOSPITAL|MEDICAL|\\bMRI\\b|PATIENT|CANCER|HOSPICE|BEHAVIORAL|MENTAL|WELLNESS|NURSING|CLINIC|RECOVERY RESIDENCE|RECOVERY CENTER|ADDICTION|AUTISM|DISABILIT|RESPITE|CAREGIVER|\\bBLIND\\b|\\bDEAF\\b|THERAPEUT|\\bTRAUMA\\b|EMERGENCY DEPARTMENT|PSYCHIATR|WRAPAROUND' },
    { key: 'Basic needs & response',
      kw: 'BASIC HUMAN NEEDS|\\bFOOD\\b|HUNGER|\\bMEALS?\\b|HOUSING|HOMELESS|SHELTER|SAFETY[- ]?NET|POVERTY|REFUGEE|COVID|EMERGENCY|\\bRELIEF\\b|RESPONSE FUND|DISASTER|CRISIS|CHILD ADVOCACY|DOMESTIC VIOLENCE|VETERAN|BUFFALO TOGETHER FUND|\\bPANTR' },
    { key: 'Arts & culture',
      kw: '\\bARTS?\\b|\\bMUSIC\\b|THEATRE|THEATER|MUSEUM|CULTURAL|HERITAGE|ORCHESTRA|PHILHARMONIC|GALLERY|\\bFILM\\b|\\bDANCE\\b|\\bOPERAS?\\b|EXHIBIT|ARTIST|BOTANICAL|\\bZOO\\b|AQUARIUM|BROADCASTING|HISTORY|HISTORIC' },
    { key: 'Community & economic development',
      kw: 'ECONOMIC|REVITALIZ|NEIGHBORHOOD|WORKFORCE|ENTREPRENEUR|SMALL BUSINESS|CORRIDOR|MOBILITY|\\bJOBS?\\b|EMPLOYMENT|COMMUNITY DEVELOPMENT|MAIN STREET|\\bPARKS?\\b|GARDEN|PLAYGROUND|WATERFRONT|CIVIC|DIGITAL DIVIDE|BROADBAND|TRANSPORTATION|\\bTRAINING\\b|INCUBATOR|TOURISM|OPEN4' },
    { key: 'Nonprofit capacity & transitions',
      kw: 'CAPACITY|TRANSITION FUND|NONPROFIT SUPPORT|MERGER|AFFILIATION|SHARED SPACE|SHARED SERVICES|COLLABORATIVE|BACK[- ]?OFFICE|STRATEGIC PLAN|TECHNICAL ASSISTANCE|LEADERSHIP DEVELOPMENT|ACCOUNTING' }
  ];
  const CAT_MECHANISMS = [
    { key: 'Capital & facilities',
      kw: 'CAPITAL|CONSTRUCTION|RENOVAT|FACILIT|BUILDING|NAMING RIGHTS|RELOCATION|\\bROOF\\b|HVAC|RESTORATION|ACCESSIBILITY' },
    { key: 'General operating',
      kw: 'OPERATING|OPERATIONAL|OPERATIONS|GENERAL SUPPORT|ANNUAL FUND|ANNUAL SUPPORT|UNRESTRICTED' },
    { key: 'Endowment', kw: 'ENDOWMENT' }
  ];
  { const extra = window.LEDGER_EXTRA_RULES || {};        // the page's extra keywords, in front of the shared rules
    for (const c of CAT_SUBJECTS.concat(CAT_MECHANISMS)) if (extra[c.key]) c.kw = extra[c.key] + '|' + c.kw; }
  CAT_SUBJECTS.forEach((c) => { c.rx = new RegExp(c.kw); });
  CAT_MECHANISMS.forEach((c) => { c.rx = new RegExp(c.kw); });
  function catInfoOf(g) {
    if (g.record_type === 'unitemized') return { key: 'Unitemized disclosures', step: 0 };
    if (g._ci) return g._ci;
    const P = g.p.toUpperCase();
    let res = null;
    for (const c of CAT_SUBJECTS) if (c.rx.test(P)) { res = { key: c.key, step: 1 }; break; }
    if (!res) for (const c of CAT_MECHANISMS) if (c.rx.test(P)) { res = { key: c.key, step: 1 }; break; }
    if (!res) {
      const R = g.r.toUpperCase();
      for (const c of CAT_SUBJECTS) if (c.rx.test(R)) { res = { key: c.key, step: 2 }; break; }
    }
    if (!res && NTEE_MAP && NTEE_MAP[g.r]) res = { key: NTEE_MAP[g.r], step: 3 };
    g._ci = res || { key: CAT_OTHER, step: 0 };
    return g._ci;
  }
  function catOf(g) { return catInfoOf(g).key; }
  const CAT_SHADES = ['#432708', '#5d370d', '#7a4a13', '#96601f', '#b0782f', '#c79045', '#d9aa64', '#e7c28b', '#f1d7b2'];
  const catColorOf = (k) => { const c = catList.find((x) => x.key === k); return c ? c.color : '#c9c2ae'; };
  const entYearSum = (e, y) => e.grants.filter((g) => g.y === y).reduce((s, g) => s + g.a, 0);

  // ---------- the model: every row-derived figure, from whichever rows are in hand ----------
  // complete=false means these are the embedded preview rows: the canonical-recipient map,
  // categories and movers are then provisional, and the per-year figures come from the filed
  // tie-out (which the self-check proves the rows agree with once the full list is in).
  function deriveModel(rows, complete) {
    grants = rows;
    namedGrants = grants.filter((g) => g.record_type !== 'unitemized');
    unitemized = grants.filter((g) => g.record_type === 'unitemized');
    namedTotal = namedGrants.reduce((sum, g) => sum + g.a, 0);
    learnAcronyms(grants);

    // canonical id -> entity {id, display, aliases:Set(as-filed), grants, total, count, years}
    entities = new Map();
    aliasToId = new Map();
    {
      const byFiled = new Map();
      namedGrants.forEach((g) => {
        if (!byFiled.has(g.r)) byFiled.set(g.r, []);
        byFiled.get(g.r).push(g);
      });
      const clusters = new Map();
      [...byFiled.keys()].forEach((name) => {
        const k = canonKey(name);
        const id = REVIEWED.has(k) ? 'k:' + k : 'n:' + name;
        if (!clusters.has(id)) clusters.set(id, []);
        clusters.get(id).push(name);
      });
      clusters.forEach((names, id) => {
        // display name: the variant with the largest dollars (parenthetical stripped for merged)
        let best = names[0], bestTot = -1;
        names.forEach((n) => {
          const t = byFiled.get(n).reduce((s, g) => s + g.a, 0);
          if (t > bestTot) { bestTot = t; best = n; }
        });
        let display = best;
        if (names.length > 1) display = display.replace(/\s*\([^)]*\)\s*$/, '').trim();
        const ent = { id, display, aliases: names.slice().sort(), grants: [], total: 0, count: 0, years: new Set() };
        names.forEach((n) => {
          aliasToId.set(n, id);
          byFiled.get(n).forEach((g) => {
            ent.grants.push(g); ent.total += g.a; ent.count++; ent.years.add(g.y);
          });
        });
        entities.set(id, ent);
      });
    }
    entList = [...entities.values()].sort((a, b) => b.total - a.total);
    mergedEntities = entList.filter((e) => e.aliases.length > 1);

    // ---------- derived analytics ----------
    byYear = {};
    YEARS.forEach((y) => { byYear[y] = { count: 0, sum: 0 }; });
    grants.forEach((g) => { byYear[g.y].count++; byYear[g.y].sum += g.a; });
    if (!complete) {
      YEARS.forEach((y) => {
        const t = tieout[String(y)];
        if (t && typeof t.grant_sum === 'number' && typeof t.grant_count === 'number') byYear[y] = { count: t.grant_count, sum: t.grant_sum };
      });
    }

    const sortedAmts = namedGrants.map((g) => g.a).sort((a, b) => a - b);
    median = !sortedAmts.length ? null : sortedAmts.length % 2
      ? sortedAmts[(sortedAmts.length - 1) / 2]
      : (sortedAmts[sortedAmts.length / 2 - 1] + sortedAmts[sortedAmts.length / 2]) / 2;
    top5Share = entList.slice(0, 5).reduce((s, e) => s + e.total, 0) / GRAND;
    latestDelta = PREV === null ? null : (byYear[LATEST].sum - byYear[PREV].sum) / byYear[PREV].sum;

    catTotals = new Map();
    grants.forEach((g) => {
      const info = catInfoOf(g);
      if (!catTotals.has(info.key)) catTotals.set(info.key, { sum: 0, count: 0, s2sum: 0, s2count: 0 });
      const t = catTotals.get(info.key);
      t.sum += g.a; t.count++;
      if (info.step === 2) { t.s2sum += g.a; t.s2count++; }
    });
    catList = [...catTotals.entries()].map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.sum - a.sum);
    { let si = 0; catList.forEach((c) => { c.color = c.key === CAT_OTHER ? '#c9c2ae' : CAT_SHADES[si++ % CAT_SHADES.length]; }); }
    // new vs returning (canonical) per year + latest-year movers
    firstYearOf = new Map();
    entList.forEach((e) => { firstYearOf.set(e.id, Math.min(...[...e.years])); });
    newIn = {}; returningIn = {};
    YEARS.forEach((y) => {
      let nw = 0, ret = 0;
      entList.forEach((e) => {
        if (!e.years.has(y)) return;
        if (firstYearOf.get(e.id) === y) nw++; else ret++;
      });
      newIn[y] = nw; returningIn[y] = ret;
    });
    // one filed year of rows is not a change: with no prior year every recipient would
    // read as an increase "versus null", so the whole panel stands down.
    movers = PREV === null ? [] : entList
      .map((e) => ({ e, prev: entYearSum(e, PREV), cur: entYearSum(e, LATEST) }))
      .filter((m) => m.prev > 0 || m.cur > 0)
      .map((m) => ({ ...m, d: m.cur - m.prev }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 6);
  }
  // the record-coverage note exists only on a book with unitemized disclosures; it is
  // created once, whichever batch of rows first shows one
  function ensureCoverageNote() {
    if (!unitemized.length || document.getElementById('record-coverage')) return;
    const note = document.createElement('p');
    note.id = 'record-coverage'; note.className = 'mini-note';
    note.style.cssText = 'padding:1rem 1.25rem;border:1px solid #bca87c;background:#fff7e7;margin:1rem 0;line-height:1.6';
    document.querySelector('.sheet-kpis').insertAdjacentElement('afterend', note);
  }
  deriveModel(grants, !rowsPending);
  ensureCoverageNote();

  // ---------- state (all of it lives in the URL) ----------
  const state = { tab: 'overview', y: null, r: null, c: null, q: '', min: 0, sort: 'amount-desc', page: 0, pr: null };
  let returnTo = null; // {tab, scrollY} set when a drill jumps tabs; one click back
  let profileId = null; // open recipient profile
  let pendingRef = null; // {r, pr}: a hash recipient/profile the preview could not resolve yet

  function readHash() {
    const h = location.hash.slice(1);
    const p = Object.fromEntries(h.split('&').filter(Boolean).map((kv) => {
      const i = kv.indexOf('=');
      return i < 0 ? [kv, ''] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
    }));
    state.tab = ['overview','recipients','grants','methodology'].includes(p.tab) ? p.tab : (p.year || p.recipient || p.q ? 'grants' : 'overview');
    state.y = p.year && YEARS.includes(+p.year) ? +p.year : null;
    state.r = p.recipient && entities.has(p.recipient) ? p.recipient
      : p.recipient && aliasToId.has(p.recipient) ? aliasToId.get(p.recipient) : null;
    // rn= is an exact as-filed recipient name (the hub's handoff). It resolves to
    // the merged entity -- every alias, no unrelated substring matches -- and only
    // falls back to a text search if the full list still cannot place it.
    if (state.r === null && p.rn) state.r = aliasToId.get(p.rn) || null;
    state.pr = p.profile && entities.has(p.profile) ? p.profile : null;
    // a recipient the preview does not carry is not a bad link: it is kept for the full list
    if (rowsPending) pendingRef = {
      r: state.r === null ? (p.recipient || p.rn || null) : null,
      pr: p.profile && state.pr === null ? p.profile : null
    };
    else if (state.r === null && p.rn && !p.q) state.q = p.rn;
    recQ = p.rq || '';
    state.q = p.q || '';
    state.min = [0,50000,250000,1000000].includes(+p.min) ? +p.min : 0;
    const catKeys = CAT_SUBJECTS.concat(CAT_MECHANISMS).map((c) => c.key).concat([CAT_OTHER]);
    state.c = p.cat && catKeys.includes(p.cat) ? p.cat : null;
    state.sort = /^(amount|year|recipient|purpose)-(asc|desc)$/.test(p.sort || '') ? p.sort : 'amount-desc';
    state.page = Math.max(0, (+p.page || 1) - 1);
  }
  function writeHash(push) {
    const parts = ['tab=' + state.tab];
    if (state.y !== null) parts.push('year=' + state.y);
    if (state.r !== null) parts.push('recipient=' + encodeURIComponent(state.r));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.min) parts.push('min=' + state.min);
    if (state.c !== null) parts.push('cat=' + encodeURIComponent(state.c));
    if (state.pr !== null) parts.push('profile=' + encodeURIComponent(state.pr));
    if (recQ) parts.push('rq=' + encodeURIComponent(recQ));
    if (state.sort !== 'amount-desc') parts.push('sort=' + state.sort);
    if (state.page) parts.push('page=' + (state.page + 1));
    const hash = '#' + parts.join('&');
    if (location.hash !== hash) {
      if (push) history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
      if (typeof syncSide === 'function') syncSide();
  }
  }

  // ---------- scoped rows ----------
  const scopeRows = () => {
    let rows = grants;
    if (state.r !== null) {
      const e = entities.get(state.r);
      rows = e ? e.grants : [];
    }
    if (state.y !== null) rows = rows.filter((g) => g.y === state.y);
    return rows;
  };
  function viewRows() {
    let rows = scopeRows();
    if (state.c !== null) rows = rows.filter((g) => catOf(g) === state.c);
    if (state.min > 0) rows = rows.filter((g) => g.a >= state.min);
    const q = state.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter((g) =>
        g.r.toLowerCase().includes(q) ||
        g.p.toLowerCase().includes(q) ||
        String(g.y).includes(q) ||
        (g.c + ' ' + g.s).toLowerCase().includes(q));
    }
    const [key, dir] = state.sort.split('-');
    const mul = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (key === 'amount') return (a.a - b.a) * mul;
      if (key === 'year') return (a.y - b.y) * mul;
      if (key === 'recipient') return a.r.localeCompare(b.r) * mul;
      if (key === 'purpose') return a.p.localeCompare(b.p) * mul;
      return 0;
    });
  }

  // ---------- print report ----------
  // Printing the Grants tab printed one page of sixty rows and hid the pager. A
  // development officer hands a director the whole thing: the headline figures,
  // what the foundation funds, who it funds most, the reconciliation, and every
  // grant in the current scope -- year, purpose, minimum and search included.
  let printWhenReady = false;
  function printReport() {
    if (rowsPending) { printWhenReady = true; const st = document.getElementById('rows-status'); if (st) st.textContent = 'Loading the full grant list before printing…'; return; }
    const host = document.getElementById('print-report');
    if (!host) { window.print(); return; }
    const h1 = document.querySelector('h1'); const meta = document.querySelector('.hero-meta');
    const rows = viewRows();
    const scope = [];
    if (state.y !== null) scope.push('tax year ' + state.y);
    if (state.c !== null) scope.push('purpose: ' + state.c);
    if (state.r !== null) { const e = entities.get(state.r); if (e) scope.push('recipient: ' + dc(e.display)); }
    if (state.min) scope.push('grants of ' + money(state.min) + ' and up');
    if (state.q) scope.push('search “' + state.q + '”');
    const total = rows.reduce((s, g) => s + g.a, 0);
    const kpi = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : '—'; };
    const fit = document.getElementById('fit-line');
    const grand = GRAND || 1;
    const cats = catList.slice(0, 8);
    const tops = entList.slice(0, 10);
    const years = Object.keys(tieout).sort();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    host.innerHTML = `
      <header class="pr-head">
        <div class="pr-brand">The Grants Ledger · reconciled record from IRS Form 990-PF</div>
        <h1>${esc(h1 ? h1.textContent.trim() : document.title)}</h1>
        <p class="pr-meta">${esc(meta ? meta.textContent.trim() : '')} · filed years ${esc(years[0])}–${esc(years[years.length - 1])} · printed ${new Date().toISOString().slice(0, 10)}</p>
      </header>
      <section class="pr-kpis">
        <div><b>${kpi('kpi-orgs')}</b><span>Recipients</span></div>
        <div><b>${kpi('kpi-median')}</b><span>Median grant</span></div>
        <div><b>${kpi('kpi-range')}</b><span>Typical grant</span></div>
        <div><b>${kpi('kpi-delta')}</b><span>Latest year</span></div>
      </section>
      ${fit && !fit.hidden && fit.textContent ? `<p class="pr-fit">${esc(fit.textContent)}</p>` : ''}
      <section class="pr-sec">
        <h2>What it funds</h2>
        <table class="pr-table"><thead><tr><th>Purpose, in the filing’s own words</th><th class="num">Dollars</th><th class="num">Share</th></tr></thead>
        <tbody>${cats.map((c) => `<tr><td>${esc(c.key)}</td><td class="num">${money(c.sum)}</td><td class="num">${(c.sum / grand * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="pr-sec">
        <h2>Largest recipients, all filed years</h2>
        <table class="pr-table"><thead><tr><th>Recipient</th><th class="num">Grants</th><th class="num">Total</th><th>Years</th></tr></thead>
        <tbody>${tops.map((e) => `<tr><td>${esc(dc(e.display))}</td><td class="num">${num(e.count)}</td><td class="num">${money(e.total)}</td><td>${[...e.years].sort().join(', ')}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="pr-sec">
        <h2>Reconciliation to the filed totals</h2>
        <table class="pr-table"><thead><tr><th>Tax year</th><th class="num">Rows</th><th class="num">Rows sum</th><th class="num">Filed line 25(d)</th><th>Result</th></tr></thead>
        <tbody>${years.map((y) => { const t = tieout[y]; const d = (t.line25_col_d || 0) - (t.grant_sum || 0); return `<tr><td>${esc(y)}</td><td class="num">${num(t.grant_count || 0)}</td><td class="num">${money(t.grant_sum || 0)}</td><td class="num">${money(t.line25_col_d || 0)}</td><td>${d === 0 ? 'matches exactly' : 'differs by ' + money(Math.abs(d))}</td></tr>`; }).join('')}</tbody></table>
      </section>
      <section class="pr-sec pr-rows">
        <h2>Every grant in scope${scope.length ? ' — ' + esc(scope.join(' · ')) : ''}</h2>
        <p class="pr-sub">${num(rows.length)} ${rows.length === 1 ? 'grant' : 'grants'} · ${money(total)}</p>
        <table class="pr-table"><thead><tr><th>Year</th><th>Recipient</th><th class="num">Amount</th><th>Purpose</th><th>Location</th></tr></thead>
        <tbody>${rows.map((g) => `<tr><td>${g.y}</td><td>${esc(dc(g.r))}</td><td class="num">${money(g.a)}</td><td>${esc(g.p || '')}</td><td>${esc([g.c, g.s].filter(Boolean).join(', '))}</td></tr>`).join('')}</tbody></table>
      </section>
      <footer class="pr-foot">Every figure reconciles to a total the foundation itself filed with the IRS. Historical record, not eligibility; nothing here is an audit. jcurry44.github.io/grants-ledgers</footer>`;
    host.hidden = false; host.setAttribute('aria-hidden', 'false');
    document.body.classList.add('print-report-mode');
    const done = () => { document.body.classList.remove('print-report-mode'); host.hidden = true; host.setAttribute('aria-hidden', 'true'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }
  document.querySelectorAll('#print-btn').forEach((b) => b.addEventListener('click', printReport));

  // ---------- tiny DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  // the build stamps the canonical recipient count into the page; while the full list is
  // still loading that stamp is the only true figure for it
  const STAMPED_ORGS = ($('kpi-orgs') ? $('kpi-orgs').textContent : '').trim() || '\u2014';
  const waitLine = () => `Loading the full grant list \u2014 ${num(ROWS_TOTAL)} rows\u2026`;

  // ---------- hero KPIs ----------
  function animateCount(node, target, opts) {
    const { prefix = '', duration = 1200, format = (n) => Math.round(n).toLocaleString('en-US') } = opts || {};
    if (reducedMotion()) { node.textContent = prefix + format(target); return; }
    const start = performance.now();
    function frame(t) {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = prefix + format(target * eased);
      if (p < 1) requestAnimationFrame(frame);
      else node.textContent = prefix + format(target);
    }
    requestAnimationFrame(frame);
  }
  // every filed period, not only the ones that carry rows: a foundation can file five
  // 990-PFs and pay grants in one of them, and all five object IDs are the receipt.
  $('obj-ids').textContent = Object.keys(tieout).sort()
    .map((y) => tieout[y].object_id).filter(Boolean).join(' · ');

  // ---------- tabs ----------
  const TABS = ['overview', 'recipients', 'grants', 'methodology'];
  function setTab(tab, push) {
    requestAnimationFrame(positionInk);
    state.tab = tab;
    TABS.forEach((t) => {
      const btn = $('tab-' + t);
      const panel = $('panel-' + t);
      const on = t === tab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    writeHash(push !== false);
    render();
    updateReturnChip();
    if (push !== false) {
      if (tab === 'overview') window.scrollTo({ top: 0, behavior: 'instant' });
      else {
        const panel = $('panel-' + tab);
        const tabsEl = document.querySelector('.tabs');
        const off = (tabsEl && getComputedStyle(tabsEl).display !== 'none' ? tabsEl.offsetHeight : 0) + 10;
        window.scrollTo({ top: Math.max(0, panel.getBoundingClientRect().top + window.scrollY - off), behavior: 'instant' });
      }
    }
  }
  TABS.forEach((t) => {
    $('tab-' + t).addEventListener('click', () => { returnTo = null; updateReturnChip(); setTab(t); });
  });
  function jumpFromOverview() {
    returnTo = { tab: state.tab, scrollY: window.scrollY, c: state.c, r: state.r, q: state.q, min: state.min };
    updateReturnChip();
  }
  function updateReturnChip() {
    const chip = document.getElementById('return-chip');
    if (!chip) return;
    chip.hidden = !(returnTo && state.tab !== returnTo.tab);
  }
  $('tablist').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(state.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      setTab(n); $('tab-' + n).focus();
    }
  });
  $('explore-btn').addEventListener('click', () => { setTab('grants'); $('panel-grants').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }); });
  $('badge-btn').addEventListener('click', () => setTab('methodology'));

  // sidebar: nav + the global year rail (one state.y, every surface)
  function syncSide() {
    document.querySelectorAll('.side-nav [data-tab]').forEach((b) => {
      if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('#year-rail [data-yr], #year-rail-top [data-yr]').forEach((b) => {
      const v = b.dataset.yr === 'all' ? null : +b.dataset.yr;
      b.classList.toggle('on', state.y === v);
      b.setAttribute('aria-pressed', state.y === v ? 'true' : 'false');
    });
    const sy = state.y;
    const nOrgs = rowsPending ? (sy === null ? STAMPED_ORGS : '\u2026')
      : num(sy === null ? entList.length : entList.filter((e) => e.years.has(sy)).length);
    const nGrants = num(sy === null ? (rowsPending ? ROWS_TOTAL : grants.length) : byYear[sy].count);
    const put = (sel, v) => { const el = document.querySelector(sel); if (el) el.textContent = v; };
    put('#sn-recipients', nOrgs); put('#sn-grants', nGrants);
    put('#tab-recipients .tcount', nOrgs); put('#tab-grants .tcount', nGrants);
  }
  {
    // the sidebar rail (>=1100px) and the top rail (below it) are the same control
    [document.getElementById('year-rail'), document.getElementById('year-rail-top')].filter(Boolean).forEach((rail) => {
      let withheld = {};
      try { withheld = JSON.parse(document.documentElement.dataset.withheld || '{}'); } catch (e) { withheld = {}; }
      const railYears = [...new Set([...YEARS, ...Object.keys(withheld).map(Number)])].sort((a, b) => a - b);
      rail.innerHTML = ['all'].concat(railYears).map((y) => withheld[String(y)]
        ? `<a class="withheld" href="../../exceptions/#${document.documentElement.dataset.slug || ''}" title="${String(withheld[String(y)].why || '').replace(/"/g, '&quot;')}" aria-label="Tax year ${y}, ${withheld[String(y)].kind || 'withheld'}">${y}<small>${withheld[String(y)].kind || 'withheld'}</small></a>`
        : `<button type="button" data-yr="${y}" aria-pressed="false">${y === 'all' ? 'All' : y}</button>`).join('');
      rail.addEventListener('click', (e) => {
        const b = e.target.closest('[data-yr]');
        if (!b) return;
        state.y = b.dataset.yr === 'all' ? null : +b.dataset.yr;
        state.page = 0;
        writeHash(true);
        render();
      });
    });
    document.querySelectorAll('.side-nav [data-tab]').forEach((b) =>
      b.addEventListener('click', () => { returnTo = null; updateReturnChip(); setTab(b.dataset.tab); }));
    syncSide();
  }

  // ---------- overview ----------
  function renderTrend() {
    const host = $('trend');
    if (YEARS.length < 2) {           // one filed year is not a trend; hide the card entirely
      const card = $('trend').closest('.card');
      if (card) card.hidden = true;
      const cards = document.getElementById('tr-cards');
      if (cards) cards.hidden = true;
      return;
    }
    const tipEl = $('tr-tip');
    const W = 560, H = 228, pad = { t: 34, r: 18, b: 16, l: 36 };
    const maxV = Math.max(1, ...YEARS.map((y) => byYear[y].sum)) * 1.12;
    const xAt = (i) => pad.l + 22 + (i / (YEARS.length - 1)) * (W - pad.l - pad.r - 44);
    const yAt = (v) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
    const pts = YEARS.map((y, i) => [xAt(i), yAt(byYear[y].sum)]);
    let line = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const cx = (pts[i-1][0] + pts[i][0]) / 2;
      line += ` C ${cx} ${pts[i-1][1]}, ${cx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`;
    }
    const area = line + ` L ${pts[pts.length-1][0]} ${yAt(0)} L ${pts[0][0]} ${yAt(0)} Z`;
    // Gridlines follow the data. The old fixed 5/10/15M grid drew three lines flat on
    // the baseline of a billion-dollar chart and labelled a $5B tick "$5000M"; a $523
    // ledger got ticks far above its own ceiling. Steps are 1/2/5 x 10^k, ~4 intervals.
    const tickStep = (() => {
      const target = maxV / 4;
      if (!(target > 0)) return 1;
      const mag = Math.pow(10, Math.floor(Math.log10(target)));
      const r = target / mag;
      return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
    })();
    const ticks = [0];
    for (let v = tickStep; v < maxV && ticks.length < 8; v += tickStep) ticks.push(v);
    const grid = ticks.map((v) =>
      (v === 0 ? '' : `<line class="tr-grid" x1="${pad.l}" y1="${yAt(v)}" x2="${W - pad.r}" y2="${yAt(v)}"/>`) +
      `<text class="tr-tick" x="${pad.l - 7}" y="${yAt(v) + 3}" text-anchor="end">${moneyTick(v)}</text>`).join('');
    const marks = YEARS.map((y, i) => {
      const [x, yy] = pts[i];
      const sel = state.y === y;
      const pct = i === 0 ? null : yoyPct(byYear[y].sum, byYear[YEARS[i-1]].sum);
      const pctTxt = pct === null ? '' : (pct > 0 ? '+' : '−') + Math.abs(pct).toFixed(0) + '%';
      return `
        <g class="tr-pt${sel ? ' is-sel' : ''}" data-i="${i}" data-y="${y}" tabindex="0" role="button"
           aria-label="Tax year ${y}: ${money(byYear[y].sum)}, ${num(byYear[y].count)} ${grantsWord(byYear[y].count)}${pct===null?'':', ' + pctTxt + ' versus prior year'}. Scopes the whole page to this year.">
          <rect x="${x - 52}" y="${pad.t - 16}" width="104" height="${H - pad.t + 8}" fill="transparent"/>
          <circle cx="${x}" cy="${yy}" r="${sel ? 6.5 : 4.5}" class="tr-dot"/>
          <text x="${x}" y="${yy - 14}" text-anchor="middle" class="tr-val">${moneyCompact(byYear[y].sum)}</text>
        </g>`;
    }).join('');
    const svgHtml = `
      <svg viewBox="0 0 ${W} ${H}" class="${state.y !== null ? 'scoped' : ''}" role="group" aria-label="Charitable disbursements by tax year, ${YEARS[0]} through ${LATEST}. ${YEARS.map((y)=>y + ': ' + moneyCompact(byYear[y].sum)).join(', ')}.">
        <defs>
          <linearGradient id="trFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a35c1a" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#a35c1a" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        ${state.y !== null ? `<rect class="tr-band" x="${xAt(YEARS.indexOf(state.y)) - 30}" y="10" width="60" height="${H - 18}" rx="8"/>` : ''}
        <line class="tr-base" x1="${pad.l}" y1="${yAt(0)}" x2="${W - pad.r}" y2="${yAt(0)}"/>
        <path class="tr-area" d="${area}"/>
        <path class="tr-line" d="${line}"/>
        ${marks}
      </svg>`;
    host.innerHTML = '';
    host.appendChild(tipEl);
    host.insertAdjacentHTML('beforeend', svgHtml);
    const svgEl = host.querySelector('svg');
    const cardsHost = document.getElementById('tr-cards');
    if (cardsHost) {
      cardsHost.classList.toggle('scoped', state.y !== null);
      cardsHost.innerHTML = YEARS.map((y, i) => {
        const pct = i === 0 ? null : yoyPct(byYear[y].sum, byYear[YEARS[i-1]].sum);
        const pctTxt = pct === null ? '' : (pct > 0 ? '+' : '\u2212') + Math.abs(pct).toFixed(0) + '%';
        const sel = state.y === y;
        return `
        <button type="button" class="tr-card${sel ? ' sel' : ''}" data-y="${y}" aria-pressed="${sel}"
          aria-label="Tax year ${y}: ${money(byYear[y].sum)} across ${num(byYear[y].count)} ${grantsWord(byYear[y].count)}${pct === null ? '' : ', ' + pctTxt + ' versus prior year'}. Scopes the whole page to this year.">
          <span class="ty"><span>${y}</span><span class="chg ${pct !== null && pct < 0 ? 'neg' : 'pos'}">${pctTxt}</span></span>
          <span class="tsum">${moneyCompact(byYear[y].sum)}</span>
          <span class="tct">${num(byYear[y].count)} ${grantsWord(byYear[y].count)}</span>
        </button>`;
      }).join('');
      cardsHost.querySelectorAll('.tr-card').forEach((c) => {
        c.addEventListener('click', () => {
          const yv = +c.dataset.y;
          state.y = state.y === yv ? null : yv; state.page = 0;
          writeHash(true); render();
        });
      });
    }
    { // reveal choreography: delay each year by the tip's real arrival (path length, not guesswork)
      const lineEl = svgEl.querySelector('.tr-line');
      const L = lineEl.getTotalLength();
      host.style.setProperty('--plen', L.toFixed(1));
      const fracAt = (tx) => {
        let lo = 0, hi = L;
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          if (lineEl.getPointAtLength(mid).x < tx) lo = mid; else hi = mid;
        }
        return lo / L;
      };
      const yearCards = document.querySelectorAll('#tr-cards .tr-card');
      svgEl.querySelectorAll('.tr-pt').forEach((g, i) => {
        const td = (fracAt(pts[i][0]) * 1.4).toFixed(2) + 's';
        g.style.setProperty('--td', td);
        if (yearCards[i]) yearCards[i].style.setProperty('--td', td);
      });
    }
    function tipShow(i) {
      const y = YEARS[i];
      const hostRect = host.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      let x = (svgRect.left - hostRect.left) + pts[i][0] / W * svgRect.width;
      const ty = (svgRect.top - hostRect.top) + pts[i][1] / H * svgRect.height;
      const tTip = tieout[String(y)];
      const dTip = tTip ? tTip.line25_col_d - tTip.grant_sum : 0;
      tipEl.innerHTML = `<strong>${y}</strong><span>${money(byYear[y].sum)} · ${num(byYear[y].count)} ${grantsWord(byYear[y].count)} · ${dTip === 0 ? 'PASS Δ $0' : 'Δ ' + money(dTip)}</span>`;
      tipEl.classList.add('show');
      const tw = tipEl.offsetWidth || 190;
      x = Math.max(tw / 2 + 4, Math.min(hostRect.width - tw / 2 - 4, x));
      tipEl.style.left = x + 'px';
      tipEl.style.top = ty + 'px';
    }
    function tipHide() { tipEl.classList.remove('show'); }
    host.querySelectorAll('.tr-pt').forEach((g) => {
      const i = +g.dataset.i;
      const y = +g.dataset.y;
      const act = () => { state.y = state.y === y ? null : y; state.page = 0; writeHash(true); render(); };
      g.addEventListener('mouseenter', () => tipShow(i));
      g.addEventListener('mouseleave', tipHide);
      g.addEventListener('focus', () => tipShow(i));
      g.addEventListener('blur', tipHide);
      g.addEventListener('click', act);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
  }

  function barRow(label, value, max, opts) {
    const o = opts || {};
    const pct = barPct(value, max);
    return `
      <div class="bar-row${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''}>
        <div class="bar-label">${label}</div>
        <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-val">${o.val || money(value)}</div>
      </div>`;
  }

  function renderOverview() {
    // the global year scope: one state.y drives every panel below the cover
    const SY = state.y;
    const S_GRAND = SY === null ? GRAND : byYear[SY].sum;
    const sEnts = SY === null ? entList
      : entList.map((e) => {
          const t = entYearSum(e, SY);
          return t > 0 ? { ...e, total: t, count: e.grants.filter((g) => g.y === SY).length } : null;
        }).filter(Boolean).sort((a, b) => b.total - a.total);
    const sCatList = SY === null ? catList
      : (() => {
          const m = new Map();
          grants.forEach((g) => {
            if (g.y !== SY) return;
            const k = catOf(g);
            if (!m.has(k)) m.set(k, { key: k, sum: 0, count: 0 });
            const t = m.get(k); t.sum += g.a; t.count++;
          });
          return [...m.values()].sort((a, b) => b.sum - a.sum).map((c) => ({ ...c, color: catColorOf(c.key) }));
        })();
    const sPrev = SY === null ? PREV : (YEARS.indexOf(SY) > 0 ? YEARS[YEARS.indexOf(SY) - 1] : null);
    const sMovers = SY === null ? movers
      : (sPrev === null ? [] : entList
          .map((e) => ({ e, prev: entYearSum(e, sPrev), cur: entYearSum(e, SY) }))
          .filter((m) => m.prev > 0 || m.cur > 0)
          .map((m) => ({ ...m, d: m.cur - m.prev }))
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
          .slice(0, 6));
    const S_NAMED = sEnts.reduce((sum, e) => sum + e.total, 0);
    const sTop5Sum = sEnts.slice(0, 5).reduce((s, e) => s + e.total, 0);
    renderTrend();
    // authored ledes — every sentence computed from the data itself
    (function () {
      const peakY = YEARS.reduce((a, y) => byYear[y].sum > byYear[a].sum ? y : a, YEARS[0]);
      let declines = 0;
      for (let i = YEARS.length - 1; i > 0; i--) {
        if (byYear[YEARS[i]].sum < byYear[YEARS[i - 1]].sum) declines++; else break;
      }
      const trendLede = declines >= 2
        ? `Giving peaked in <strong>${peakY}</strong> at <strong>${moneyCompact(byYear[peakY].sum)}</strong>, then declined for <strong>${declines} consecutive years</strong> to ${moneyCompact(byYear[LATEST].sum)} in ${LATEST}.`
        : `Giving peaked in <strong>${peakY}</strong> at <strong>${moneyCompact(byYear[peakY].sum)}</strong>; ${LATEST} disbursements were ${moneyCompact(byYear[LATEST].sum)}.`;
      // both sides are read from the filings, never assumed equal: the unscoped view
      // sums every filed period's own two figures, so a year that does not tie shows.
      const tieY = SY !== null ? (tieout[String(SY)] || null) : null;
      const TKEYS = Object.keys(tieout);
      const T_ROWS = TKEYS.reduce((s, k) => s + (tieout[k].grant_sum || 0), 0);
      const T_25D = TKEYS.reduce((s, k) => s + (tieout[k].line25_col_d || 0), 0);
      const eqA = tieY ? tieY.grant_sum : T_ROWS;
      const eqB = tieY ? tieY.line25_col_d : T_25D;
      const eqD = eqB - eqA;
      $('eq-a').textContent = money(eqA);
      $('eq-b').textContent = money(eqB);
      const eqSeal = document.querySelector('#db-eq .eq-seal');
      if (eqSeal) eqSeal.textContent = eqD === 0 ? '\u0394 $0 \u2713' : '\u0394 ' + money(eqD);
      const eqLbl = document.querySelector('#db-eq .eq-part .eq-label');
      if (eqLbl) eqLbl.textContent = SY !== null ? `\u03a3 ${SY} grant schedule` : '\u03a3 grant schedules';
      const dbEl = document.querySelector('.db-line');
      if (dbEl) dbEl.innerHTML = SY !== null
        ? `Every number on this page reconciles to the foundation\u2019s own filed totals \u2014 <em>tax year ${SY}, to the dollar.</em>`
        : 'Every number on this page reconciles to the foundation\u2019s own filed totals \u2014 <em>' + (document.documentElement.dataset.running || 'to the dollar, five years running.') + '</em>';
      $('db-eq').setAttribute('aria-label',
        `Sum of the ${SY !== null ? SY + ' grant schedule' : 'grant schedules'}, ${money(eqA)}, `
        + (eqD === 0
            ? `equals Part I line 25(d), ${money(eqB)} \u2014 a difference of zero dollars, verified.`
            : `against Part I line 25(d), ${money(eqB)} \u2014 a difference of ${money(eqD)}, which does not reconcile.`));
      $('lede-trend').innerHTML = trendLede + (SY !== null ? ` Viewing <strong>${SY}</strong> \u2014 every panel below is scoped to it.` : '');
      const topN = Math.min(5, sEnts.length);
      const top5 = sEnts.slice(0, 5).reduce((s, e) => s + e.total, 0);
      const allYrs = FILED_YEARS === 1 ? 'in the single filed year' : `across the ${numWord(FILED_YEARS)} filed years`;
      $('lede-conc').innerHTML = `${capWord(numWord(topN))} ${orgsWord(topN)} received <strong>${money(top5)}</strong> — ${share(top5, S_NAMED, '¢')} of every named-recipient dollar ${SY !== null ? 'in tax year ' + SY : allYrs}.`;
      const nrY = SY !== null ? SY : LATEST;
      const nrNew = newIn[nrY] || 0, nrRet = returningIn[nrY] || 0, nrAll = nrNew + nrRet;
      $('lede-newret').innerHTML = nrY === YEARS[0]
        ? `<strong>${num(nrNew)}</strong> ${recipWord(nrNew)} ${nrNew === 1 ? 'appears' : 'appear'} in ${nrY} — the first year in the filed record, so every organization counts as new.`
        : nrRet === 0
          ? `No recipient in ${nrY} had been funded in an earlier filed year — all <strong>${num(nrAll)}</strong> ${nrAll === 1 ? 'is' : 'are'} new.`
          : `Giving concentrates among returning grantees: <strong>${num(nrRet)} of ${num(nrAll)}</strong> ${recipWord(nrAll)} in ${nrY} had been funded before.`;
      if (incompleteYear(nrY)) $('lede-newret').textContent = `${nrY} contains unitemized disclosures. New and returning recipient comparisons are unavailable for that year.`;
      if (!sEnts.length) $('lede-conc').textContent = 'No named-recipient detail is available in this scope. The filed total remains available in reconciliation.';
      const cTop = sCatList.find((c) => c.key !== CAT_OTHER);
      const cOther = sCatList.find((c) => c.key === CAT_OTHER) || { sum: 0, count: 0 };
      $('lede-cats').innerHTML = !cTop
        ? `No filed purpose here names a field the published rules recognise, so nothing is guessed — all <strong>${moneyCompact(cOther.sum)}</strong> across ${num(cOther.count)} ${grantsWord(cOther.count)} stays in ${esc(CAT_OTHER.toLowerCase())}.`
        : `<strong>${esc(cTop.key)}</strong> leads at <strong>${moneyCompact(cTop.sum)}</strong> across ${num(cTop.count)} ${grantsWord(cTop.count)}. Where the filing\u2019s words name no field, nothing is guessed \u2014 <strong>${moneyCompact(cOther.sum)}</strong> stays in ${esc(CAT_OTHER.toLowerCase())}.`;
      // the heading years follow the data; a record with one grant year has nothing to compare
      const mvCard = $('movers').closest('.card');
      if (mvCard) mvCard.hidden = YEARS.length < 2 || incompleteYear(SY === null ? LATEST : SY) || incompleteYear(sPrev);
      const mvY = SY !== null ? SY : LATEST, mvP = SY !== null ? sPrev : PREV;
      const mvH = document.getElementById('movers-h');
      if (mvH) mvH.textContent = `Biggest changes · ${mvY}`;
      const mvS = document.getElementById('movers-sub');
      if (mvS) mvS.textContent = mvP === null ? '' : `Largest swings vs ${mvP}`;
      const m0 = sMovers[0];
      $('lede-movers').innerHTML = m0
        ? `The largest single swing into ${SY !== null ? SY : LATEST}: <strong>${esc(dc(m0.e.display))}</strong>, ${m0.d >= 0 ? 'up' : 'down'} <strong>${moneyCompact(Math.abs(m0.d))}</strong> versus ${sPrev !== null ? sPrev : PREV}.`
        : (SY !== null && sPrev === null ? `${SY} is the first filed year in TEOS — no prior year to compare.` : '');
      const db = document.getElementById('db-method');
      if (db && !db.dataset.wired) {
        db.dataset.wired = '1';
        db.addEventListener('click', (e) => { e.preventDefault(); setTab('methodology'); window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); });
      }
    })();
    // concentration
    $('conc-share').textContent = S_NAMED ? share(sTop5Sum, S_NAMED) : '—';
    $('conc-bar').style.width = barPct(sTop5Sum, S_NAMED).toFixed(1) + '%';
    const cTopN = Math.min(5, sEnts.length);
    const cRest = Math.max(0, sEnts.length - cTopN);   // 'the other -3' can never render
    $('conc-hint').textContent = cRest === 0
      ? `${cTopN} ${orgsWord(cTopN)} — every organization funded${SY !== null ? ' in ' + SY : ''}`
      : cRest === 1
        ? `${cTopN} ${orgsWord(cTopN)} — the other one holds the remaining ${(100 - barPct(sTop5Sum, S_NAMED)).toFixed(1)}%`
        : `${cTopN} ${orgsWord(cTopN)} — the other ${num(cRest)} share the remaining ${(100 - barPct(sTop5Sum, S_NAMED)).toFixed(1)}%`;
    if (!sEnts.length) $('conc-hint').textContent = 'Recipient concentration is unavailable';
    else if (unitemized.length) $('conc-hint').textContent += ' · share of named-recipient dollars';
    // the largest recipients behind the number — they arrive one by one
    const top5list = sEnts.slice(0, 5);
    const maxT5 = top5list.length ? top5list[0].total : 0;   // an empty scope has no leader
    $('conc-top5').setAttribute('aria-label', cTopN === 1 ? 'The largest recipient' : `The ${numWord(cTopN)} largest recipients`);
    $('conc-top5').innerHTML = top5list.map((e, i) => barRow(
      `<span class="rk">${String(i + 1).padStart(2, '0')}</span> ${esc(dc(e.display))}`,
      e.total, maxT5,
      { cls: 'is-btn stacked', attrs: `style="--i:${i}" data-ent="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(dc(e.display))}, ${money(e.total)}, ${share(e.total, S_NAMED, ' percent')} of named-recipient dollars${SY !== null ? ' in ' + SY : ''}. Opens the profile."`,
        val: `${money(e.total)}` }
    )).join('');
    $('conc-top5').querySelectorAll('.bar-row').forEach((r) => {
      const go = () => openProfile(r.dataset.ent);
      r.addEventListener('click', go);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });

    // the granted dollar as one hundred pennies — cents by largest remainder, so they sum to exactly 100
    (function () {
      // The hundred cents are cents of a dollar GRANTED. A category that nets negative
      // (refunds larger than its grants) cannot hold a negative number of pennies, so
      // the coins are apportioned across the positive category dollars -- identical
      // arithmetic whenever nothing is negative, and still exactly 100 when something
      // is. The dollar figure on each row stays the true signed total.
      const posSums = sCatList.map((c) => Math.max(0, c.sum));
      const posTot = posSums.reduce((a, b) => a + b, 0);
      const raw = posTot > 0 ? posSums.map((v) => v / posTot * 100) : sCatList.map(() => 0);
      const floors = raw.map(Math.floor);
      let left = 100 - floors.reduce((a, b) => a + b, 0);
      const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
      const cents = floors.slice();
      if (order.length) for (let k = 0; k < left; k++) cents[order[k % order.length][1]]++;
      const grid = $('penny-grid');
      const darkText = (hex) => { // white numerals on dark coins, ink on pale ones
        const n = parseInt(hex.slice(1), 16);
        return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 145;
      };
      const cells = [];
      sCatList.forEach((c, ci) => {
        const hollow = c.key === CAT_OTHER;
        for (let k = 0; k < cents[ci]; k++) {
          const label = (k === 0 && cents[ci] >= 4)
            ? `<b class="${hollow ? 'k' : (darkText(c.color) ? 'w' : 'k')}">${cents[ci]}</b>` : '';
          cells.push(`<span aria-hidden="true" class="penny${hollow ? ' other' : ''}" data-cat="${esc(c.key)}" style="--pc:${c.color};--pi:${cells.length}" title="${esc(c.key)} — ${cents[ci]}¢ of the dollar">${label}</span>`);
        }
      });
      grid.innerHTML = cells.join('');
      grid.setAttribute('aria-label', 'One granted dollar as one hundred cents: '
        + sCatList.map((c, i) => `${c.key} ${cents[i]}¢`).join(', ') + '.');
      $('cat-rows').innerHTML = sCatList.map((c, i) => `
        <button type="button" class="cat-row" data-cat="${esc(c.key)}" aria-label="${esc(c.key)}: ${cents[i] === 0 ? 'under one cent' : cents[i] + ' cents'} of every dollar, ${money(c.sum)} across ${num(c.count)} ${grantsWord(c.count)}. Opens these grants in the ledger.">
          <span class="cr-sw" style="background:${c.color}"></span>
          <span class="cr-c">${cents[i] === 0 ? '<1\u00a2' : cents[i] + '\u00a2'}</span>
          <span class="cr-name">${esc(c.key)}<span class="cr-meta">${num(c.count)} ${grantsWord(c.count)} \u00b7 ${share(c.sum, S_GRAND)}</span></span>
          <span class="cr-val">${moneyCompact(c.sum)}</span>
        </button>`).join('');
      const rows = [...$('cat-rows').querySelectorAll('.cat-row')];
      const spotlight = (cat) => {
        grid.classList.toggle('dim', cat !== null);
        grid.querySelectorAll('.penny').forEach((p) => p.classList.toggle('hot', p.dataset.cat === cat));
        rows.forEach((r) => r.classList.toggle('hot', r.dataset.cat === cat));
      };
      rows.forEach((el) => {
        el.addEventListener('click', () => {
          jumpFromOverview();
          state.c = state.c === el.dataset.cat ? null : el.dataset.cat;
          state.page = 0;
          setTab('grants');
        });
        el.addEventListener('mouseenter', () => spotlight(el.dataset.cat));
        el.addEventListener('mouseleave', () => spotlight(null));
      });
      grid.addEventListener('mouseover', (e) => {
        const p = e.target.closest('.penny');
        if (p) spotlight(p.dataset.cat);
      });
      grid.addEventListener('mouseleave', () => spotlight(null));
      grid.addEventListener('click', (e) => {
        const p = e.target.closest('.penny');
        if (!p) return;
        jumpFromOverview();
        state.c = state.c === p.dataset.cat ? null : p.dataset.cat;
        state.page = 0;
        setTab('grants');
      });
    })();


    // changes
    $('newret').innerHTML = YEARS.map((y, i) =>
      incompleteYear(y) ? `<div class="nr-cell"><div class="nr-y">${y}</div><div class="nr-n">Incomplete detail</div><div class="nr-r">${num(namedGrants.filter(g => g.y === y).length)} named-recipient rows</div></div>` : i === 0
        ? `<button type="button" class="nr-cell${SY === y ? ' sel' : ''}" style="--ni:${i}" data-y="${y}" aria-expanded="false"><div class="nr-y">${y}</div><div class="nr-n">${num(newIn[y])} ${recipWord(newIn[y])}</div><div class="nr-r">baseline year</div></button>`
        : `<button type="button" class="nr-cell${SY === y ? ' sel' : ''}" style="--ni:${i}" data-y="${y}" aria-expanded="false"><div class="nr-y">${y}</div><div class="nr-n">${num(newIn[y])} new</div><div class="nr-r">${num(returningIn[y])} returning</div></button>`).join('');
    (function () {
      const panel = $('nr-detail');
      let openY = null;
      function renderDetail(y) {
        const first = y === YEARS[0];
        const ents = entList
          .filter((e) => firstYearOf.get(e.id) === y)
          .map((e) => ({ e, ySum: e.grants.filter((g) => g.y === y).reduce((s, g) => s + g.a, 0) }))
          .sort((a, b) => b.ySum - a.ySum);
        const tot = ents.reduce((s, x) => s + x.ySum, 0);
        panel.innerHTML = `
          <div class="nrd-h">${first
            ? `<strong>${num(ents.length)} ${recipWord(ents.length)}</strong> in ${y} — the first filed year in the window, so every organization counts as first-observed · ${money(tot)} that year`
            : `<strong>${num(ents.length)} first-time ${recipWord(ents.length)}</strong> in ${y} · ${money(tot)} in first-year grants — select any to open the profile`}</div>
          <ul>${ents.map((x) => `
            <li><button type="button" class="nrd-row" data-ent="${esc(x.e.id)}">
              <span class="n" title="As filed: ${esc(x.e.aliases.join(' · '))}">${esc(dc(x.e.display))}</span>
              <span class="a">${money(x.ySum)}</span>
            </button></li>`).join('')}</ul>`;
        panel.querySelectorAll('.nrd-row').forEach((b) => {
          b.addEventListener('click', () => openProfile(b.dataset.ent));
        });
      }
      $('newret').querySelectorAll('.nr-cell').forEach((c) => {
        c.addEventListener('click', () => {
          const y = +c.dataset.y;
          if (openY === y) {
            openY = null; panel.hidden = true;
            c.classList.remove('open'); c.setAttribute('aria-expanded', 'false');
            return;
          }
          openY = y;
          $('newret').querySelectorAll('.nr-cell').forEach((x) => { x.classList.remove('open'); x.setAttribute('aria-expanded', 'false'); });
          c.classList.add('open'); c.setAttribute('aria-expanded', 'true');
          renderDetail(y);
          panel.hidden = false;
        });
      });
    })();
    $('movers').innerHTML = (sMovers.length === 0
      ? `<li class="mover-none">No prior filed year to compare — ${SY} is the first in the record.</li>`
      : '') + (() => {
      const mvMax = Math.max(1, ...sMovers.map((m) => Math.max(m.prev, m.cur)));
      const pct = (v) => barPct(v, mvMax).toFixed(1);
      return sMovers.map((m, i) => `
      <li class="mover" style="--i:${i}" data-ent="${esc(m.e.id)}">
        <button type="button" class="mover-btn">
          <span class="mover-name">${esc(dc(m.e.display))}</span>
          <span class="mover-d ${m.d >= 0 ? 'pos' : 'neg'}">${m.d >= 0 ? '+' : '−'}${moneyCompact(Math.abs(m.d))}</span>
          <span class="mover-meta">${moneyCompact(m.prev)} → ${moneyCompact(m.cur)}</span>
          <span class="mv-track" aria-hidden="true"><i class="mv-tick" style="left:${pct(m.prev)}%"></i><i class="mv-fill ${m.d >= 0 ? 'pos' : 'neg'}" style="--from:${pct(m.prev)}%;--to:${pct(m.cur)}%"></i></span>
        </button>
      </li>`).join('');
    })();
    $('movers').querySelectorAll('.mover').forEach((li) => {
      li.querySelector('button').addEventListener('click', () => openProfile(li.dataset.ent));
    });

    // the trend and the tie-out above are filed figures; everything from here down is
    // computed from rows, and a preview would put wrong numbers on the page -- so it waits
    if (rowsPending) {
      const wait = waitLine();
      ['lede-conc', 'lede-newret', 'lede-cats', 'lede-movers', 'conc-hint'].forEach((id) => { const n = $(id); if (n) n.textContent = wait; });
      $('conc-share').textContent = '\u2026';
      $('conc-bar').style.width = '0%';
      ['conc-top5', 'penny-grid', 'cat-rows', 'newret', 'movers'].forEach((id) => { const n = $(id); if (n) n.innerHTML = ''; });
      $('penny-grid').setAttribute('aria-label', wait);
    }
  }

  // ---------- recipients ----------
  let recQ = '';
  let recLetter = null;
  let recSort = 'total';
  let recExpanded = false;
  function renderRecipients() {
    const SY = state.y;
    const sub = document.getElementById('rec-top-sub');
    if (sub) sub.textContent = SY !== null
      ? `Tax year ${SY} \u00b7 select a bar for the full profile`
      : (document.documentElement.dataset.recsub || 'All five years') + ' \u00b7 select a bar for the full profile';
    if ($('rec-q').value !== recQ) $('rec-q').value = recQ;
    const S_GRAND = SY === null ? GRAND : byYear[SY].sum;
    const sEnts = SY === null ? entList
      : entList.map((e) => {
          const t = entYearSum(e, SY);
          return t > 0 ? { ...e, total: t, count: e.grants.filter((g) => g.y === SY).length } : null;
        }).filter(Boolean).sort((a, b) => b.total - a.total);
    const top = sEnts.slice(0, 10);
    const maxT = top.length ? top[0].total : 0;   // an empty scope has no leader
    $('rec-bars').innerHTML = top.map((e, i) => barRow(
      `<span class="rk">${String(i + 1).padStart(2, '0')}</span> ${esc(dc(e.display))}${e.aliases.length > 1 ? ' <span class="merged-flag" title="Merged from ' + e.aliases.length + ' as-filed name variants — see Methodology">▸' + e.aliases.length + '</span>' : ''}`,
      e.total, maxT,
      { cls: 'is-btn stacked', attrs: `style="--i:${i}" data-ent="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(dc(e.display))}, ${money(e.total)}, ${num(e.count)} ${grantsWord(e.count)}. Opens the recipient profile."` }
    )).join('');
    $('rec-bars').querySelectorAll('.bar-row').forEach((r) => {
      const go = () => openProfile(r.dataset.ent);
      r.addEventListener('click', go);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });

    const q = recQ.trim().toLowerCase();
    let list = q ? sEnts.filter((e) => e.display.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))) : sEnts.slice();
    $('rec-count').textContent = `${num(list.length)} of ${num(sEnts.length)} ${recipWord(sEnts.length)}${SY !== null ? ' in ' + SY : ''} · ${money(list.reduce((s,e)=>s+e.total,0))}`
      + (rowsPending ? ` \u00b7 among the ${num(grants.length)} largest grants so far, full list loading` : '');
    $('rec-empty').hidden = list.length > 0;

    const item = (e, ri) => `
      <li style="--ri:${Math.min(ri || 0, 18)}">
        <button type="button" class="rec-item" data-ent="${esc(e.id)}">
          <span class="ri-name" title="As filed: ${esc(e.aliases.join(' · '))}">${esc(dc(e.display))}${e.aliases.length > 1 ? ' <span class="merged-flag">▸' + e.aliases.length + '</span>' : ''}</span>
          <span class="ri-meta">${num(e.count)} ${grantsWord(e.count)} · ${[...e.years].sort().join(', ')} · <span class="ri-share">${share(e.total, S_GRAND, '%', (S_GRAND > 0 && Math.abs(e.total) / S_GRAND >= 0.01) ? 1 : 2)} of ${SY !== null ? SY : 'all'} dollars</span></span>
          <span class="ri-amt">${money(e.total)}</span>
        </button>
      </li>`;

    const alphaEl = $('alpha');
    if (recSort === 'name') {
      list.sort((a, b) => a.display.localeCompare(b.display));
      const groupsAll = new Map();
      list.forEach((e) => {
        const L = (e.display.replace(/^The\s+/i, '')[0] || '#').toUpperCase();
        const key = /[A-Z]/.test(L) ? L : '#';
        if (!groupsAll.has(key)) groupsAll.set(key, []);
        groupsAll.get(key).push(e);
      });
      const lettersAvail = [...groupsAll.keys()].sort((a, b) => a.localeCompare(b));
      if (recLetter !== '*' && (recLetter === null || !groupsAll.has(recLetter))) {
        recLetter = groupsAll.has('A') ? 'A' : (lettersAvail[0] || '*');
      }
      const activeL = q ? '*' : recLetter; // a search always looks across every letter
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      alphaEl.hidden = false;
      alphaEl.innerHTML = `<button type="button" data-l="*" class="${activeL === '*' ? 'on' : ''}" aria-pressed="${activeL === '*' ? 'true' : 'false'}" aria-label="Show every letter">All</button>` + letters.map((L) =>
        `<button type="button" data-l="${L}" class="${activeL === L ? 'on' : ''}" aria-pressed="${activeL === L ? 'true' : 'false'}" ${groupsAll.has(L) ? '' : 'disabled'} aria-label="${activeL === L ? 'Show every letter' : 'Show only ' + L}">${L}</button>`).join('');
      alphaEl.querySelectorAll('button[data-l]:not([disabled])').forEach((b) => {
        b.addEventListener('click', () => { recLetter = b.dataset.l === '*' ? '*' : (recLetter === b.dataset.l ? '*' : b.dataset.l); renderRecipients(); });
      });
      const groups = activeL !== '*' ? new Map([[activeL, groupsAll.get(activeL)]]) : groupsAll;
      if (activeL !== '*') {
        const es = groupsAll.get(activeL);
        $('rec-count').textContent = `${num(es.length)} under \u201c${activeL}\u201d${SY !== null ? ' in ' + SY : ''} \u00b7 ${money(es.reduce((s, e) => s + e.total, 0))} \u2014 \u201cAll\u201d shows every letter`;
      }
      $('rec-rows').innerHTML = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([L, es]) => `
        <li class="letter-head" id="letter-${L}">${L}<span class="lh-n">${num(es.length)} · ${money(es.reduce((s,e)=>s+e.total,0))}</span></li>
        ${es.map((e, ri) => item(e, ri)).join('')}`).join('');
    } else {
      alphaEl.hidden = true;
      list.sort((a, b) => b.total - a.total);
      const N = isMobile() ? 25 : 50;
      const showAll = recExpanded || q || list.length <= N;
      const slice = showAll ? list : list.slice(0, N);
      $('rec-rows').innerHTML = slice.map((e, ri) => item(e, ri)).join('') + (showAll ? '' :
        `<li><button type="button" class="show-all" id="rec-more">Show all ${num(list.length)} ${recipWord(list.length)} — top ${N} shown, ${money(list.slice(N).reduce((s,e)=>s+e.total,0))} in the rest</button></li>`);
      const more = document.getElementById('rec-more');
      if (more) more.addEventListener('click', () => { recExpanded = true; renderRecipients(); });
    }
    $('rec-rows').querySelectorAll('.rec-item').forEach((b) => {
      b.addEventListener('click', () => openProfile(b.dataset.ent));
    });
  }
  $('rs-total').addEventListener('click', () => {
    recSort = 'total';
    $('rs-total').classList.add('active'); $('rs-total').setAttribute('aria-pressed','true');
    $('rs-name').classList.remove('active'); $('rs-name').setAttribute('aria-pressed','false');
    renderRecipients();
  });
  $('rs-name').addEventListener('click', () => {
    recSort = 'name';
    $('rs-name').classList.add('active'); $('rs-name').setAttribute('aria-pressed','true');
    $('rs-total').classList.remove('active'); $('rs-total').setAttribute('aria-pressed','false');
    renderRecipients();
  });
  let rqTimer = null;
  $('rec-q').addEventListener('input', () => {
    clearTimeout(rqTimer);
    rqTimer = setTimeout(() => { recQ = $('rec-q').value; writeHash(false); renderRecipients(); }, 160);
  });
  // collapse again when the tab is re-entered
  $('tab-recipients').addEventListener('click', () => { recExpanded = false; });

  // ---------- recipient profile drawer ----------
  let lastFocus = null;
  let profileScopeY = null;
  const bgInert = (on) => {
    [...document.body.children].forEach((el) => {
      if (el.id === 'profile' || el.id === 'pf-backdrop' || el.tagName === 'SCRIPT' || el.tagName === 'NOSCRIPT') return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  };
  function openProfile(id, fromHash) {
    const e = entities.get(id);
    if (!e) return;
    const wasOpen = profileId !== null;
    profileId = id;
    profileScopeY = state.y;
    state.pr = id;
    if (!fromHash) writeHash(true);
    if (!wasOpen) lastFocus = document.activeElement;
    const per = YEARS.map((y) => ({
      y,
      sum: e.grants.filter((g) => g.y === y).reduce((s, g) => s + g.a, 0),
      count: e.grants.filter((g) => g.y === y).length
    })).filter((p) => p.count > 0);
    const maxP = Math.max(...per.map((p) => p.sum));
    $('pf-title').textContent = dc(e.display);
    $('pf-sub').textContent = `${money(e.total)} · ${num(e.count)} ${grantsWord(e.count)} · ${[...e.years].sort().join(', ')}`;
    $('pf-aliases').innerHTML = e.aliases.length > 1
      ? `<div class="pf-h">As filed (${num(e.aliases.length)} name variants, merged — reviewed)</div>` +
        e.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')
      : `<div class="pf-h">As filed</div><code>${esc(e.aliases[0])}</code>`;
    $('pf-years').innerHTML = per.map((p) => barRow(String(p.y), p.sum, maxP, {
      val: `${money(p.sum)} · ${p.count}`,
      cls: 'is-btn pf-yr', attrs: `data-y="${p.y}" role="button" tabindex="0" aria-label="Filter the ledger to ${dc(e.display)} in ${p.y}"`
    })).join('');
    $('pf-years').querySelectorAll('.pf-yr').forEach((r) => {
      const go = () => { state.r = id; state.y = +r.dataset.y; state.page = 0; closeProfile(false, true); setTab('grants'); };
      r.addEventListener('click', go);
      r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
    $('pf-grants').innerHTML = e.grants.slice().sort((a, b) => b.y - a.y || b.a - a.a).map((g) => `
      <li class="pf-g">
        <span class="pf-gy">${g.y}</span>
        <span class="pf-gp" title="As filed: ${esc(g.p)}">${esc(dc(g.p))}</span>
        <span class="pf-ga">${money(g.a)}</span>
      </li>`).join('');
    const inY = state.y !== null ? e.grants.filter((g) => g.y === state.y).length : 0;
    const keepY = state.y !== null && inY > 0;
    $('pf-all').textContent = keepY
      ? `Open ${num(inY)} ${state.y} ${grantsWord(inY)} in the ledger`
      : `Open all ${num(e.count)} lifetime ${grantsWord(e.count)} in the ledger`;
    $('pf-all').onclick = () => { state.r = id; if (!keepY) state.y = null; state.page = 0; closeProfile(false, true); setTab('grants'); };
    $('profile').hidden = false;
    $('pf-backdrop').hidden = false;
    bgInert(true);
    requestAnimationFrame(() => {
      $('profile').classList.add('open');
      $('pf-backdrop').classList.add('open');
      if (!wasOpen) $('pf-close').focus();
    });
    document.body.style.overflow = 'hidden';
  }
  function closeProfile(restore, fromHash) {
    profileId = null;
    state.pr = null;
    if (!fromHash) writeHash(true);
    bgInert(false);
    $('profile').classList.remove('open');
    $('pf-backdrop').classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { $('profile').hidden = true; $('pf-backdrop').hidden = true; }, 240);
    if (restore !== false && lastFocus) lastFocus.focus();
  }
  $('profile').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...$('profile').querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('pf-close').addEventListener('click', () => closeProfile());
  $('pf-backdrop').addEventListener('click', () => closeProfile());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (profileId !== null) { closeProfile(); return; }
      if (state.tab === 'grants' && (state.y !== null || state.r !== null || state.c !== null || state.q || state.min)) {
        state.y = null; state.r = null; state.c = null; state.q = ''; state.min = 0; state.page = 0;
        syncControls(); writeHash(true); render();
      }
    }
  });

  // ---------- grants tab ----------
  const PAGE_DESK = 60, PAGE_MOB = 20;
  // an unitemized row names no recipient, so it has no profile: it is text, not a control
  const UNITEMIZED_TITLE = 'Unitemized disclosure: the filing reports this amount without naming a recipient, so there is no recipient profile to open';
  const pageSize = () => isMobile() ? PAGE_MOB : PAGE_DESK;

  function renderScopeChips() {
    const host = $('chips');
    let html = '';
    if (state.y !== null) html += `<button type="button" class="scope-chip" data-clear="y">Tax year ${state.y} <span class="chip-x" aria-hidden="true">✕</span><span class="sr-only">, remove year filter</span></button>`;
    if (state.r !== null) {
      const e = entities.get(state.r);
      html += `<button type="button" class="scope-chip" data-clear="r">${esc(dc(e.display))} <span class="chip-x" aria-hidden="true">✕</span><span class="sr-only">, remove recipient filter</span></button>`;
    }
    if (state.c !== null) {
      html += `<button type="button" class="scope-chip" data-clear="c">${esc(state.c)} <span class="chip-x" aria-hidden="true">✕</span><span class="sr-only">, remove category filter</span></button>`;
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-clear]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.clear === 'y') state.y = null;
        else if (b.dataset.clear === 'r') state.r = null;
        else state.c = null;
        state.page = 0; syncControls(); writeHash(true); render();
      });
    });
    $('clear-all').hidden = !(state.y !== null || state.r !== null || state.c !== null || state.q || state.min);
  }

  function renderGrants() {
    const rows = viewRows();
    const sum = rows.reduce((s, g) => s + g.a, 0);
    const P = pageSize();
    const maxPage = Math.max(0, Math.ceil(rows.length / P) - 1);
    if (state.page > maxPage) state.page = maxPage;
    const start = state.page * P;
    const slice = rows.slice(start, start + P);

    const parts = [];
    if (state.r !== null) parts.push(dc(entities.get(state.r).display));
    if (state.y !== null) parts.push('Tax year ' + state.y);
    if (state.c !== null) parts.push(state.c);
    {
      const label = `${parts.length ? parts.join(' · ') + ' · ' : ''}${num(rows.length)} ${grantsWord(rows.length)} · `;
      const vl = $('view-line');
      const prev = +(vl.dataset.sum || 0);
      vl.dataset.sum = sum;
      vl.textContent = label + money(sum) + ' in view'
        + (rowsPending ? ` \u00b7 the ${num(grants.length)} largest of ${num(ROWS_TOTAL)} rows so far, full list loading` : '');
    }

    // desktop table
    $('grant-tbody').innerHTML = slice.map((g, ri) => `
      <tr style="--ri:${Math.min(ri, 18)}">
        <td><button type="button" class="ycell" data-y="${g.y}" aria-label="Filter to tax year ${g.y}">${g.y}</button></td>
        <td>${g.record_type === 'unitemized'
          ? `<span class="recip-flat" style="font-weight:600" title="${UNITEMIZED_TITLE}">${esc(dc(g.r))} · unitemized disclosure</span>`
          : `<button type="button" class="recip" data-rec="${esc(g.r)}" title="As filed: ${esc(g.r)}">${esc(dc(g.r))}</button>`}</td>
        <td class="amt">${money(g.a)}</td>
        <td class="purpose" title="As filed: ${esc(g.p)}">${esc(dc(g.p))}</td>
        <td class="loc">${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</td>
      </tr>`).join('');
    // mobile cards
    $('grant-cards').innerHTML = slice.map((g, ri) => `
      <li class="gcard" style="--ri:${Math.min(ri, 12)}">
        ${g.record_type === 'unitemized'
          ? `<div class="gcard-flat" style="padding:0.85rem 0.35rem;border-bottom:1px solid var(--rule)" title="${UNITEMIZED_TITLE}">`
          : `<button type="button" class="gcard-btn" data-rec="${esc(g.r)}" aria-label="${esc(dc(g.r))}, ${money(g.a)}, ${g.y}. Opens the recipient profile.">`}
          <div class="gc-top"><span class="gc-y">${g.y}</span><span class="gc-a">${money(g.a)}</span></div>
          <div class="gc-r">${esc(dc(g.r))}${g.record_type === 'unitemized' ? ' · unitemized disclosure' : ''}</div>
          <div class="gc-p">${esc(dc(g.p))}</div>
          <div class="gc-l">${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</div>
        ${g.record_type === 'unitemized' ? '</div>' : '</button>'}
      </li>`).join('');
    $('empty').hidden = slice.length > 0;

    const from = rows.length ? start + 1 : 0;
    const to = Math.min(start + P, rows.length);
    $('page-info').textContent = rows.length
      ? `Showing ${num(from)}–${num(to)} of ${num(rows.length)}`
      : 'No matching grants';
    $('prev-page').disabled = state.page === 0;
    $('next-page').disabled = to >= rows.length;

    document.querySelectorAll('#grant-thead th[data-sort]').forEach((th) => {
      const s = th.dataset.sort;
      const active = state.sort.startsWith(s + '-');
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (state.sort.endsWith('asc') ? 'ascending' : 'descending') : 'none');
    });
    document.querySelectorAll('.lt-year').forEach((b) => {
      const on = b.dataset.y === 'all' ? state.y === null : +b.dataset.y === state.y;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderScopeChips();
    if (typeof setToolsH === 'function') setToolsH();
  }

  function syncControls() {
    $('q').value = state.q;
    $('sort').value = state.sort;
    $('min-amt').value = String(state.min);
    if ($('cat-sel')) $('cat-sel').value = state.c || '';
  }

  // grants tab wiring
  $('grant-tbody').addEventListener('click', (e) => {
    const y = e.target.closest('.ycell');
    if (y) { state.y = state.y === +y.dataset.y ? null : +y.dataset.y; state.page = 0; writeHash(true); render(); return; }
    const r = e.target.closest('.recip');
    if (r) openProfile(aliasToId.get(r.dataset.rec));
  });
  $('grant-cards').addEventListener('click', (e) => {
    const b = e.target.closest('.gcard-btn');
    if (b) openProfile(aliasToId.get(b.dataset.rec));
  });
  let qTimer = null;
  $('q').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = $('q').value; state.page = 0; writeHash(false); render();
    }, 160);
  });
  $('sort').addEventListener('change', () => { state.sort = $('sort').value; state.page = 0; writeHash(true); render(); });
  $('min-amt').addEventListener('change', () => { state.min = +$('min-amt').value; state.page = 0; writeHash(true); render(); });
  function fillCatSel() {
    const sel = $('cat-sel');
    [...sel.querySelectorAll('option')].slice(1).forEach((o) => o.remove());   // the first option is "every purpose"
    sel.innerHTML += catList.map((c) => `<option value="${esc(c.key)}">${esc(c.key)}</option>`).join('');
    sel.value = state.c || '';
  }
  fillCatSel();
  $('cat-sel').addEventListener('change', () => { state.c = $('cat-sel').value || null; state.page = 0; writeHash(true); render(); });

  // typeahead: recipients and categories become precise filters; plain text is the fallback
  let cityIx = [], buildCityIx = null;
  {
    const qEl = $('q'), box = $('q-suggest');
    buildCityIx = () => {
      const m = new Map();
      grants.forEach((g) => {
        if (!g.c) return;
        const k = g.c + '|' + g.s;
        if (!m.has(k)) m.set(k, { city: g.c, st: g.s, count: 0, sum: 0 });
        const t = m.get(k); t.count++; t.sum += g.a;
      });
      cityIx = [...m.values()].sort((a, b) => b.sum - a.sum);
    };
    buildCityIx();
    let sugIdx = -1;
    const close = () => { box.hidden = true; box.innerHTML = ''; sugIdx = -1; qEl.setAttribute('aria-expanded', 'false'); };
    const apply = (el) => {
      const t = el.dataset.t;
      if (t === 'r') { state.r = el.dataset.v; state.q = ''; }
      else if (t === 'c') { state.c = el.dataset.v; state.q = ''; }
      else if (t === 'l') { state.q = el.dataset.v; }
      else { state.q = qEl.value.trim(); }
      state.page = 0; syncControls(); writeHash(true); render(); close();
    };
    const build = () => {
      const v = qEl.value.trim().toLowerCase();
      if (v.length < 2) { close(); return; }
      const ents = entList.filter((e) => e.display.toLowerCase().includes(v) || e.aliases.some((a) => a.toLowerCase().includes(v))).slice(0, 6);
      const cats = catList.filter((c) => c.key.toLowerCase().includes(v)).slice(0, 2);
      box.innerHTML = ents.map((e) =>
        `<button type="button" class="q-sug" role="option" data-t="r" data-v="${esc(e.id)}"><span class="qs-kind">Recipient</span><span class="qs-name">${esc(dc(e.display))}</span><span class="qs-meta">${num(e.count)} ${grantsWord(e.count)} \u00b7 ${moneyCompact(e.total)}</span></button>`).join('')
        + cats.map((c) =>
        `<button type="button" class="q-sug" role="option" data-t="c" data-v="${esc(c.key)}"><span class="qs-kind">Purpose</span><span class="qs-name">${esc(c.key)}</span><span class="qs-meta">${num(c.count)} ${grantsWord(c.count)}</span></button>`).join('')
        + cityIx.filter((x) => (x.city + ', ' + x.st).toLowerCase().includes(v)).slice(0, 3).map((x) =>
        `<button type="button" class="q-sug" role="option" data-t="l" data-v="${esc(dc(x.city))}"><span class="qs-kind">Location</span><span class="qs-name">${esc(dc(x.city))}, ${esc(x.st)}</span><span class="qs-meta">${num(x.count)} ${grantsWord(x.count)} · ${moneyCompact(x.sum)}</span></button>`).join('')
        + `<button type="button" class="q-sug" role="option" data-t="q"><span class="qs-kind">Search</span><span class="qs-name">Search \u201c${esc(qEl.value.trim())}\u201d across every field</span></button>`;
      box.hidden = false; sugIdx = -1; qEl.setAttribute('aria-expanded', 'true');
    };
    qEl.addEventListener('input', build);
    qEl.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      const opts = [...box.querySelectorAll('.q-sug')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : opts.length - 1) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle('on', i === sugIdx));
      } else if (e.key === 'Enter' && sugIdx >= 0) { e.preventDefault(); apply(opts[sugIdx]); }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', (e) => { const s = e.target.closest('.q-sug'); if (s) { e.preventDefault(); apply(s); } });
    qEl.addEventListener('blur', () => setTimeout(close, 150));
  }
  document.querySelectorAll('.lt-year').forEach((b) => {
    b.addEventListener('click', () => {
      state.y = b.dataset.y === 'all' ? null : (state.y === +b.dataset.y ? null : +b.dataset.y);
      state.page = 0; writeHash(true); render();
    });
  });
  $('clear-all').addEventListener('click', () => {
    state.y = null; state.r = null; state.c = null; state.q = ''; state.min = 0; state.page = 0;
    syncControls(); writeHash(true); render();
  });
  function gotoPage(p) {
    state.page = p; writeHash(true); renderGrants();
    $('ledger-top').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  $('prev-page').addEventListener('click', () => { if (state.page > 0) gotoPage(state.page - 1); });
  $('next-page').addEventListener('click', () => gotoPage(state.page + 1));
  document.querySelectorAll('#grant-thead th[data-sort]').forEach((th) => {
    const s = th.dataset.sort;
    const act = () => {
      state.sort = state.sort.startsWith(s + '-')
        ? (state.sort.endsWith('desc') ? s + '-asc' : s + '-desc')
        : (s === 'recipient' || s === 'purpose' ? s + '-asc' : s + '-desc');
      $('sort').value = state.sort;
      state.page = 0; writeHash(true); render();
    };
    th.addEventListener('click', act);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    th.tabIndex = 0;
  });

  // CSV of the current view
  $('csv-btn').addEventListener('click', () => {
    const rows = viewRows();
    const NLc = String.fromCharCode(10);
    const head = 'tax_year,recipient_as_filed,canonical_recipient,amount,purpose_as_filed,city,state,irs_object_id,record_type';
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return (s.indexOf('"') >= 0 || s.indexOf(',') >= 0 || s.indexOf(NLc) >= 0)
        ? '"' + s.split('"').join('""') + '"' : s;
    };
    const csv = [head].concat(rows.map((g) =>
      [g.y, g.r, (entities.get(aliasToId.get(g.r)) || {}).display || '', g.a, g.p, g.c, g.s, g.o, g.record_type || 'named_recipient'].map(cell).join(','))).join(NLc);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const bits = [];
    if (state.r !== null) bits.push(entities.get(state.r).display.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40));
    if (state.y !== null) bits.push(String(state.y));
    a.download = (document.documentElement.dataset.slug || 'oishei') + '-grants' + (bits.length ? '-' + bits.join('-') : '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  // copy link — full state, success only on confirmed write
  $('link-btn').addEventListener('click', () => {
    writeHash(false);
    const url = location.href;
    const btn = $('link-btn');
    const ok = () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy link'; }, 1500); };
    const fail = () => { btn.textContent = 'Copy failed — use the address bar'; setTimeout(() => { btn.textContent = 'Copy link'; }, 2400); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, fail);
    } else fail();
  });

  // ---------- methodology ----------
  function renderMethodology() {
    // every filed tax period gets a card — including a year the foundation filed but paid
    // no grants, which still reconciles ($0 = $0) and is part of the badge's N/N claim
    $('tie-cards').innerHTML = Object.keys(tieout).sort().map((y) => {
      const t = tieout[y];
      return `
        <div class="tie-card">
          <div class="tc-top"><span class="tc-y">${y}</span><span class="mini-seal">${(t.line25_col_d - t.grant_sum) === 0 ? 'Δ $0 ✓' : 'Δ ' + money(t.line25_col_d - t.grant_sum)}</span></div>
          <div class="tc-row"><span>Grant schedule sum</span><strong>${money(t.grant_sum)}</strong></div>
          <div class="tc-row"><span>Part I line 25 (d)</span><strong>${money(t.line25_col_d)}</strong></div>
          <div class="tc-row"><span>Grant rows</span><strong>${num(t.grant_count)}</strong></div>
          <div class="tc-row"><span>Δ</span><strong>${money(t.line25_col_d - t.grant_sum)}</strong></div>
          <div class="tc-obj">Object ID <code>${t.object_id}</code></div>
        </div>`;
    }).join('');
    $('ent-table').innerHTML = mergedEntities.map((e) => `
      <li class="ent-row">
        <strong>${esc(dc(e.display))}</strong>
        <span class="ent-aliases">${e.aliases.map((a) => '<code>' + esc(a) + '</code>').join(' ')}</span>
      </li>`).join('');
    $('ent-note').textContent =
      `${num(entList.length)} canonical ${recipWord(entList.length)} from ${num(aliasToId.size)} as-filed name ${plural(aliasToId.size, 'string')}. ` +
      `${num(mergedEntities.length)} ${plural(mergedEntities.length, 'merge')}, each reviewed by hand (parenthetical DBA or acronym, leading/trailing "The", or punctuation-only variants of the same organization). ` +
      `No EIN appears in ${Number(document.documentElement.dataset.n || 857) === 1 ? 'the single filed row' : 'any of the ' + num(Number(document.documentElement.dataset.n || 857)) + ' filed rows'}, so merges rest on the name evidence shown here — anything less certain stays unmerged.`;
    if (rowsPending) { $('ent-table').innerHTML = ''; $('ent-note').textContent = waitLine(); }
  }

  // ---------- render ----------
  // the headline strip sits above every tab, so it follows the scope on every render
  function renderKpis() {
    const SY = state.y;
    $('kpi-orgs').textContent = num(SY === null ? entList.length : entList.filter((e) => e.years.has(SY)).length);
    $('kpi-orgs').parentElement.querySelector('.k-hint').textContent =
      SY === null ? 'Organizations the foundation funded · ' + (document.documentElement.dataset.names || '296 as-filed names') : `Organizations funded in ${SY}`;
    const amts = (SY === null ? grants : grants.filter((g) => g.y === SY)).map((g) => g.a).sort((a, b) => a - b);
    const md = amts.length === 0 ? 0
      : amts.length % 2 ? amts[(amts.length - 1) / 2]
      : (amts[amts.length / 2 - 1] + amts[amts.length / 2]) / 2;   // even count: a half dollar
    $('kpi-median').textContent = money(md);
    $('kpi-median').parentElement.querySelector('.k-hint').textContent =
      SY === null ? (Number(document.documentElement.dataset.n || 857) === 1 ? 'The single filed grant' : 'Across all ' + num(Number(document.documentElement.dataset.n || 857)) + ' grants') : `Across ${num(byYear[SY].count)} ${grantsWord(byYear[SY].count)} in ${SY}`;
    const scopedNamed = SY === null ? namedGrants : namedGrants.filter((g) => g.y === SY);
    const namedAmounts = scopedNamed.map((g) => g.a).sort((a, b) => a - b);
    const mid = Math.floor(namedAmounts.length / 2);
    $('kpi-median').textContent = !namedAmounts.length ? '—' : money(namedAmounts.length % 2
      ? namedAmounts[mid] : (namedAmounts[mid - 1] + namedAmounts[mid]) / 2);
    $('kpi-median').parentElement.querySelector('.k-hint').textContent =
      `${num(scopedNamed.length)} named-recipient rows${SY === null ? ', all filed years' : ' in ' + SY}`;
    $('kpi-orgs').parentElement.querySelector('.k-hint').textContent =
      `Named recipients${SY === null ? ', all filed years' : ' in ' + SY}`;
    // Typical grant: the middle half of named grants (25th to 75th percentile).
    // A range says more to a grant writer than one median; "could we fit" starts here.
    {
      const q = (arr, p) => { if (!arr.length) return null; const i = (arr.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };
      const q1 = q(namedAmounts, 0.25), q3 = q(namedAmounts, 0.75);
      const el = $('kpi-range');
      if (el) el.textContent = q1 === null ? '\u2014' : (q1 === q3 ? moneyCompact(q1) : moneyCompact(q1) + '\u2013' + moneyCompact(q3));
      const fit = $('fit-line');
      if (fit) {
        const latest = LATEST, nw = newIn[latest] || 0, ret = returningIn[latest] || 0, tot = nw + ret;
        const byState = new Map();
        namedGrants.forEach((g) => { if (g.s) byState.set(g.s, (byState.get(g.s) || 0) + g.a); });
        const top = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        const namedSum = namedGrants.reduce((s, g) => s + g.a, 0) || 1;
        const parts = [];
        if (tot) parts.push(`In ${latest}, ${Math.round(nw / tot * 100)}% of recipients were funded for the first time in this record`);
        if (top.length) parts.push(`${Math.round(top.reduce((s, x) => s + x[1], 0) / namedSum * 100)}% of named dollars went to recipients in ${top.map((x) => x[0]).join(', ')}`);
        fit.hidden = !parts.length || rowsPending;
        fit.textContent = parts.length ? parts.join(' \u00b7 ') + '. Historical record, not eligibility.' : '';
      }
    }
    const coverage = document.getElementById('record-coverage');
    if (coverage) {
      const rolled = unitemized.filter((g) => SY === null || g.y === SY);
      coverage.hidden = !rolled.length;
      coverage.textContent = `${num(scopedNamed.length)} named-recipient rows · ${money(scopedNamed.reduce((sum, g) => sum + g.a, 0))}. `
        + `${num(rolled.length)} unitemized ${rolled.length === 1 ? 'disclosure' : 'disclosures'} · ${money(rolled.reduce((sum, g) => sum + g.a, 0))} retained in filed totals. `
        + 'Unnamed disclosures are excluded from recipient counts, grant medians and recipient comparisons.';
    }
    if (rowsPending) {   // a median of the largest rows is not the median; the stamp is the only true count
      $('kpi-orgs').textContent = SY === null ? STAMPED_ORGS : '\u2026';
      $('kpi-orgs').parentElement.querySelector('.k-hint').textContent = SY === null ? 'Named recipients, all filed years' : `Named recipients in ${SY} \u2014 full list loading`;
      $('kpi-median').textContent = '\u2026';
      $('kpi-median').parentElement.querySelector('.k-hint').textContent = waitLine();
      if (coverage) coverage.hidden = true;
    }
    const en = document.getElementById('explore-note');
    if (en) {
      const saved = [];
      if (state.c !== null) saved.push(state.c);
      if (state.r !== null) { const e = entities.get(state.r); if (e) saved.push(dc(e.display)); }
      if (state.q) saved.push('\u201c' + state.q + '\u201d');
      if (state.min) saved.push(moneyCompact(state.min) + '+');
      if (saved.length && state.tab !== 'grants') {
        en.hidden = false;
        en.innerHTML = 'The ledger opens with your saved view \u2014 ' + esc(saved.join(' \u00b7 ')) +
          ' <button type="button" id="explore-clear">clear it</button>';
        const bx = document.getElementById('explore-clear');
        if (bx) bx.addEventListener('click', () => {
          state.c = null; state.r = null; state.q = ''; state.min = 0; state.page = 0;
          syncControls(); writeHash(true); render();
        });
      } else en.hidden = true;
    }
    const gs = document.getElementById('g-scope');
    if (gs) {
      if (SY === null) gs.hidden = true;
      else {
        gs.hidden = false;
        gs.innerHTML = `<span class="gs-label">In ${SY}</span><span class="gs-val">${money(byYear[SY].sum)}</span><span class="gs-meta">${num(byYear[SY].count)} ${grantsWord(byYear[SY].count)} · ${(() => {
          const ty = tieout[String(SY)];
          const d = ty ? ty.line25_col_d - ty.grant_sum : 0;
          return d === 0 ? 'Δ $0 vs line 25(d)' : 'Δ ' + money(d) + ' vs line 25(d)';
        })()}</span>`;
      }
    }
    const dEl = $('kpi-delta');
    dEl.classList.remove('up', 'down');
    const dy = SY !== null ? SY : LATEST;
    const dp = YEARS.indexOf(dy) > 0 ? YEARS[YEARS.indexOf(dy) - 1] : null; // prior FILED year, not dy-1 (years can be non-contiguous when one is withheld)
    dEl.parentElement.querySelector('.k-label').textContent = SY === null ? 'Latest year' : 'Year change';
    if (dp === null) {
      dEl.textContent = '—';
      $('kpi-delta-hint').textContent = `${dy} is the first filed year in the record`;
    } else {
      const pct = yoyPct(byYear[dy].sum, byYear[dp].sum);
      if (pct === null) {                 // a prior year that paid out nothing is no base
        dEl.textContent = '\u2014';
        $('kpi-delta-hint').textContent = `${dp} paid out nothing \u2014 no change to state`;
      } else {
        dEl.textContent = (pct > 0 ? '+' : '\u2212') + Math.abs(pct).toFixed(1) + '%';
        dEl.classList.add(pct >= 0 ? 'up' : 'down');
        $('kpi-delta-hint').textContent = `${dy} vs ${dp} disbursements`;
      }
    }
  }

  function render() {
    if (typeof syncSide === 'function') syncSide();
    syncControls();   // one sync point: every path that changes state gets reflected in the controls
    renderKpis();
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'recipients') renderRecipients();
    else if (state.tab === 'grants') renderGrants();
    else renderMethodology();
  }

  function syncProfile() {
    if (state.pr !== null && (profileId !== state.pr || profileScopeY !== state.y)) openProfile(state.pr, true);
    else if (state.pr === null && profileId !== null) closeProfile(true, true);
  }
  window.addEventListener('hashchange', () => { readHash(); syncControls(); setTab(state.tab, false); syncProfile(); });
  window.addEventListener('popstate', () => { readHash(); syncControls(); setTab(state.tab, false); syncProfile(); });
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (state.tab === 'grants') renderGrants(); }, 200); });

  // verify console — the referee, re-run in the reader's own browser, on the full list only
  function verifyRows() {
    const gt = grants.reduce((s, g) => s + g.a, 0);
    console.assert(gt === Number(document.documentElement.dataset.grand || 64172055), 'grand total', gt);
    console.assert(grants.length === Number(document.documentElement.dataset.n || 857), 'count', grants.length);
    YEARS.forEach((y) => {
      console.assert(byYear[y].sum === tieout[String(y)].grant_sum, 'year sum', y);
      console.assert(byYear[y].count === tieout[String(y)].grant_count, 'year count', y);
    });
  }

  // ---------- the full list: fetched beside the page, never assumed ----------
  // One status line above the tabs says what is in hand. It is removed when the list lands;
  // a failed fetch leaves the preview usable and offers a retry instead of a silent partial page.
  const rowsStatus = (() => {
    let node = null;
    return (mode) => {
      if (mode === null) { if (node) node.remove(); node = null; return; }
      if (!node) {
        node = document.createElement('p');
        node.id = 'rows-status'; node.className = 'mini-note';
        node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
        node.style.cssText = 'padding:0.75rem 1.25rem;border:1px solid #bca87c;background:#fff7e7;margin:1rem 0;line-height:1.6';
        const host = document.querySelector('.sheet-kpis');
        if (host) host.insertAdjacentElement('afterend', node); else document.body.prepend(node);
      }
      const shown = `${num(grants.length)} largest of ${num(ROWS_TOTAL)} ${grantsWord(ROWS_TOTAL)}`;
      if (mode === 'loading') node.textContent = `Loading the full grant list \u2014 ${num(ROWS_TOTAL)} rows. The ${shown} are shown meanwhile.`;
      else {
        node.innerHTML = `The full grant list did not load \u2014 the ${esc(shown)} are shown. `
          + '<button type="button" id="rows-retry" class="show-all" style="width:auto;margin:0 0 0 0.4rem;padding:0.3rem 0.8rem">Retry</button>';
        $('rows-retry').addEventListener('click', loadRows);
      }
    };
  })();
  function swapRows(rows) {
    rowsPending = false;
    if (printWhenReady) { printWhenReady = false; printReport(); }
    deriveModel(rows, true);
    ensureCoverageNote();
    fillCatSel();
    buildCityIx();
    if (pendingRef) {   // the link that arrived before its rows
      if (pendingRef.r && state.r === null) state.r = entities.has(pendingRef.r) ? pendingRef.r : (aliasToId.get(pendingRef.r) || null);
      if (pendingRef.r && state.r === null && !state.q) state.q = pendingRef.r;   // still unknown after the full list: search for it
      if (pendingRef.pr && state.pr === null && entities.has(pendingRef.pr)) state.pr = pendingRef.pr;
      pendingRef = null;
    }
    syncControls(); render(); writeHash(false);   // render first: a page number the full list clamps is written back
    if (state.pr !== null) openProfile(state.pr, true);   // an open profile now shows every grant
    renderCatMap();
    verifyRows();
    rowsStatus(null);
  }
  let rowsReq = 0;
  function loadRows() {
    if (!rowsPending || typeof fetch !== 'function') { if (rowsPending) rowsStatus('failed'); return; }
    const req = ++rowsReq;
    rowsStatus('loading');
    fetch(ROWS_SRC)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((full) => {
        if (req !== rowsReq) return;
        const rows = Array.isArray(full) ? full : (full && full.grants);
        if (!Array.isArray(rows) || rows.length !== ROWS_TOTAL) throw new Error('expected ' + ROWS_TOTAL + ' rows, got ' + (Array.isArray(rows) ? rows.length : 'none'));
        swapRows(rows);
      })
      .catch((err) => {
        if (req !== rowsReq) return;
        console.warn('full grant list did not load', err);
        rowsStatus('failed');
      });
  }

  // sticky toolbar: cast a shadow only when actually stuck, and export its height
  const toolsEl = $('ledger-tools');
  const sentinel = $('tools-sentinel');
  if (toolsEl && sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      toolsEl.classList.toggle('stuck', !en.isIntersecting);
    }, { threshold: 0 }).observe(sentinel);
  }
  window.setToolsH = setToolsH;
  function setToolsH() {
    if (toolsEl) document.documentElement.style.setProperty('--tools-h', toolsEl.offsetHeight + 'px');
    const tabs = document.getElementById('tablist');
    if (tabs) document.documentElement.style.setProperty('--tabs-h', tabs.offsetHeight + 'px');
  }
  {
    const tabs = document.getElementById('tablist');
    if (tabs && 'IntersectionObserver' in window) {
      const s = document.createElement('div');
      tabs.parentNode.insertBefore(s, tabs);
      new IntersectionObserver(([en]) => {
        tabs.classList.toggle('stuck', !en.isIntersecting);
      }, { threshold: 0 }).observe(s);
    }
  }
  setToolsH();
  window.addEventListener('resize', () => setTimeout(setToolsH, 120));

  document.getElementById('return-chip').addEventListener('click', () => {
    if (!returnTo) return;
    const to = returnTo;
    returnTo = null;
    state.c = to.c; state.r = to.r; state.q = to.q; state.min = to.min; state.page = 0;
    syncControls();
    setTab(to.tab);
    requestAnimationFrame(() => window.scrollTo({ top: to.scrollY, behavior: 'instant' }));
  });

  // the purpose map — the classifier itself, rendered as a table
  function renderCatMap() {
    const host = $('cat-map');
    if (!host) return;
    if (rowsPending) { host.innerHTML = `<p class="cm-note">${waitLine()}</p>`; return; }
    const kwPretty = (kw) => kw.split('|').map((t) => t
      .replace(/\\b/g, '')
      .replace(/\[- \]\?/g, '-')
      .replace(/ \?/g, ' ')
      .replace(/S\?/g, '(S)')
      .replace(/Y\?/g, '(Y)')
      .toLowerCase()).join(', ');
    const row = (c, tier) => {
      const t = catTotals.get(c.key);
      if (!t) return '';
      return `<tr>
        <td class="cm-cat"><span class="cm-sw" style="background:${catColorOf(c.key)}"></span>${esc(c.key)}<span class="cm-tier">${tier}</span></td>
        <td class="cm-kw">${esc(kwPretty(c.kw))}</td>
        <td class="cm-n">${num(t.count)}</td>
        <td class="cm-v">${money(t.sum)}</td>
        <td class="cm-p">${share(t.sum, GRAND)}</td>
      </tr>`;
    };
    const other = catTotals.get(CAT_OTHER) || { sum: 0, count: 0 };
    let s2sum = 0, s2count = 0;
    catTotals.forEach((t) => { s2sum += t.s2sum || 0; s2count += t.s2count || 0; });
    host.innerHTML = `<div class="cm-wrap"><table class="cm-table">
      <thead><tr><th>Category</th><th>Decided by these words</th><th>Grants</th><th>Dollars</th><th>Share</th></tr></thead>
      <tbody>
        ${CAT_SUBJECTS.map((c) => row(c, 'field')).join('')}
        ${CAT_MECHANISMS.map((c) => row(c, 'mechanism')).join('')}
        <tr class="cm-other"><td class="cm-cat"><span class="cm-sw" style="background:#c9c2ae"></span>${CAT_OTHER}<span class="cm-tier">no rule</span></td>
          <td class="cm-kw">No listed word appears in the purpose or the recipient name — left unassigned rather than guessed.</td>
          <td class="cm-n">${num(other.count)}</td><td class="cm-v">${money(other.sum)}</td><td class="cm-p">${share(other.sum, GRAND)}</td></tr>
      </tbody></table></div>
      <p class="cm-note">Field rules run first, top to bottom; a mechanism label (capital, operating, endowment) applies only when the purpose names no field. When the purpose names nothing at all, the same field words are read against the recipient\u2019s filed name — that second step decided ${num(s2count)} ${grantsWord(s2count)} (${money(s2sum)}); for example \u201cNext Generation Initiative\u201d carries no field, but its recipient — Buffalo Philharmonic Orchestra Society — does. This table <em>is</em> the classifier: the page runs exactly these rules, nothing more.</p>`;
  }
  renderCatMap();

  // entrance choreography — staggered within a viewport batch
  const rvIO = new IntersectionObserver((entries) => {
    let order = 0;
    entries.forEach((en) => {
      if (en.isIntersecting) {
        const el = en.target;
        el.style.transitionDelay = reducedMotion() ? '0ms' : (order++ * 70) + 'ms';
        el.classList.add('in');
        rvIO.unobserve(el);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.rv').forEach((el) => rvIO.observe(el));

  // the skip link moves focus itself — the hash router never sees #main
  document.querySelector('.skip').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main').focus();
  });

  // the active-tab underline slides instead of jumping
  function positionInk() {
    const tl = document.getElementById('tablist');
    const ink = tl && tl.querySelector('.tab-ink');
    const cur = tl && tl.querySelector('.tab[aria-selected="true"]');
    if (!ink || !cur) return;
    tl.classList.add('has-ink');
    ink.style.left = cur.offsetLeft + 'px';
    ink.style.width = cur.offsetWidth + 'px';
  }
  {
    const tl = document.getElementById('tablist');
    const ink = document.createElement('span');
    ink.className = 'tab-ink';
    ink.setAttribute('aria-hidden', 'true');
    tl.appendChild(ink);
    window.addEventListener('resize', positionInk);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionInk);
    positionInk();
  }

  // list waves fire only when the list itself is half in view — not when the card edge peeks
  {
    const waveIO = ('IntersectionObserver' in window)
      ? new IntersectionObserver((ens, obs) => {
          ens.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('seen'); obs.unobserve(en.target); } });
        }, { threshold: 0.5 })
      : null;
    ['conc-top5', 'newret', 'movers'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (waveIO) waveIO.observe(el); else el.classList.add('seen');
    });
  }

// (the pennies count themselves out via the card.in reveal)

  // the trend draws itself when actually seen — pure CSS class, no shared state
  {
    const tr = document.getElementById('trend');
    if (tr && 'IntersectionObserver' in window) {
      new IntersectionObserver((ens, obs) => {
        ens.forEach((en) => {
          if (en.isIntersecting) { tr.classList.add('seen'); obs.unobserve(tr); }
        });
      }, { threshold: 0.4 }).observe(tr);
    } else if (tr) tr.classList.add('seen');
  }

  // the tie-out performs itself, once, when the band comes into view
  const eq = document.getElementById('db-eq');
  if (eq && !reducedMotion()) {
    eq.classList.add('armed');
    const eqIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        eqIO.unobserve(eq);
        setTimeout(() => { eq.classList.remove('armed'); eq.classList.add('stamped'); }, 650);
      });
    }, { threshold: 0.45 });
    eqIO.observe(eq);
  }

  // the cover wave field — ambient brand texture on the cloth, never on data
  (function () {
    const cv = document.getElementById('wave');
    const cover = document.querySelector('.cover');
    if (!cv || !cover || reducedMotion()) return;
    const ctx2 = cv.getContext('2d');
    let W = 0, H = 0, t = 0, running = true, done = false;
    function size() {
      W = cv.width = cover.clientWidth;
      H = cv.height = cover.clientHeight;
    }
    size();
    window.addEventListener('resize', () => setTimeout(size, 120));
    // ambient motion ends on its own (WCAG 2.2.2): after six seconds, or at the first
    // interaction -- the reader came for the figures, not the cloth. It rests where it is.
    const stop = () => { done = true; running = false; };
    setTimeout(stop, 6000);
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, stop, { once: true, passive: true }));
    document.addEventListener('visibilitychange', () => { running = !document.hidden && !done; if (running) requestAnimationFrame(draw); });
    function draw() {
      if (!running) return;
      t += 0.0035;
      ctx2.clearRect(0, 0, W, H);
      for (let k = 0; k < 3; k++) {
        ctx2.beginPath();
        const base = H * (0.35 + k * 0.18);
        const amp = 14 + k * 9;
        for (let x = 0; x <= W; x += 6) {
          const y = base
            + Math.sin(x / (170 + k * 55) + t * (1 + k * 0.35)) * amp
            + Math.sin(x / (61 + k * 23) - t * 0.7) * (amp * 0.35);
          if (x === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
        }
        ctx2.strokeStyle = 'rgba(242,239,228,' + (0.05 - k * 0.01) + ')';
        ctx2.lineWidth = 1.4;
        ctx2.stroke();
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  })();

  // the same quiet field bookends the page
  (function () {
    const cv = document.getElementById('wave-foot');
    const host = document.querySelector('.foot');
    if (!cv || !host || reducedMotion()) return;
    const c2 = cv.getContext('2d');
    let W = 0, H = 0, t = 0, run = false, done = false, armed = false;
    function size() { W = cv.width = host.clientWidth; H = cv.height = host.clientHeight; }
    size();
    window.addEventListener('resize', () => setTimeout(size, 140));
    // the same six-second clock as the cover, started the first time this field plays
    const stop = () => { done = true; run = false; };
    const arm = () => {
      if (armed) return;
      armed = true;
      setTimeout(stop, 6000);
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, stop, { once: true, passive: true }));
    };
    function draw() {
      if (!run) return;
      t += 0.003;
      c2.clearRect(0, 0, W, H);
      for (let k = 0; k < 2; k++) {
        c2.beginPath();
        const base = H * (0.42 + k * 0.24);
        const amp = 10 + k * 7;
        for (let x = 0; x <= W; x += 7) {
          const y = base + Math.sin(x / (150 + k * 60) + t * (1 + k * 0.4)) * amp;
          if (x === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
        }
        c2.strokeStyle = 'rgba(242,239,228,' + (0.045 - k * 0.012) + ')';
        c2.lineWidth = 1.3;
        c2.stroke();
      }
      requestAnimationFrame(draw);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((ens) => {
        ens.forEach((en) => {
          const was = run; run = !done && en.isIntersecting && !document.hidden;
          if (run && !was) { arm(); requestAnimationFrame(draw); }
        });
      }, { threshold: 0 }).observe(host);
    }
    document.addEventListener('visibilitychange', () => {
      const was = run; run = run && !document.hidden;
      if (!document.hidden && !was && !done) { run = true; arm(); requestAnimationFrame(draw); }
    });
  })();

  // init
  readHash();
  syncControls();
  setTab(state.tab, false);
  if (state.pr !== null) openProfile(state.pr, true);
  if (rowsPending) loadRows(); else verifyRows();
})();