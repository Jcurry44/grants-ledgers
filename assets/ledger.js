// Close-out (2026-09-24), the shared header contract: the header's More menu dismisses like a menu -- a press
// anywhere else, Escape (focus returns to More), or focus leaving it. The hub's own script, the same behaviour on
// every surface; capture phase, so the press that closes it still lands on whatever it was aimed at.
(function () {
  var m = document.querySelector('.gl-top .gl-more'); if (!m) return; var sm = m.querySelector('summary');
  document.addEventListener('pointerdown', function (e) { if (m.open && !m.contains(e.target)) m.open = false; }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && m.open) { m.open = false; sm.focus(); e.stopPropagation(); } }, true);
  m.addEventListener('focusout', function (e) { if (m.open && e.relatedTarget && !m.contains(e.relatedTarget)) m.open = false; });
})();
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
  // the visible tie-card already carries the right referee (Part I 25(d), or
  // Part XIV line 3a on a schedule-referee book) -- read it back once, here, so
  // every consumer (aria-label, methodology tie-cards) agrees with the card.
  const REF_LBL = document.querySelectorAll('#db-eq .eq-part .eq-label')[1]?.textContent || 'Part I line 25(d)';

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
  let namedYears, unitYears;
  let entities, aliasToId, entList, mergedEntities;
  let byYear, median, top5Share, latestDelta;
  let catTotals, catList;
  let firstYearOf, newIn, returningIn, movers;
  const incompleteYear = (y) => !namedYears.has(y) && unitYears.has(y);

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
  // unit is chosen AFTER rounding, so $999,999,999 promotes to $1B instead of
  // printing "$1000M" -- the defect that made a $6,311,161,824 year read "$6311.2M".
  // Below $1,000 the exact figure is both shorter and truer, so it is printed in full.
  // $1,000-$9,999 keeps one K decimal ($7.5K, 2 significant figures) rather than
  // rounding away the only figure that distinguishes it from its neighbors; $10K
  // and up drops the decimal, as it always has.
  const COMPACT_UNITS = [[1e3, 'K'], [1e6, 'M'], [1e9, 'B'], [1e12, 'T']];
  const moneyCompact = (n, keepZeros) => {
    const v = isFinite(Number(n)) ? Number(n) : 0;
    const a = Math.abs(v);
    if (a < 1e3) return money(v);
    let i = Math.max(0, Math.min(COMPACT_UNITS.length - 1, Math.floor(Math.log10(a) / 3) - 1));
    let s;
    for (;;) {
      const q = a / COMPACT_UNITS[i][0];
      s = q.toFixed(i === 0 ? (q < 9.995 ? 1 : 0) : (q < 9.995 ? 2 : 1));
      if (+s < 1000 || i === COMPACT_UNITS.length - 1) break;
      i++;                                              // rounding crossed the unit
    }
    // P4 i2: an all-zero fraction is not precision -- "$1.0K", "$43.0M", "$5.00M" print "$1K", "$43M", "$5M"
    // (build_any's _money_compact stamps the same string into the HTML, so the two stay identical). A chart's
    // labels keep theirs (keepZeros) so one series shares one precision: see yearLabel below.
    if (!keepZeros) s = s.replace(/\.0+$/, '');
    return (v < 0 ? '\u2212$' : '$') + s + COMPACT_UNITS[i][1];
  };
  // The year series (trend columns, the line form's labels, the year tiles) prints at ONE precision: "$43.0M"
  // beside "$43.1M" and "$532.0M" beside "$607.9M", never a ragged "$43M" / "$607.9M" row; a series whose every
  // label is a zero fraction drops them all. Keyed by the sums themselves, so it follows byYear.
  let yearLblKey = null, yearLblMap = null;
  const yearLabel = (y) => {
    const key = YEARS.map((yy) => byYear[yy] ? byYear[yy].sum : 0).join(',');
    if (key !== yearLblKey) {
      const raw = YEARS.map((yy) => moneyCompact(byYear[yy] ? byYear[yy].sum : 0, true));
      const allZero = raw.every((t) => !/\.\d/.test(t) || /\.0+[KMBT]$/.test(t));
      yearLblMap = new Map(YEARS.map((yy, k) => [yy, allZero ? raw[k].replace(/\.0+(?=[KMBT]$)/, '') : raw[k]]));
      yearLblKey = key;
    }
    return yearLblMap.get(y) || moneyCompact(byYear[y] ? byYear[y].sum : 0);
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
  const _KEEPUP = new Set(['LLC','LLP','PLLC','PC','II','III','IV','VI','VII','VIII','IX','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','YMCA','YWCA','BOCES','SUNY','WNY','CTNY','USA','NFTA','ECMC','ECC','WNED','WBFO','NY','DBA','LISC','JRO','AKG','AK360','MSNT','DEI']);
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
  // The one human-readable string a masked row's name may ever show. Every render
  // site checks record_type itself and prints this -- never dc(g.r) or esc(g.r) --
  // so the raw internal MASK sentinel (title-cased by dc() into something worse)
  // never reaches the page, matching what about.html already promises visitors.
  const MASKED_LABEL = 'Individual recipient (name withheld)';
  const MASKED_TITLE = 'The filing names a person here (scholarship, fellowship, hardship or similar); this site withholds every name it publishes. Amount, year, purpose and state are unchanged, so there is no recipient profile to open.';

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
  const ALIASES = window.LEDGER_ALIASES || {};            // as-filed name -> the as-filed name it belongs with (reviewed)
  const GRAND = DATA.meta.grand_total;
  // canonical recipients and the derived analytics are built by deriveModel(), below the
  // purpose rules they depend on -- once for an embedded book, twice for a fetched one

  // ---------- receipts (ux-ledger-02) ----------
  // Every published year already carries a real filing reference (tieout[y].object_id, and
  // each grant row's own `o`). An e-filed one is a bare TEOS object id -- always a real,
  // linkable ProPublica record for this EIN, so it always gets a link. A recovered (scanned)
  // one reads "<ein>_<period>_990PF (IRS scan)" on the tie-out, or "pdf:<ein>_<period>" /
  // "char500:..." on a row -- linked only when a real source URL is on file for that tax
  // period (window.LEDGER_SCAN_URLS, keyed YYYYMM); never guessed at.
  const EIN_DIGITS = String(DATA.meta.ein || '').replace(/\D/g, '');
  const SCAN_URLS = window.LEDGER_SCAN_URLS || {};
  function receiptFor(raw) {
    const s = String(raw || '');
    if (!s) return null;
    if (/^\d+$/.test(s)) return EIN_DIGITS ? { href: `https://projects.propublica.org/nonprofits/organizations/${EIN_DIGITS}/${s}/full`, scan: false } : null;
    const m = s.match(/_(\d{6})(?:_|$)/);
    return (m && SCAN_URLS[m[1]]) ? { href: SCAN_URLS[m[1]], scan: true } : null;
  }
  // renders a linked receipt when one resolves, the same plain caption otherwise -- so a
  // reader can never tell "no link yet" from "we withheld a link", only see the receipt.
  function receiptMark(raw, cls, label) {
    const r = receiptFor(raw);
    const clsAttr = cls ? ` class="${cls}"` : '';
    // P4 (m18): a short label ("Filing ↗") carries the object id in its title; without a resolvable link the
    // label drops its ↗ (an arrow that goes nowhere is a broken promise) and still names the receipt
    const idTitle = label !== undefined ? ` \u00b7 ${esc(raw)}` : '';
    if (r) return `<a${clsAttr} href="${r.href}" target="_blank" rel="noopener" title="${r.scan ? 'Open the scanned filing' : 'Open on ProPublica'}${idTitle}">${esc(label !== undefined ? label : raw)}</a>`;
    const plain = label !== undefined ? String(label).replace(/\s*\u2197\s*$/, '').replace(/\s*↗\s*$/, '') : raw;
    return `<code${clsAttr}${label !== undefined ? ` title="${esc(raw)}"` : ''}>${esc(plain)}</code>`;
  }
  // withheld / $0-filed years, parsed once and shared by the year rail, the moat note and
  // the overview's tie-out exceptions -- one source, so every surface names the same years.
  const WITHHELD = (() => { try { return JSON.parse(document.documentElement.dataset.withheld || '{}'); } catch (e) { return {}; } })();
  const ZEROYRS = (() => { try { return JSON.parse(document.documentElement.dataset.zeroyears || '{}'); } catch (e) { return {}; } })();
  // Close-out (6): a year range is honest about the years it spans. With a withheld year the page's span is the
  // filed record's (published + withheld -- the rail's own span) and says how many are withheld: Beckman reads
  // "2020–2024 · 2 withheld" (5 filed − 2 = the cover's three reconciled years), never "2021–2024" across a
  // withheld 2023. build_any stamps the same span on the hero meta and the side kicker.
  const WH_YEARS = Object.keys(WITHHELD).filter((y) => (WITHHELD[y] || {}).kind === 'withheld').map(Number).sort((a, b) => a - b);
  const NWITH = WH_YEARS.length;
  const SPAN_YEARS = [...new Set([...(Object.keys(tieout).length ? Object.keys(tieout).map(Number) : YEARS), ...WH_YEARS])].sort((a, b) => a - b);
  const SPAN_ALL = SPAN_YEARS.length > 1 ? `${SPAN_YEARS[0]}\u2013${SPAN_YEARS[SPAN_YEARS.length - 1]}` : String(SPAN_YEARS[0]);
  const SPAN_TEXT = SPAN_ALL + (NWITH ? ` \u00b7 ${NWITH} withheld` : '');
  // (2) a caption that covers the whole book says which years that is: "all filed years" only when every filed year
  // is in it; with a year withheld it counts the reconciled ones, as the cover's label does ("three reconciled years")
  const allYearsPhrase = () => NWITH ? `${numWord(FILED_YEARS)} reconciled ${plural(FILED_YEARS, 'year')}` : 'all filed years';
  // (3) a difference carries its sign: \u0394 +$1 (filed above the rows), \u0394 \u2212$32 (below), \u0394 $0
  const signedMoney = (n) => (Number(n) > 0 ? '+' : '') + money(n);
  // ux-ledger-04: a filed year read from the paper filing, not an e-file, carries a
  // non-numeric object id ("<ein>_<period>_990PF (IRS scan)") -- shared by the year
  // rail, the moat note and the trend chart, so every surface agrees on which years these are.
  const SCAN_YEARS = new Set(Object.keys(tieout)
    .filter((y) => { const o = tieout[y].object_id; return o && !/^\d+$/.test(String(o)); })
    .map(Number));

  // ---------- ux-ledger-05: tiny books ----------
  // Fewer than 10 named-recipient rows, or a single "recipient" that reads like the
  // schedule's own line label (a data-lane miss this page still has to render safely
  // around): a median, a typical-grant range and a concentration share all say more
  // about arithmetic on one or two numbers than about the foundation's giving, so they
  // are suppressed in favor of the plain totals and a one-line reason.
  const SCHEDULE_LABEL_RX = /^(GRANTS?\s+(PAID|APPROVED|AWARDED)|STATEMENT|SCHEDULE|SEE\s+(ATTACHED|SCHEDULE|STATEMENT)|SUPPLEMENTARY\s+INFORMATION)\b/i;
  function isTiny() {
    if (namedGrants.length < 10) return true;
    return entList.length <= 3 && entList.some((e) => SCHEDULE_LABEL_RX.test(e.display));
  }

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
  // L-08: a twelve-step, single-hue luminance ramp -- darkest is always the largest
  // named field, and a field past the twelfth never wraps back to a darker shade a
  // bigger field already owns (it holds at the lightest step instead).
  const CAT_SHADES = ['#2f1a05', '#432708', '#5d370d', '#7a4a13', '#96601f', '#b0782f', '#c79045', '#d9aa64', '#e7c28b', '#f1d7b2', '#f7e6cc', '#fbf1e2'];
  const CAT_UNITEMIZED_KEY = 'Unitemized disclosures';
  const catColorOf = (k) => { const c = catList.find((x) => x.key === k); return c ? c.color : '#c9c2ae'; };
  const entYearSum = (e, y) => e.grants.filter((g) => g.y === y).reduce((s, g) => s + g.a, 0);

  // ---------- the model: every row-derived figure, from whichever rows are in hand ----------
  // complete=false means these are the embedded preview rows: the canonical-recipient map,
  // categories and movers are then provisional, and the per-year figures come from the filed
  // tie-out (which the self-check confirms the rows agree with once the full list is in).
  function deriveModel(rows, complete) {
    grants = rows;
    namedGrants = grants.filter((g) => g.record_type !== 'unitemized');
    unitemized = grants.filter((g) => g.record_type === 'unitemized');
    namedYears = new Set(namedGrants.map((g) => g.y));
    unitYears = new Set(unitemized.map((g) => g.y));
    namedTotal = namedGrants.reduce((sum, g) => sum + g.a, 0);
    learnAcronyms(grants);

    // canonical id -> entity {id, display, aliases:Set(as-filed), grants, total, count, years}
    entities = new Map();
    aliasToId = new Map();
    {
      const byFiled = new Map();
      namedGrants.forEach((g) => {
        // A masked individual's g.r is the same literal MASK sentinel across every
        // masked row in the book: grouping it here would fold every scholarship,
        // hardship and medical recipient into one fake "recipient" that dominates
        // Top recipients, Concentration and the recipient profile modal. Their
        // dollars still count in byYear/catTotals/median (computed from grants/
        // namedGrants directly, not from entities) -- they just never become a
        // single rankable, clickable entity.
        if (g.record_type === 'individual_masked') return;
        if (!byFiled.has(g.r)) byFiled.set(g.r, []);
        byFiled.get(g.r).push(g);
      });
      const clusters = new Map();
      [...byFiled.keys()].forEach((name) => {
        const target = ALIASES[name] || name;
        const k = canonKey(target);
        const id = REVIEWED.has(k) ? 'k:' + k : 'n:' + target;
        if (!clusters.has(id)) clusters.set(id, []);
        clusters.get(id).push(name);
      });
      clusters.forEach((names, id) => {
        // display name: the variant with the largest dollars (parenthetical stripped for merged);
        // a reviewed alias source (an OCR variant, a sponsor's other spelling) never becomes the display
        const targets = names.filter((n) => !ALIASES[n]);
        const pool = targets.length ? targets : names;
        let best = pool[0], bestTot = -1;
        pool.forEach((n) => {
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
    {
      let si = 0;
      catList.forEach((c) => {
        if (c.key === CAT_OTHER) { c.color = '#c9c2ae'; return; }
        if (c.key === CAT_UNITEMIZED_KEY) { c.color = '#4e5347'; return; }  // pattern-rendered, not a ramp shade
        c.color = CAT_SHADES[Math.min(si++, CAT_SHADES.length - 1)];
      });
    }
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
  let recLetter = null, recLetterDefault = 'A', recSort = 'total', recExpanded = false; // Recipients tab

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
    recLetter = /^([A-Z#]|\*)$/.test(p.rl || '') ? p.rl : null;
    recSort = p.rs === 'name' ? 'name' : 'total';
    recExpanded = p.rx === '1';
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
    if (recLetter && recLetter !== recLetterDefault) parts.push('rl=' + encodeURIComponent(recLetter));
    if (recSort !== 'total') parts.push('rs=' + recSort);
    if (recExpanded) parts.push('rx=1');
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
  let printBusy = false;
  function setPrintBusy(on) {
    document.querySelectorAll('#print-btn').forEach((b) => {
      if (on) {
        if (b.dataset.label === undefined) b.dataset.label = b.textContent;
        b.disabled = true;
        b.textContent = 'Preparing report…';
      } else {
        b.disabled = false;
        if (b.dataset.label !== undefined) b.textContent = b.dataset.label;
      }
    });
  }
  function printReport() {
    if (printBusy) return;
    if (rowsPending) { printWhenReady = true; const st = document.getElementById('rows-status'); if (st) st.textContent = 'Loading the full grant list before printing…'; return; }
    // the heaviest book's report freezes the tab for several seconds building this
    // much HTML; show the busy state before that work starts, and defer the work
    // one tick so the browser actually paints it first.
    printBusy = true;
    setPrintBusy(true);
    setTimeout(buildPrintReport, 0);
  }
  function buildPrintReport() {
    const host = document.getElementById('print-report');
    if (!host) { printBusy = false; setPrintBusy(false); window.print(); return; }
    const h1 = document.querySelector('h1'); const meta = document.querySelector('.hero-meta');
    // the meta line in one row of plain text: its no-break separators become plain spaces and the as-filed
    // name (its own line on the page) is joined with a separator instead of running into 'The filings'
    const metaText = meta ? [...meta.childNodes].map((n) => (n.nodeType === 1 && n.classList.contains('hm-filed') ? ' · ' : '') + n.textContent)
      .join('').replace(/\s+/g, ' ').replace(/\s*↗/g, '').trim() : '';
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
    const srcNote = document.getElementById('src-note');
    const grand = GRAND || 1;
    const cats = catList.slice(0, 8);
    const tops = entList.slice(0, 10);
    const years = Object.keys(tieout).sort();
    const prTieYears = [...new Set([...years, ...Object.keys(WITHHELD).filter((y) => (WITHHELD[y] || {}).kind !== 'not yet published')])].sort();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // building the row table for the heaviest books is the actual multi-second cost;
    // past ~5,000 in-scope rows it is appended in chunks on a timer instead of one
    // synchronous string join, so the tab keeps responding while it builds.
    const BIG_ROWS = rows.length > 5000;
    host.innerHTML = `
      <header class="pr-head">
        <div class="pr-brand">The Grants Ledger · reconciled record from IRS Form <span class="nw">990-PF</span></div>
        <h1>${esc(h1 ? h1.textContent.trim() : document.title)}</h1>
        <p class="pr-total"><b>${money(GRAND)}</b> reconciled to the dollar \u00b7 ${esc(($('badge-btn') ? $('badge-btn').textContent : '').replace(/^\s*\u2713\s*/, '').replace(/\s+/g, ' ').replace(/\s*\u00b7\s*to the dollar\s*$/, '').trim())}</p>
        <p class="pr-meta">${esc(metaText)}${/\bTY\d{4}/.test(metaText) ? '' : ' · filed years ' + esc(SPAN_TEXT)} · printed ${new Date().toISOString().slice(0, 10)}</p>
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
        <h2>Largest recipients, ${allYearsPhrase()}</h2>
        <table class="pr-table"><thead><tr><th>Recipient</th><th class="num">Grants</th><th class="num">Total</th><th>Years</th></tr></thead>
        <tbody>${tops.map((e) => `<tr><td>${esc(dc(e.display))}</td><td class="num">${num(e.count)}</td><td class="num">${money(e.total)}</td><td>${[...e.years].sort().join(', ')}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="pr-sec">
        <h2>Reconciliation to the filed totals</h2>
        <table class="pr-table pr-tie"><thead><tr><th>Tax year</th><th class="num">Rows</th><th class="num">\u03a3 grant schedule</th><th class="num">Filed ${esc(REF_LBL)}</th><th class="num">\u0394</th><th>Filing</th></tr></thead>
        <tbody>${prTieYears.map((y) => { const t = tieout[y]; if (!t) { const w = WITHHELD[y] || {}; const f = typeof w.sum === 'number' && typeof w.filed === 'number'; return `<tr class="pr-withheld"><td>${esc(y)}</td><td class="num">${f ? num(w.rows) : '\u2014'}</td><td class="num">${f ? money(w.sum) : '\u2014'}</td><td class="num">${f ? money(w.filed) : '\u2014'}</td><td class="num">${f ? signedMoney(w.filed - w.sum) + ' \u00b7 withheld' : 'withheld'}</td><td>${w.object_id ? esc(w.object_id) : 'named on the exceptions page'}</td></tr>`; } const d = (t.line25_col_d || 0) - (t.grant_sum || 0); return `<tr><td>${esc(y)}</td><td class="num">${num(t.grant_count || 0)}</td><td class="num">${money(t.grant_sum || 0)}</td><td class="num">${money(t.line25_col_d || 0)}</td><td class="num">${d === 0 ? '$0 \u2713' : signedMoney(d)}</td><td>${receiptMark(t.object_id, 'pr-obj')}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td>Published total</td><td class="num">${num(years.reduce((a, y) => a + (tieout[y].grant_count || 0), 0))}</td><td class="num">${money(years.reduce((a, y) => a + (tieout[y].grant_sum || 0), 0))}</td><td class="num">${money(years.reduce((a, y) => a + (tieout[y].line25_col_d || 0), 0))}</td><td class="num">${(() => { const dd = years.reduce((a, y) => a + (tieout[y].line25_col_d || 0) - (tieout[y].grant_sum || 0), 0); return dd === 0 ? '$0 \u2713' : signedMoney(dd); })()}</td><td></td></tr></tfoot></table>
      </section>
      <section class="pr-sec pr-rows">
        <h2>Every grant in scope${scope.length ? ' — ' + esc(scope.join(' · ')) : ''}</h2>
        <p class="pr-sub">${num(rows.length)} ${rows.length === 1 ? 'grant' : 'grants'} · ${money(total)}</p>
        <table class="pr-table"><thead><tr><th>Year</th><th>Recipient</th><th class="num">Amount</th><th>Purpose (as filed)</th><th>Location</th></tr></thead>
        <tbody id="pr-rows-tbody">${BIG_ROWS ? '' : rows.map((g) => `<tr><td>${g.y}</td><td>${g.record_type === 'unitemized' ? `<span class="recip-flat">${esc(dc(g.r))} · unitemized disclosure</span>` : g.record_type === 'individual_masked' ? `<span class="recip-flat">${esc(MASKED_LABEL)}</span>` : esc(dc(g.r))}</td><td class="num">${money(g.a)}</td><td>${esc(g.p || '')}</td><td>${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</td></tr>`).join('')}</tbody></table>
      </section>
      <footer class="pr-foot">
        ${srcNote ? `<p class="pr-src">${srcNote.innerHTML}</p>` : ''}
        <p>Every figure reconciles to a total the foundation itself filed with the IRS. Historical record, not eligibility; nothing here is an audit.</p>
        <p class="pr-url">This view: ${esc(location.href.replace(/^https?:\/\//, ''))}</p>
      </footer>`;
    const finish = () => {
      host.hidden = false; host.setAttribute('aria-hidden', 'false');
      document.body.classList.add('print-report-mode');
      setPrintBusy(false);
      const done = () => { document.body.classList.remove('print-report-mode'); host.hidden = true; host.setAttribute('aria-hidden', 'true'); window.removeEventListener('afterprint', done); printBusy = false; setPrintBusy(false); };
      window.addEventListener('afterprint', done);
      setTimeout(() => window.print(), 50);
    };
    if (BIG_ROWS) {
      const tbody = document.getElementById('pr-rows-tbody');
      const STEP = 3000;
      let ci = 0;
      const appendChunk = () => {
        tbody.insertAdjacentHTML('beforeend', rows.slice(ci, ci + STEP).map((g) => `<tr><td>${g.y}</td><td>${g.record_type === 'unitemized' ? `<span class="recip-flat">${esc(dc(g.r))} · unitemized disclosure</span>` : g.record_type === 'individual_masked' ? `<span class="recip-flat">${esc(MASKED_LABEL)}</span>` : esc(dc(g.r))}</td><td class="num">${money(g.a)}</td><td>${esc(g.p || '')}</td><td>${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</td></tr>`).join(''));
        ci += STEP;
        if (ci < rows.length) setTimeout(appendChunk, 0); else finish();
      };
      appendChunk();
    } else {
      finish();
    }
  }
  document.querySelectorAll('#print-btn').forEach((b) => b.addEventListener('click', printReport));

  // ---------- tiny DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  // the stuck tab bar's context strip height (0 wherever the strip does not exist)
  const ctxStripH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctx-h')) || 0;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  // the build stamps the canonical recipient count into the page; while the full list is
  // still loading that stamp is the only true figure for it
  const STAMPED_ORGS = ($('kpi-orgs') ? $('kpi-orgs').textContent : '').trim() || '\u2014';
  // P4 (M3): build_any stamps the whole-book median and typical-grant range into the HTML, computed from
  // the FULL list exactly as below. While a big book's full list is still loading, those stamps are the
  // true figures -- the embedded preview is its largest rows, and its quartiles read 50x too high.
  // (A page built before the stamps carries "\u2014" there, and keeps the old wait state.)
  const stampOf = (id) => {
    const v = $(id), hint = v && v.parentElement.querySelector('.k-hint');
    const t = v ? v.textContent.trim() : '';
    return t && t !== '\u2014' && t !== '\u2026' ? { v: t, hint: hint ? hint.textContent.trim() : '' } : null;
  };
  const STAMPED_MEDIAN = stampOf('kpi-median'), STAMPED_RANGE = stampOf('kpi-range');
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
    // R2: an observer only reports crossings -- a toolbar hidden with its panel never "unpins"
    // on its own, so the tab switch re-reads it (and the context strip comes back elsewhere)
    try { if (typeof observeTools === 'function') observeTools(); } catch (e) {}
    updateReturnChip();
    if (push !== false) {
      const behavior = reducedMotion() ? 'instant' : 'smooth';
      if (tab === 'overview') window.scrollTo({ top: 0, behavior });
      else {
        const panel = $('panel-' + tab);
        const tabsEl = document.querySelector('.tabs');
        const shown = tabsEl && getComputedStyle(tabsEl).display !== 'none';
        const off = (shown ? tabsEl.offsetHeight + ctxStripH() : 0) + 10;   // R2: the stuck bar's context strip hangs under it
        window.scrollTo({ top: Math.max(0, panel.getBoundingClientRect().top + window.scrollY - off), behavior });
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
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const n = TABS[e.key === 'Home' ? 0 : TABS.length - 1];
      setTab(n); $('tab-' + n).focus();
    }
  });
  // L-11: setTab() already offset-scrolls to clear the sticky tab bar -- a second,
  // un-offset scrollIntoView right after it was what buried "The ledger" heading
  // under the tabs (or the tab bar itself, on a phone).
  $('explore-btn').addEventListener('click', () => setTab('grants'));
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
    // L-12: the stuck tab bar's own context line, since the header above it has scrolled away
    const ctxName = $('ctx-name');
    if (ctxName && !ctxName.textContent) {
      const h1El = document.querySelector('h1');
      ctxName.textContent = h1El ? h1El.textContent.replace(/\s+/g, ' ').trim() : document.title;
    }
    const ctxScope = $('ctx-scope');
    if (ctxScope) {
      const span = SPAN_ALL;   // close-out (6): the page's one span (the filed record's, the rail's)
      const ty = window.matchMedia && window.matchMedia('(max-width: 360px)').matches ? '' : 'TY';
      // close-out i2: a withheld book never shows a bare span. >=720 "TY2020–2024 · 2 withheld · $94.5M"; the phone
      // strip has no room for the suffix beside the name, so it counts: "3 of 5 yrs · $94.5M" (the side foot's own
      // count, same width as the span it replaces)
      const phone = window.matchMedia && window.matchMedia('(max-width: 719px)').matches;
      const lead = !NWITH ? `${ty}${span}` : (phone ? `${FILED_YEARS} of ${SPAN_YEARS.length} yrs` : `${ty}${span} \u00b7 ${NWITH} withheld`);
      ctxScope.textContent = sy === null ? `${lead} · ${moneyCompact(GRAND)}` : `${ty}${sy} · ${moneyCompact(byYear[sy].sum)}`;
    }
  }
  {
    // the sidebar rail (>=1100px) and the top rail (below it) are the same control
    const withheld = WITHHELD, zeroYears = ZEROYRS;
    const scanYears = SCAN_YEARS;
    const maxYearSum = Math.max(1, ...YEARS.map((y) => byYear[y].sum));
    [document.getElementById('year-rail'), document.getElementById('year-rail-top')].filter(Boolean).forEach((rail) => {
      const railYears = [...new Set([...YEARS, ...Object.keys(withheld).map(Number), ...Object.keys(zeroYears).map(Number)])].sort((a, b) => a - b);
      rail.innerHTML = ['all'].concat(railYears).map((y) => withheld[String(y)]
        ? `<a class="withheld" data-y="${y}" href="../../exceptions/#${document.documentElement.dataset.slug || ''}" title="${String(withheld[String(y)].why || '').replace(/"/g, '&quot;')}" aria-label="Tax year ${y}, ${withheld[String(y)].kind || 'withheld'}"><span class="wy">${y}</span><small>${withheld[String(y)].kind || 'withheld'}</small></a>`
        : zeroYears[String(y)]
          ? `<span class="zeroyr" data-y="${y}" title="This year is filed and reconciles at $0 — no grants were paid." aria-label="Tax year ${y}, $0 filed, no grants">${y}<small>$0 filed</small></span>`
          : `<button type="button" data-yr="${y}"${y === 'all' ? '' : ` data-y="${y}" style="--share:${(byYear[y].sum / maxYearSum * 100).toFixed(2)}%"`} aria-pressed="false"${scanYears.has(y) ? ` class="scan" title="Read from the paper filing — absent from every e-file dataset"` : ''}>${y === 'all' ? 'All' : y}</button>`).join('');
      rail.addEventListener('click', (e) => {
        const b = e.target.closest('[data-yr]');
        if (!b) return;
        // L-11: the phone rail must not visibly move when a layout change above it
        // (the scope line, KPI hints) shifts the page -- measure, render, correct.
        const isTop = rail.id === 'year-rail-top';
        const y0 = isTop ? rail.getBoundingClientRect().top : 0;
        state.y = b.dataset.yr === 'all' ? null : +b.dataset.yr;
        state.page = 0;
        writeHash(true);
        render();
        if (isTop) {
          // R2 (R-3): hold the rail where the finger left it -- correct now, then on each of the
          // next few frames for anything that settles late (observer-driven classes, fonts, the
          // chart reveal). A new touch or wheel ends the hold, so it never fights the reader.
          let live = true;
          const stop = () => { live = false; };
          window.addEventListener('touchstart', stop, { once: true, passive: true });
          window.addEventListener('wheel', stop, { once: true, passive: true });
          const hold = (n) => {
            if (!live) return;
            const dy = rail.getBoundingClientRect().top - y0;
            if (Math.abs(dy) > 0.5) window.scrollBy({ top: dy, behavior: 'instant' });
            if (n > 0) requestAnimationFrame(() => hold(n - 1));
          };
          hold(5);
          const onChip = rail.querySelector('.on');
          // R2: centre the chip by scrolling the rail sideways only -- scrollIntoView could also
          // scroll the page vertically (block:'nearest' honours the pinned chrome's padding),
          // which is exactly the movement the hold above exists to prevent
          if (onChip) {
            const cr = onChip.getBoundingClientRect(), rr = rail.getBoundingClientRect();
            rail.scrollTo({ left: Math.max(0, rail.scrollLeft + (cr.left - rr.left) - (rr.width - cr.width) / 2), behavior: reducedMotion() ? 'instant' : 'smooth' });
          }
        }
      });
    });
    document.querySelectorAll('.side-nav [data-tab]').forEach((b) =>
      b.addEventListener('click', () => { returnTo = null; updateReturnChip(); setTab(b.dataset.tab); }));
    syncSide();

    // ux-ledger-04: the moat, said where the buyer is already looking -- under the badge,
    // not seven clicks into Methodology.
    const moatEl = $('moat-note');
    if (moatEl && scanYears.size) {
      const nFiled = Object.keys(tieout).length;
      moatEl.hidden = false;
      const nScan = numWord(scanYears.size);
      moatEl.innerHTML = `${nScan.charAt(0).toUpperCase() + nScan.slice(1)} of ${numWord(nFiled)} filed ${plural(nFiled, 'year')} ${scanYears.size === 1 ? 'was' : 'were'} `
        + `read from the paper filing — absent from every e-file dataset. `
        + `<a href="../../recovered/#${esc(document.documentElement.dataset.slug || '')}">How we recovered ${scanYears.size === 1 ? 'it' : 'them'} →</a>`;
    }

    // ux-ledger-10: the shortened hero lede's own link into Methodology (mirrors db-method).
    const lm = $('lede-method');
    if (lm) lm.addEventListener('click', (e) => {
      e.preventDefault(); setTab('methodology');
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });

    // ux-ledger-03: the one conversion moment -- built once, from the page's own title
    // and address, never a new service or a price (OBA rule: no price on this page).
    {
      const h1El = document.querySelector('h1');
      const foundation = (h1El ? h1El.textContent : document.title).replace(/\s+/g, ' ').trim();
      const pageUrl = location.href.split('#')[0];
      const mailto = (subject, body) => 'mailto:jjcurry027@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      const recover = $('cta-recover');
      if (recover) recover.href = mailto('Recover a year of grants — starting point: ' + foundation,
        'Foundation: ' + foundation + '\nPage: ' + pageUrl + '\n\nWhat’s hard to find:\n');
      const claim = $('cta-claim');
      if (claim) claim.href = mailto('Keep ' + foundation + ' current', 'Page: ' + pageUrl + '\n\n');
    }

    // ux-ledger-01: the specific break, named where a skeptic reads first, not two tabs
    // away. Reuses the exact "why" text the year-rail chip's own title already carries,
    // so the two surfaces never disagree.
    {
      const ex = $('db-except');
      const slug = esc(document.documentElement.dataset.slug || '');
      const lines = [];
      Object.keys(withheld).sort().forEach((y) => {
        const w = withheld[y] || {};
        const label = w.kind === 'not yet published' ? 'not yet published' : 'withheld';
        lines.push(`<p>TY${esc(y)} ${label} — ${esc(w.why || 'named on the exceptions page.')} <a class="why-go" href="../../exceptions/#${slug}">why →</a></p>`);
      });
      // close-out i2: paper has no link -- print hides "why →" and names the page it went to, once
      if (lines.length) {
        let exUrl = '';
        try { exUrl = new URL(`../../exceptions/#${document.documentElement.dataset.slug || ''}`, location.href).href.replace(/^https?:\/\//, ''); } catch (e) { exUrl = ''; }
        if (exUrl) lines.push(`<p class="p-only">The exceptions page lists ${lines.length === 1 ? 'this year' : 'these years'}: ${esc(exUrl)}</p>`);
      }
      Object.keys(zeroYears).sort().forEach((y) => {
        lines.push(`<p>TY${esc(y)} filed $0 — the return is in the record; no grants were paid that year.</p>`);
      });
      if (ex) { ex.innerHTML = lines.join(''); ex.hidden = !lines.length; }
    }
  }

  // ---------- overview ----------
  // R3 (DECISIONS-JOE #2, 2026-09-24): the trend is drawn as COLUMNS -- one per filed year, the value
  // printed on each, unitemized / $0-filed / withheld years told apart by pattern, outline and a word
  // (never by hue). The straight-segment line renderer is kept intact beside it; this one constant
  // picks the form. Reverting = set it to 'line' and rebuild the fleet (build_any re-stamps ?v=).
  const TREND_FORM = 'columns';   // 'line' restores the straight-segment line
  // R3 (NEW-1): the chart is drawn in CSS pixels. The old fixed 560-unit viewBox scaled every label
  // with the card -- ~6px type on a 390 phone, ~21px at 1440. Now the viewBox IS the host's rendered
  // width, so an 11px label is 11px at every width, and the chart re-lays itself when the host's
  // width changes (ResizeObserver, one rAF later -- never inside the observer callback).
  let trendW = 0, trendFit = null;
  function renderTrend() {
    const host = $('trend');
    if (YEARS.length < 2) {           // one filed year is not a trend; hide the card entirely
      const card = $('trend').closest('.card');
      if (card) card.hidden = true;
      const cards = document.getElementById('tr-cards');
      if (cards) cards.hidden = true;
      return;
    }
    host.dataset.form = TREND_FORM;
    const cardsHost = document.getElementById('tr-cards');
    if (cardsHost) {
      cardsHost.classList.toggle('scoped', state.y !== null);
      cardsHost.innerHTML = YEARS.map((y, i) => {
        const pct = i === 0 ? null : yoyPct(byYear[y].sum, byYear[YEARS[i-1]].sum);
        const pctTxt = pct === null ? '' : (pct > 0 ? '+' : '−') + Math.abs(pct).toFixed(0) + '%';
        const sel = state.y === y;
        return `
        <button type="button" class="tr-card${sel ? ' sel' : ''}" data-y="${y}" aria-pressed="${sel}"
          aria-label="Tax year ${y}: ${money(byYear[y].sum)} across ${num(byYear[y].count)} ${grantsWord(byYear[y].count)}${pct === null ? '' : ', ' + pctTxt + ' versus prior year'}. Scopes the whole page to this year.">
          <span class="ty"><span>${y}</span><span class="chg ${pct !== null && pct < 0 ? 'neg' : 'pos'}">${pctTxt}</span></span>
          <span class="tsum">${yearLabel(y)}</span>
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
    drawTrend();
    if (cardsHost) {
      // R2.2: on a phone the cards are a sideways carousel -- a year scoped from the rail or the chart
      // could sit off its right edge. Bring the chosen card into view by scrolling the carousel only
      // (element scrollTo, never scrollIntoView, which can also move the page under the reader's finger).
      // The target is always a card's own snap position -- the carousel snaps (proximity), and any
      // other offset is pulled straight back to the nearest card start.
      const selCard = cardsHost.querySelector('.tr-card.sel');
      if (selCard && cardsHost.scrollWidth > cardsHost.clientWidth + 1) {
        const hb = cardsHost.getBoundingClientRect(), sl = cardsHost.scrollLeft, view = cardsHost.clientWidth;
        const sp = parseFloat(getComputedStyle(cardsHost).scrollPaddingLeft) || 0;
        const at = (c) => c.getBoundingClientRect().left - hb.left + sl;
        const l = at(selCard), r = l + selCard.offsetWidth;
        let to = null;
        if (l - sp < sl) to = l - sp;
        else if (r + sp > sl + view) {
          const first = [...cardsHost.children].find((c) => r + sp - (at(c) - sp) <= view);   // least travel that shows it whole
          to = (first ? at(first) : l) - sp;
        }
        if (to !== null) cardsHost.scrollTo({ left: Math.min(Math.max(0, to), cardsHost.scrollWidth - view), behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
  }

  // draws the chart alone (never the cards), so a width change re-lays it without touching the carousel
  function drawTrend() {
    const host = $('trend');
    if (!host || YEARS.length < 2) return;
    const tipEl = $('tr-tip');
    const hostW = Math.round(host.clientWidth);
    trendW = hostW;
    const W = Math.max(200, hostW || 560);   // a hidden panel measures 0: draw at a sane width, re-lay when shown
    const chart = TREND_FORM === 'line' ? trendLine(W) : trendColumns(W);
    host.innerHTML = '';
    host.appendChild(tipEl);
    host.insertAdjacentHTML('beforeend', chart.svg);
    const svgEl = host.querySelector('svg');
    trendFit = chart.after ? () => chart.after(svgEl) : null;
    if (trendFit) trendFit();
    const yearCards = document.querySelectorAll('#tr-cards .tr-card');
    const tds = chart.delays(svgEl);
    svgEl.querySelectorAll('.tr-pt, .tr-col[data-i]').forEach((g) => {
      const i = +g.dataset.i;
      g.style.setProperty('--td', tds[i]);
      if (yearCards[i]) yearCards[i].style.setProperty('--td', tds[i]);
    });
    function tipShow(i) {
      const y = YEARS[i];
      const hostRect = host.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox.baseVal, k = svgRect.width / vb.width;   // through the live viewBox (it can grow upward)
      let x = (svgRect.left - hostRect.left) + (chart.pts[i][0] - vb.x) * k;
      const ty = (svgRect.top - hostRect.top) + (chart.pts[i][1] - vb.y) * k;
      const tTip = tieout[String(y)];
      const dTip = tTip ? tTip.line25_col_d - tTip.grant_sum : 0;
      tipEl.innerHTML = `<strong>${y}</strong><span>${money(byYear[y].sum)} · ${num(byYear[y].count)} ${grantsWord(byYear[y].count)} · ${dTip === 0 ? 'PASS Δ\u00a0$0' : 'Δ\u00a0' + signedMoney(dTip)}</span>`
        + (SCAN_YEARS.has(y) ? '<span>Read from the paper filing</span>' : '');
      tipEl.classList.add('show');
      const tw = tipEl.offsetWidth || 190;
      x = Math.max(tw / 2 + 4, Math.min(hostRect.width - tw / 2 - 4, x));
      tipEl.style.left = x + 'px';
      // P4: the tip's own box spans more than its column at every width -- lift it clear of the top of any
      // painted label under that span (its bottom sits 14px above the value it points at, per the CSS)
      let labelTop = Infinity;
      svgEl.querySelectorAll('.tr-cval, .tr-cword, .tr-val').forEach((t) => {
        if (!t.getClientRects().length || parseFloat(getComputedStyle(t).opacity) < 0.05) return;
        const r = t.getBoundingClientRect();
        if (r.right - hostRect.left > x - tw / 2 && r.left - hostRect.left < x + tw / 2) labelTop = Math.min(labelTop, r.top - hostRect.top);
      });
      tipEl.style.top = Math.min(ty, labelTop - 4 + 14) + 'px';
    }
    function tipHide() { tipEl.classList.remove('show'); }
    svgEl.querySelectorAll('.tr-pt, .tr-col[data-i]').forEach((g) => {
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
  if ('ResizeObserver' in window && $('trend')) {
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { const w = Math.round($('trend').clientWidth); if (w && w !== trendW) drawTrend(); });
    }).observe($('trend'));
  }
  // label widths are measured -- measure again once the web fonts have replaced the fallback
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (trendFit) trendFit(); });
  const trendAria = () => `Charitable disbursements by tax year, ${YEARS[0]} through ${LATEST}. ${YEARS.map((y)=>y + ': ' + moneyCompact(byYear[y].sum)).join(', ')}.`;
  const trendPtLabel = (y, i) => {
    const pct = i === 0 ? null : yoyPct(byYear[y].sum, byYear[YEARS[i-1]].sum);
    const pctTxt = pct === null ? '' : (pct > 0 ? '+' : '−') + Math.abs(pct).toFixed(0) + '%';
    return `Tax year ${y}: ${money(byYear[y].sum)}, ${num(byYear[y].count)} ${grantsWord(byYear[y].count)}${pct===null?'':', ' + pctTxt + ' versus prior year'}${incompleteYear(y) ? ', unitemized — no recipients named' : ''}${SCAN_YEARS.has(y) ? ', read from the paper filing' : ''}. Scopes the whole page to this year.`;
  };

  // ---- the column form (default) ----
  function trendColumns(W) {
    // every filed year gets a slot -- a withheld year and a $0-filed year included, drawn as what they are
    const slots = [...new Set([...YEARS, ...Object.keys(WITHHELD).map(Number), ...Object.keys(ZEROYRS).map(Number)])].sort((a, b) => a - b);
    const H = Math.round(Math.max(196, Math.min(272, W * 0.3)));
    const pad = { t: 40, b: 30, x: 2 };   // two label lines above the tallest column; the year row below the base
    const base = H - pad.b;
    const slotW = (W - 2 * pad.x) / slots.length;
    const barW = Math.round(Math.min(84, Math.max(16, slotW * 0.56)));
    const maxV = Math.max(1, ...YEARS.map((y) => byYear[y].sum));
    const hAt = (v) => Math.max(0, v) / maxV * (base - pad.t);
    const cxAt = (k) => pad.x + slotW * (k + 0.5);
    // P4: a withheld year is an empty slot of a fixed, modest height -- drawn at full plot height it was the
    // largest shape on the chart, for the one year with no figure at all
    const wSlotH = Math.round(Math.max(24, Math.min(40, (base - pad.t) * 0.2)));
    const slug = esc(document.documentElement.dataset.slug || '');
    // a column with its top corners rounded and its foot square on the baseline
    const colPath = (x, top, w) => {
      const h = base - top, r = Math.min(3, h, w / 2);
      return `M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${base}Z`;
    };
    const pts = [];
    const marks = slots.map((y, k) => {
      const cx = cxAt(k), x0 = Math.round(cx - barW / 2);
      const yearLbl = `<text class="tr-cyear" x="${cx}" y="${base + 18}" text-anchor="middle">${y}</text>`;
      if (WITHHELD[String(y)] && !YEARS.includes(y)) {
        const w = WITHHELD[String(y)] || {};
        const kind = w.kind === 'not yet published' ? 'not yet published' : 'withheld';
        return `
        <a class="tr-col is-withheld" data-y="${y}" data-kind="withheld" href="../../exceptions/#${slug}" aria-label="Tax year ${y}: ${kind} — the reason is on the exceptions page">
          <title>${esc(w.why || 'Filed, not published — named on the exceptions page.')}</title>
          <rect class="tr-hit" x="${cx - slotW / 2}" y="0" width="${slotW}" height="${H}" fill="transparent"/>
          <rect class="tr-wframe" x="${x0 + 0.5}" y="${base - wSlotH + 0.5}" width="${barW - 1}" height="${wSlotH - 1}" rx="3"/>
          <text class="tr-cword" x="${cx}" y="${base - wSlotH - 7}" text-anchor="middle">${kind === 'withheld' ? 'withheld' : 'not published'}</text>
          ${yearLbl}
        </a>`;
      }
      if (ZEROYRS[String(y)] && !YEARS.includes(y)) {
        return `
        <g class="tr-col is-zero" data-y="${y}" data-kind="zero" role="img" aria-label="Tax year ${y}: $0 filed — the return is in the record; no grants were paid">
          <rect class="tr-zbar" x="${x0}" y="${base - 2}" width="${barW}" height="2"/>
          <text class="tr-cval" x="${cx}" y="${base - 8}" text-anchor="middle">$0 filed</text>
          ${yearLbl}
        </g>`;
      }
      const i = YEARS.indexOf(y);
      const v = byYear[y].sum;
      const top = base - hAt(v);
      const unit = incompleteYear(y);
      pts[i] = [cx, top - (unit ? 34 : 21)];
      const scan = SCAN_YEARS.has(y);
      const sel = state.y === y;
      // the value sits on its column; an unitemized year says so on a second line, nearest the column
      const labels = unit
        ? `<text class="tr-cval" x="${cx}" y="${top - 21}" text-anchor="middle">${yearLabel(y)}</text>
           <text class="tr-cword" x="${cx}" y="${top - 7}" text-anchor="middle">unitemized</text>`
        : `<text class="tr-cval" x="${cx}" y="${top - 8}" text-anchor="middle">${yearLabel(y)}</text>`;
      return `
        <g class="tr-col${unit ? ' is-unit' : ''}${scan ? ' is-scan' : ''}${sel ? ' is-sel' : ''}" data-i="${i}" data-y="${y}" data-kind="${unit ? 'unitemized' : 'filed'}" tabindex="0" role="button"
           aria-label="${trendPtLabel(y, i)}">
          <rect class="tr-hit" x="${cx - slotW / 2}" y="0" width="${slotW}" height="${H}" fill="transparent"/>
          <path class="tr-cbar" d="${colPath(x0, top, barW)}"/>
          ${labels}
          ${yearLbl}
          ${scan ? `<line class="tr-scanmark" x1="${cx - 14}" x2="${cx + 14}" y1="${base + 22.5}" y2="${base + 22.5}"/>` : ''}
        </g>`;
    }).join('');
    const selK = state.y !== null ? slots.indexOf(state.y) : -1;
    // the summary names every filed year the columns show -- a withheld or $0 year included
    const colsAria = `Charitable disbursements by tax year, ${slots[0]} through ${slots[slots.length - 1]}. `
      + slots.map((y) => y + ': ' + (YEARS.includes(y) ? moneyCompact(byYear[y].sum) + (incompleteYear(y) ? ' unitemized' : '') : WITHHELD[String(y)] ? 'withheld' : '$0 filed')).join(', ') + '.';
    const svg = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="tr-columns${state.y !== null ? ' scoped' : ''}" role="group" aria-label="${colsAria}">
        <defs>
          <pattern id="trHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="#4e5347"/></pattern>
        </defs>
        ${selK >= 0 ? `<rect class="tr-band" x="${cxAt(selK) - Math.min(slotW, barW + 28) / 2}" y="4" width="${Math.min(slotW, barW + 28)}" height="${H - 6}" rx="8"/>` : ''}
        <line class="tr-base" x1="${pad.x}" y1="${base + 0.5}" x2="${W - pad.x}" y2="${base + 0.5}"/>
        ${marks}
      </svg>`;
    return {
      svg, pts, H,
      // columns rise left to right, one beat apart
      delays: () => YEARS.map((y) => (slots.indexOf(y) * 0.08).toFixed(2) + 's'),
      // Labels are measured, not assumed. A label group (value, and its word) never runs past the chart's
      // own edges; where two neighbours' groups would touch (a phone's narrowest slots, "unitemized" beside
      // a column of similar height) the values step from 12px to 11px (never below), and any group still
      // touching a neighbour's column or labels lifts just clear of it. Idempotent: it starts from the drawn positions,
      // so it can run again once the web fonts land.
      after: (svgEl) => {
        const cols = [...svgEl.querySelectorAll('.tr-col')];
        const groups = cols.map((g) => [...g.querySelectorAll('.tr-cval, .tr-cword')]);
        const bars = cols.map((g) => g.querySelector('.tr-cbar, .tr-wframe, .tr-zbar'));
        groups.flat().forEach((t) => {
          if (t.dataset.x0 === undefined) { t.dataset.x0 = t.getAttribute('x'); t.dataset.y0 = t.getAttribute('y'); }
          t.setAttribute('x', t.dataset.x0); t.setAttribute('y', t.dataset.y0);
        });
        svgEl.classList.remove('tight');
        svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`); svgEl.setAttribute('height', H);
        const rect = (b) => ({ l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height });
        const box = (ts) => {
          const bs = ts.map((t) => rect(t.getBBox()));
          return { l: Math.min(...bs.map((b) => b.l)), r: Math.max(...bs.map((b) => b.r)), t: Math.min(...bs.map((b) => b.t)), b: Math.max(...bs.map((b) => b.b)) };
        };
        const barBox = (el) => el ? rect(el.getBBox()) : null;   // geometry only: a column still rising (scaleY) counts at full height
        const shift = (ts, dx, dy) => ts.forEach((t) => {
          if (dx) t.setAttribute('x', +t.getAttribute('x') + dx);
          if (dy) t.setAttribute('y', +t.getAttribute('y') + dy);
        });
        // P4: two tolerances. Labels closer than 10px on one line step down to the 11px size (a flat series at
        // 320px read "$641K $618K $646K" as one string); only a real collision (4px) lifts a group a line.
        const touchAt = (tol) => (a, b) => !!a && !!b && a.l < b.r + tol && b.l < a.r + tol && a.t < b.b + 1 && b.t < a.b + 1;
        const crowd = touchAt(10), touch = touchAt(4);
        const edges = () => groups.forEach((ts) => { if (!ts.length) return; const b = box(ts); if (b.l < 0) shift(ts, -b.l, 0); else if (b.r > W) shift(ts, W - b.r, 0); });
        // what a label group k may not touch: its neighbours' columns, and the labels of the neighbour before it
        const blockers = (k) => [k - 1, k + 1].filter((j) => j >= 0 && j < cols.length)
          .flatMap((j) => [barBox(bars[j]), j < k && groups[j].length ? box(groups[j]) : null]).filter(Boolean);
        const anyTouch = (t) => groups.some((ts, k) => ts.length && blockers(k).some((o) => (t || touch)(box(ts), o)));
        edges();
        if (!anyTouch(crowd)) return;
        svgEl.classList.add('tight');
        edges();
        if (!anyTouch()) return;
        // lift, left to right, just clear of whatever it touches; lifts only go up, so this settles
        for (let pass = 0; pass < 6 && anyTouch(); pass++) {
          groups.forEach((ts, k) => {
            if (!ts.length) return;
            blockers(k).forEach((o) => { const me = box(ts); if (touch(me, o)) shift(ts, 0, -(me.b - o.t + 3)); });
          });
        }
        // a group lifted above the plot grows the chart upward rather than painting over the card's lede
        const top = Math.min(...groups.filter((ts) => ts.length).map((ts) => box(ts).t));
        if (top < 2) {
          const d = Math.ceil(2 - top);
          svgEl.setAttribute('viewBox', `0 ${-d} ${W} ${H + d}`); svgEl.setAttribute('height', H + d);
        }
      },
    };
  }

  // ---- the line form (TREND_FORM = 'line') -- the pre-R3 renderer, drawn in CSS pixels ----
  function trendLine(W) {
    // L-04 repair: pad.b was 26, leaving the year labels (drawn at H-2, 2 units off
    // the viewBox floor) close enough to the edge that real renders clipped them
    // into half-glyphs. 32 gives the label row real headroom under the baseline.
    // R3: W is the host's own width (1 unit = 1px); pad.l fits an 11px tick label ("$100M").
    const H = Math.round(Math.max(200, Math.min(300, W * 0.36))), pad = { t: 34, r: 18, b: 32, l: 48 };
    const maxV = Math.max(1, ...YEARS.map((y) => byYear[y].sum)) * 1.12;
    const step = (W - pad.l - pad.r - 44) / (YEARS.length - 1);
    const xAt = (i) => pad.l + 22 + i * step;
    const yAt = (v) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
    const pts = YEARS.map((y, i) => [xAt(i), yAt(byYear[y].sum)]);
    // L-04: a fiscal-year chart, not a wave -- straight segments between filed years,
    // with the segment into an incomplete/scanned year drawn dashed and its point hollow.
    const fullLineD = 'M ' + pts.map((p) => p.join(' ')).join(' L ');
    let line = `M ${pts[0][0]} ${pts[0][1]}`, dashLine = '', mainOpen = true;
    for (let i = 1; i < pts.length; i++) {
      const flagged = incompleteYear(YEARS[i]) || SCAN_YEARS.has(YEARS[i]);
      if (flagged) {
        dashLine += ` M ${pts[i-1][0]} ${pts[i-1][1]} L ${pts[i][0]} ${pts[i][1]}`;
        mainOpen = false;
      } else {
        if (!mainOpen) { line += ` M ${pts[i-1][0]} ${pts[i-1][1]}`; mainOpen = true; }
        line += ` L ${pts[i][0]} ${pts[i][1]}`;
      }
    }
    const area = fullLineD + ` L ${pts[pts.length-1][0]} ${yAt(0)} L ${pts[0][0]} ${yAt(0)} Z`;
    // value labels stay visible at rest only on the first, last, largest and smallest
    // year -- every other one shows on hover/focus, so the chart reads clean by default.
    const sums = YEARS.map((y) => byYear[y].sum);
    const showValIdx = new Set([0, YEARS.length - 1, sums.indexOf(Math.max(...sums)), sums.indexOf(Math.min(...sums))]);
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
    // R2.2 (m-2): the first year's value label starts at the plot's left edge, a few units from the
    // y-axis tick labels -- on the same baseline the two read as one string ("$10M $8.64M · unitemized").
    // It steps to just above (or below, if there is room over its dot) the tick it would share a line
    // with; if neither clears every tick, that one tick label gives way (its gridline stays).
    const tickBase = ticks.map((v) => yAt(v) + 3);
    const clashAt = (b) => tickBase.findIndex((t) => Math.abs(t - b) < 12);
    let firstValY = pts[0][1] - 14, hideTick = -1;
    {
      const k = clashAt(firstValY);
      if (k >= 0) {
        const opts = [tickBase[k] - 12, tickBase[k] + 12]
          .filter((b) => b >= 12 && b <= pts[0][1] - 9 && clashAt(b) < 0)
          .sort((a, b) => Math.abs(a - firstValY) - Math.abs(b - firstValY));
        if (opts.length) firstValY = opts[0]; else hideTick = k;
      }
    }
    const grid = ticks.map((v, k) =>
      (v === 0 ? '' : `<line class="tr-grid" x1="${pad.l}" y1="${yAt(v)}" x2="${W - pad.r}" y2="${yAt(v)}"/>`) +
      (k === hideTick ? '' : `<text class="tr-tick" x="${pad.l - 7}" y="${yAt(v) + 3}" text-anchor="end">${moneyTick(v)}</text>`)).join('');
    const hitW = Math.min(104, step);
    const marks = YEARS.map((y, i) => {
      const [x, yy] = pts[i];
      const sel = state.y === y;
      const incomplete = incompleteYear(y);
      const hollow = incomplete || SCAN_YEARS.has(y);
      const valTxt = yearLabel(y) + (incomplete ? ' · unitemized' : '');
      // L-04 repair: the last point's value label ("$X.XM · unitemized") is the
      // longest on the chart and, centered on the right-most point, ran off the
      // right edge of the viewBox. Anchor it to end flush with the chart's own
      // right padding instead of centering it on a point with no room to its right.
      // R2 (R-6): and the first point mirrors it -- centred on the first year, a long label
      // ("$8.64M · unitemized") ran left over the y-axis tick labels. It starts at the plot's
      // left edge instead, clear of the ticks (which end at pad.l - 7).
      const isLast = i === pts.length - 1, isFirst = i === 0;
      const valAnchor = isLast ? 'end' : isFirst ? 'start' : 'middle';
      const valX = isLast ? (W - pad.r) : isFirst ? pad.l : x;
      return `
        <g class="tr-pt${sel ? ' is-sel' : ''}${showValIdx.has(i) ? ' show-val' : ''}" data-i="${i}" data-y="${y}" tabindex="0" role="button"
           aria-label="${trendPtLabel(y, i)}">
          <rect x="${x - hitW / 2}" y="${pad.t - 16}" width="${hitW}" height="${H - pad.t + 8}" fill="transparent"/>
          <circle cx="${x}" cy="${yy}" r="${sel ? 6.5 : 4.5}" class="tr-dot${hollow ? ' hollow' : ''}"/>
          <text x="${valX}" y="${isFirst ? firstValY : yy - 14}" text-anchor="${valAnchor}" class="tr-val">${valTxt}</text>
          <text x="${x}" y="${H - 14}" text-anchor="middle" class="tr-year">${y}</text>
        </g>`;
    }).join('');
    const bandW = Math.min(60, step * 0.9);
    const svg = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="tr-line-form${state.y !== null ? ' scoped' : ''}" role="group" aria-label="${trendAria()}">
        <defs>
          <linearGradient id="trFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a35c1a" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#a35c1a" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        ${state.y !== null ? `<rect class="tr-band" x="${xAt(YEARS.indexOf(state.y)) - bandW / 2}" y="10" width="${bandW}" height="${H - 18}" rx="8"/>` : ''}
        <line class="tr-base" x1="${pad.l}" y1="${yAt(0)}" x2="${W - pad.r}" y2="${yAt(0)}"/>
        <path class="tr-area" d="${area}"/>
        <path class="tr-line" d="${line}"/>
        ${dashLine ? `<path class="tr-line dashed" d="${dashLine}"/>` : ''}
        <path class="tr-timing" d="${fullLineD}" aria-hidden="true"/>
        ${marks}
      </svg>`;
    return {
      svg, pts, H,
      // reveal choreography: delay each year by the tip's real arrival (path length, not guesswork)
      delays: (svgEl) => {
        const lineEl = svgEl.querySelector('.tr-timing');
        const L = lineEl.getTotalLength();
        $('trend').style.setProperty('--plen', L.toFixed(1));
        const fracAt = (tx) => {
          let lo = 0, hi = L;
          for (let k = 0; k < 18; k++) {
            const mid = (lo + hi) / 2;
            if (lineEl.getPointAtLength(mid).x < tx) lo = mid; else hi = mid;
          }
          return lo / L;
        };
        return pts.map((p) => (fracAt(p[0]) * 1.4).toFixed(2) + 's');
      },
      // R3: in CSS pixels a phone's line is short -- two resting labels ("$36.5M · unitemized") can meet;
      // the later one lifts just clear of the earlier (measured, idempotent, re-run when fonts land)
      after: (svgEl) => {
        const vals = [...svgEl.querySelectorAll('.tr-pt.show-val .tr-val, .tr-pt.is-sel .tr-val')];
        vals.forEach((t) => { if (t.dataset.y0 === undefined) t.dataset.y0 = t.getAttribute('y'); t.setAttribute('y', t.dataset.y0); });
        svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`); svgEl.setAttribute('height', H);
        const r = (t) => { const b = t.getBBox(); return { l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height }; };
        const touch = (a, b) => a.l < b.r + 3 && b.l < a.r + 3 && a.t < b.b + 1 && b.t < a.b + 1;
        for (let k = 1; k < vals.length; k++) {
          for (let j = 0; j < k; j++) {
            const a = r(vals[j]), b = r(vals[k]);
            if (touch(a, b)) vals[k].setAttribute('y', +vals[k].getAttribute('y') - (b.b - a.t + 3));
          }
        }
        const top = vals.length ? Math.min(...vals.map((t) => r(t).t)) : 2;
        if (top < 2) { const d = Math.ceil(2 - top); svgEl.setAttribute('viewBox', `0 ${-d} ${W} ${H + d}`); svgEl.setAttribute('height', H + d); }
      },
    };
  }

  function barRow(label, value, max, opts) {
    const o = opts || {};
    const pct = barPct(value, max);
    return `
      <div class="bar-row${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''}>
        <div class="bar-label"${o.title ? ` title="${o.title}"` : ''}>${label}</div>
        <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-val">${o.val || money(value)}</div>
      </div>`;
  }

  function renderOverview() {
    // the global year scope: one state.y drives every panel below the cover
    const SY = state.y;
    // ux-ledger-05: a book with too few named rows publishes concentration, new-vs-
    // returning and biggest-changes as if they were findings on statistical noise.
    const tiny = isTiny();
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
      if (eqSeal) eqSeal.textContent = eqD === 0 ? '\u0394\u00a0$0 \u2713' : '\u0394\u00a0' + signedMoney(eqD);
      // P4 (L1): "=" only between equal figures
      const eqOp = document.querySelector('#db-eq .eq-op');
      if (eqOp) eqOp.textContent = eqD === 0 ? '=' : '\u2260';
      const eqLbl = document.querySelector('#db-eq .eq-part .eq-label');
      if (eqLbl) eqLbl.textContent = SY !== null ? `\u03a3 ${SY} grant schedule` : '\u03a3 grant schedules';
      const dbEl = document.querySelector('.db-line');
      if (dbEl) dbEl.innerHTML = SY !== null
        ? `Every number on this page reconciles to the foundation\u2019s own filed totals \u2014 <em>tax year ${SY}, to the dollar.</em>`
        : 'Every number on this page reconciles to the foundation\u2019s own filed totals \u2014 <em>' + (document.documentElement.dataset.running || 'to the dollar, five years running.') + '</em>';
      // L-07: every filed period, one chip each, linking straight to its row in Methodology
      const dbYearsEl = $('db-years');
      if (dbYearsEl && !dbYearsEl.dataset.built) {
        dbYearsEl.dataset.built = '1';
        const allTaxYears = [...new Set([...Object.keys(tieout).map(Number), ...Object.keys(WITHHELD).map(Number)])].sort((a, b) => a - b);
        dbYearsEl.innerHTML = allTaxYears.map((y) => {
          const w = WITHHELD[String(y)];
          const scanned = SCAN_YEARS.has(y);
          const cls = w ? 'withheld' : (scanned ? 'scan' : '');
          const title = w ? ` title="${esc(w.why || 'Withheld')}"` : (scanned ? ' title="Read from the paper filing"' : '');
          // P4 (L1): a withheld year is struck AND worded -- geometry and a word, never hue alone
          return `<a href="#tab=methodology" data-y="${y}"${cls ? ` class="${cls}"` : ''}${title}>${w ? `<span class="dy-y">${y}</span> ${w.kind === 'not yet published' ? 'not yet published' : 'withheld'}` : y + ' \u2713'}</a>`;
        }).join('');
        dbYearsEl.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setTab('methodology')));
      }
      $('db-eq').setAttribute('aria-label',
        `Sum of the ${SY !== null ? SY + ' grant schedule' : 'grant schedules'}, ${money(eqA)}, `
        + (eqD === 0
            ? `equals ${REF_LBL}, ${money(eqB)} \u2014 a difference of zero dollars, reconciled.`
            : `against ${REF_LBL}, ${money(eqB)} \u2014 a difference of ${money(eqD)}, which does not reconcile.`));
      $('lede-trend').innerHTML = trendLede + (SY !== null ? ` Viewing <strong>${SY}</strong> \u2014 every panel below is scoped to it.` : '');
      const topN = Math.min(5, sEnts.length);
      const top5 = sEnts.slice(0, 5).reduce((s, e) => s + e.total, 0);
      const allYrs = FILED_YEARS === 1 ? 'in the single filed year' : `across the ${numWord(FILED_YEARS)} ${NWITH ? 'reconciled' : 'filed'} years`;
      $('lede-conc').innerHTML = `${capWord(numWord(topN))} ${orgsWord(topN)} received <strong>${money(top5)}</strong> — ${share(top5, S_NAMED, '¢')} of every named-recipient dollar ${SY !== null ? 'in tax year ' + SY : allYrs}.`;
      const nrY = SY !== null ? SY : LATEST;
      const nrNew = newIn[nrY] || 0, nrRet = returningIn[nrY] || 0, nrAll = nrNew + nrRet;
      $('lede-newret').innerHTML = nrY === YEARS[0]
        ? `<strong>${num(nrNew)}</strong> ${recipWord(nrNew)} ${nrNew === 1 ? 'appears' : 'appear'} in ${nrY} — the first year in the filed record, so every organization counts as new.`
        : nrRet === 0
          ? `No recipient in ${nrY} had been funded in an earlier filed year — all <strong>${num(nrAll)}</strong> ${nrAll === 1 ? 'is' : 'are'} new.`
          : `Giving concentrates among returning grantees: <strong>${num(nrRet)} of ${num(nrAll)}</strong> ${recipWord(nrAll)} in ${nrY} had been funded before.`;
      const nrIncomplete = incompleteYear(nrY);
      if (nrIncomplete) $('lede-newret').textContent = `${nrY} contains unitemized disclosures. New and returning recipient comparisons are unavailable for that year.`;
      // L-14: with nothing to show beneath it, the sentence IS the card -- and its
      // sibling (Concentration) takes the width back rather than leaving it empty.
      {
        const nrCardEl = $('newret').closest('.card');
        if (nrCardEl) nrCardEl.classList.toggle('compact', !tiny && nrIncomplete);
        $('newret').hidden = nrIncomplete;
        if (nrIncomplete) $('nr-detail').hidden = true;
      }
      if (!sEnts.length) $('lede-conc').textContent = SY !== null && incompleteYear(SY)
        ? `${SY} was filed as unitemized disclosures \u2014 no recipient is named, so there is no concentration to measure. Its filed total still reconciles, to the dollar.`
        : 'No named-recipient detail is available in this scope. The filed total remains available in reconciliation.';
      const CAT_UNITEMIZED = 'Unitemized disclosures';
      const cTop = sCatList.find((c) => c.key !== CAT_OTHER && c.key !== CAT_UNITEMIZED);
      const cOtherRow = sCatList.find((c) => c.key === CAT_OTHER) || { sum: 0, count: 0 };
      const cUnitRow = sCatList.find((c) => c.key === CAT_UNITEMIZED) || { sum: 0, count: 0 };
      // the residual is never folded together silently -- a book with both an
      // "other" bucket and unitemized rows names both dollar figures below
      const cOther = { sum: cOtherRow.sum + cUnitRow.sum, count: cOtherRow.count + cUnitRow.count };
      const residueClause = cOtherRow.sum > 0 && cUnitRow.sum > 0
        ? `<strong>${moneyCompact(cOtherRow.sum)}</strong> stays in ${esc(CAT_OTHER.toLowerCase())} and <strong>${moneyCompact(cUnitRow.sum)}</strong> in ${num(cUnitRow.count)} unitemized ${cUnitRow.count === 1 ? 'disclosure' : 'disclosures'} with no recipient named`
        : cUnitRow.sum > 0
          ? `<strong>${moneyCompact(cUnitRow.sum)}</strong> stays in ${num(cUnitRow.count)} unitemized ${cUnitRow.count === 1 ? 'disclosure' : 'disclosures'} with no recipient named`
          : `<strong>${moneyCompact(cOther.sum)}</strong> stays in ${esc(CAT_OTHER.toLowerCase())}`;
      $('lede-cats').innerHTML = !cTop
        ? `No filed purpose here names a field the published rules recognise, so nothing is guessed — all <strong>${moneyCompact(cOther.sum)}</strong> across ${num(cOther.count)} ${grantsWord(cOther.count)} stays in ${esc(CAT_OTHER.toLowerCase())}.`
        : `<strong>${esc(cTop.key)}</strong> leads at <strong>${moneyCompact(cTop.sum)}</strong> across ${num(cTop.count)} ${grantsWord(cTop.count)}. Where the filing\u2019s words name no field, nothing is guessed \u2014 ${residueClause}.`;
      // the heading years follow the data; a record with one grant year has nothing to compare
      const mvCard = $('movers').closest('.card');
      if (mvCard) mvCard.hidden = tiny || YEARS.length < 2 || incompleteYear(SY === null ? LATEST : SY) || incompleteYear(sPrev);
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
    // ux-ledger-05: hide the two cards whose numbers are noise on a tiny book (their
    // shared grid is not left visibly empty -- neither renders a border of its own).
    { const concCard = $('conc-share').closest('.card'); if (concCard) concCard.hidden = tiny; }
    { const nrCard = $('newret').closest('.card'); if (nrCard) nrCard.hidden = tiny; }
    if (!tiny) {
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
      if (sEnts.length && unitemized.length) $('conc-hint').textContent += ' · share of named-recipient dollars';
      // R3 (NEW-2): a scope with no named recipient says so ONCE -- the lede above. No dash, no empty
      // track, no second "unavailable" line, and no labelled-but-empty list (axe aria-prohibited-attr);
      // the card goes compact so it leaves no empty air beside its neighbour.
      const concNone = !sEnts.length;
      ['conc-share', 'conc-hint', 'conc-top5'].forEach((id) => { const n = $(id); if (n) n.hidden = concNone; });
      { const pair = document.querySelector('.conc-pair'); if (pair) pair.hidden = concNone; }
      $('conc-share').closest('.card').classList.toggle('compact', concNone);
      // the largest recipients behind the number — they arrive one by one
      const top5list = sEnts.slice(0, 5);
      const maxT5 = top5list.length ? top5list[0].total : 0;   // an empty scope has no leader
      $('conc-top5').setAttribute('role', 'group');   // a labelled group (a bare div may not carry aria-label)
      if (concNone) $('conc-top5').removeAttribute('aria-label');
      else $('conc-top5').setAttribute('aria-label', cTopN === 1 ? 'The largest recipient' : `The ${numWord(cTopN)} largest recipients`);
      $('conc-top5').innerHTML = top5list.map((e, i) => barRow(
        `<span class="rk">${String(i + 1).padStart(2, '0')}</span> ${esc(dc(e.display))}`,
        e.total, maxT5,
        { cls: 'is-btn stacked', title: esc(dc(e.display)), attrs: `style="--i:${i}" data-ent="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(dc(e.display))}, ${money(e.total)}, ${share(e.total, S_NAMED, ' percent')} of named-recipient dollars${SY !== null ? ' in ' + SY : ''}. Opens the profile."`,
          val: `${money(e.total)}` }
      )).join('');
      $('conc-top5').querySelectorAll('.bar-row').forEach((r) => {
        const go = () => openProfile(r.dataset.ent);
        r.addEventListener('click', go);
        r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }

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
      // L-08: the grid draws named fields darkest-to-lightest, then the unitemized
      // hatch, then the hollow "other" -- the row list below/beside it stays in plain
      // dollar order (sCatList's own sort), so only the grid's own sequence changes.
      const catRank = (c) => c.key === CAT_OTHER ? 2 : c.key === CAT_UNITEMIZED_KEY ? 1 : 0;
      const pennyOrder = sCatList.map((c, i) => i).sort((a, b) => catRank(sCatList[a]) - catRank(sCatList[b]));
      const cells = [];
      pennyOrder.forEach((ci) => {
        const c = sCatList[ci];
        const hollow = c.key === CAT_OTHER;
        const unit = c.key === CAT_UNITEMIZED_KEY;
        for (let k = 0; k < cents[ci]; k++) {
          const label = (k === 0 && cents[ci] >= 4)
            ? `<b class="${hollow || unit ? 'k' : (darkText(c.color) ? 'w' : 'k')}">${cents[ci]}</b>` : '';
          cells.push(`<span aria-hidden="true" class="penny${hollow ? ' other' : ''}${unit ? ' unitemized' : ''}" data-cat="${esc(c.key)}" style="--pc:${c.color};--pi:${cells.length}" title="${esc(c.key)} — ${cents[ci]}¢ of the dollar">${label}</span>`);
        }
      });
      grid.innerHTML = cells.join('');
      grid.setAttribute('aria-label', 'One granted dollar as one hundred cents: '
        + sCatList.map((c, i) => `${c.key} ${cents[i]}¢`).join(', ') + '.');
      const capVal = $('penny-cap-val');
      const capDefault = capVal ? capVal.textContent : 'one dollar, one hundred cents';
      const maxCatSum = sCatList.length ? Math.max(...sCatList.map((c) => c.sum)) : 0;
      $('cat-rows').innerHTML = sCatList.map((c, i) => {
        const unit = c.key === CAT_UNITEMIZED_KEY;
        const hollow = c.key === CAT_OTHER;
        return `
        <button type="button" class="cat-row" data-cat="${esc(c.key)}" aria-label="${esc(c.key)}: ${cents[i] === 0 ? 'under one cent' : cents[i] + ' cents'} of every dollar, ${money(c.sum)} across ${num(c.count)} ${grantsWord(c.count)}. Opens these grants in the ledger.">
          <span class="cr-sw${unit ? ' unitemized' : ''}${hollow ? ' other' : ''}"${unit || hollow ? '' : ` style="background:${c.color}"`}></span>
          <span class="cr-c">${cents[i] === 0 ? '<1\u00a2' : cents[i] + '\u00a2'}</span>
          <span class="cr-name">${esc(c.key)}<span class="cr-meta">${num(c.count)} ${grantsWord(c.count)} \u00b7 ${share(c.sum, S_GRAND)}</span></span>
          <span class="cr-val">${moneyCompact(c.sum)}</span>
          <span class="cr-bar" aria-hidden="true" style="--w:${barPct(c.sum, maxCatSum)}%"></span>
        </button>`;
      }).join('');
      const rows = [...$('cat-rows').querySelectorAll('.cat-row')];
      const spotlight = (cat) => {
        grid.classList.toggle('dim', cat !== null);
        grid.querySelectorAll('.penny').forEach((p) => p.classList.toggle('hot', p.dataset.cat === cat));
        if (capVal) {
          if (cat === null) capVal.textContent = capDefault;
          else {
            const idx = sCatList.findIndex((c) => c.key === cat);
            if (idx >= 0) capVal.textContent = `${cents[idx]}¢ \u00b7 ${cat}`;
          }
        }
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
      // R3 (DECISIONS-JOE #1): each waiting card says so once and draws the double-rule loader under it
      ['lede-conc', 'lede-newret', 'lede-cats', 'lede-movers'].forEach((id) => { const n = $(id); if (n) n.innerHTML = esc(wait) + '<span class="dr-load" aria-hidden="true"></span>'; });
      ['conc-share', 'conc-hint', 'conc-top5'].forEach((id) => { const n = $(id); if (n) n.hidden = true; });
      { const pair = document.querySelector('.conc-pair'); if (pair) pair.hidden = true; }
      $('conc-share').textContent = '\u2026';
      $('conc-bar').style.width = '0%';
      ['conc-top5', 'penny-grid', 'cat-rows', 'newret', 'movers'].forEach((id) => { const n = $(id); if (n) n.innerHTML = ''; });
      $('penny-grid').setAttribute('aria-label', wait);
    }
  }

  // ---------- recipients ----------
  let recQ = '';
  function renderRecipients() {
    const SY = state.y;
    // the sort buttons follow the state (a link can arrive with rs=name)
    [['rs-total', 'total'], ['rs-name', 'name']].forEach(([id, v]) => {
      const b = $(id); if (!b) return;
      b.classList.toggle('active', recSort === v); b.setAttribute('aria-pressed', recSort === v ? 'true' : 'false');
    });
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
    // P4 (L4): a filer that named no recipient gets one note, not an empty "Top recipients" card over
    // "0 of 0 recipients" and a search box with nothing to search
    {
      const cards = [...document.querySelectorAll('#panel-recipients > .card:not(#rec-none)')];
      let none = document.getElementById('rec-none');
      const noNamed = !entList.length && !rowsPending;
      if (noNamed && !none) {
        none = document.createElement('div');
        none.className = 'card rec-none'; none.id = 'rec-none';
        $('panel-recipients').appendChild(none);
      }
      cards.forEach((c) => { c.hidden = noNamed; });
      if (none) none.hidden = !noNamed;
      if (noNamed) {
        const masked = grants.filter((g) => g.record_type === 'individual_masked');
        const sumOf = (rs) => rs.reduce((t, g) => t + g.a, 0);
        const parts = [];
        if (unitemized.length) parts.push(`${unitemized.length === 1 ? 'its one filed row is an unitemized disclosure' : 'its ' + num(unitemized.length) + ' filed rows are unitemized disclosures'} totalling ${money(sumOf(unitemized))}`);
        if (masked.length) parts.push(`${num(masked.length)} ${plural(masked.length, 'grant')} to individuals (names withheld) totalling ${money(sumOf(masked))}`);
        none.innerHTML = `<div class="card-head"><h2>No named recipients</h2></div>`
          + `<p class="rec-none-p">This filer disclosed no named recipient organization; ${parts.join(', and ')}. `
          + `Every dollar still reconciles to the filed totals. <a href="#tab=grants" id="rec-none-go">Open the grants \u2192</a></p>`;
        const go = document.getElementById('rec-none-go');
        if (go) go.addEventListener('click', (e) => { e.preventDefault(); setTab('grants'); });
        return;
      }
    }
    const top = sEnts.slice(0, 10);
    const maxT = top.length ? top[0].total : 0;   // an empty scope has no leader
    // P4: a scope with nobody named in it (a year filed as unitemized disclosures) says so once, in place
    // of an empty bar card and a "clear the search" message nobody asked for
    {
      const scopeNone = !sEnts.length && !rowsPending;
      const barsCard = $('rec-bars').closest('.card');
      if (barsCard) barsCard.hidden = scopeNone;
      const tools = document.querySelector('#panel-recipients .rec-tools');
      if (tools) tools.hidden = scopeNone;
      const emp = $('rec-empty');
      if (emp) {
        const yRows = SY === null ? [] : grants.filter((g) => g.y === SY);
        emp.textContent = scopeNone
          ? (SY !== null && yRows.length && yRows.every((g) => g.record_type !== 'named_recipient')
              ? `No recipient is named in ${SY} \u2014 its ${num(yRows.length)} filed ${plural(yRows.length, 'row')} (${money(yRows.reduce((t, g) => t + g.a, 0))}) ${yRows.length === 1 ? 'names' : 'name'} no organization. The year still reconciles, to the dollar.`
              : 'No named recipient in this scope.')
          : (recQ ? `No recipient matches \u201c${recQ}\u201d \u2014 clear the search.` : 'No recipients match \u2014 clear the search.');
      }
    }
    $('rec-bars').innerHTML = top.map((e, i) => barRow(
      `<span class="rk">${String(i + 1).padStart(2, '0')}</span> ${esc(dc(e.display))}${e.aliases.length > 1 ? ` <span class="merged-flag" title="${e.aliases.length} as-filed name variants merged — reviewed by hand">${e.aliases.length} names</span>` : ''}`,
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
          <span class="ri-name" title="As filed: ${esc(e.aliases.join(' · '))}">${esc(dc(e.display))}${e.aliases.length > 1 ? ` <span class="merged-flag" title="${e.aliases.length} as-filed name variants merged — reviewed by hand">${e.aliases.length} names</span>` : ''}</span>
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
      recLetterDefault = groupsAll.has('A') ? 'A' : (lettersAvail[0] || '*');
      if (recLetter !== '*' && (recLetter === null || !groupsAll.has(recLetter))) recLetter = recLetterDefault;
      const activeL = q ? '*' : recLetter; // a search always looks across every letter
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      alphaEl.hidden = false;
      alphaEl.innerHTML = `<button type="button" data-l="*" class="${activeL === '*' ? 'on' : ''}" aria-pressed="${activeL === '*' ? 'true' : 'false'}" aria-label="Show every letter">All</button>` + letters.map((L) =>
        `<button type="button" data-l="${L}" class="${activeL === L ? 'on' : ''}" aria-pressed="${activeL === L ? 'true' : 'false'}" ${groupsAll.has(L) ? '' : 'disabled'} aria-label="${activeL === L ? 'Show every letter' : 'Show only ' + L}">${L}</button>`).join('');
      alphaEl.querySelectorAll('button[data-l]:not([disabled])').forEach((b) => {
        b.addEventListener('click', () => { recLetter = b.dataset.l === '*' ? '*' : (recLetter === b.dataset.l ? '*' : b.dataset.l); writeHash(false); renderRecipients(); });
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
      // P4 (L2): grants to individuals are counted in every total but never listed by name -- one line,
      // placed at its dollar rank, says how many rows and how much
      const mRows = q ? [] : grants.filter((g) => g.record_type === 'individual_masked' && (SY === null || g.y === SY));
      let mHtml = '', mAt = -1;
      if (mRows.length) {
        const mTot = mRows.reduce((t, g) => t + g.a, 0);
        const mYears = [...new Set(mRows.map((g) => g.y))].sort();
        mAt = slice.findIndex((e) => e.total < mTot);
        if (mAt < 0 && showAll) mAt = slice.length;
        mHtml = `
      <li class="rec-flat-li">
        <div class="rec-item rec-flat" title="${esc(MASKED_TITLE)}">
          <span class="ri-name">Individual recipients (names withheld)</span>
          <span class="ri-meta">${num(mRows.length)} ${grantsWord(mRows.length)} · ${mYears.join(', ')} · <span class="ri-share">${share(mTot, S_GRAND, '%', 1)} of ${SY !== null ? SY : 'all'} dollars</span></span>
          <span class="ri-amt">${money(mTot)}</span>
        </div>
      </li>`;
      }
      const rowsHtml = slice.map((e, ri) => item(e, ri));
      if (mAt >= 0) rowsHtml.splice(mAt, 0, mHtml);
      $('rec-rows').innerHTML = rowsHtml.join('') + (showAll ? '' :
        `<li><button type="button" class="show-all" id="rec-more">Show all ${num(list.length)} ${recipWord(list.length)} — top ${N} shown, ${money(list.slice(N).reduce((s,e)=>s+e.total,0))} in the rest</button></li>`);
      const more = document.getElementById('rec-more');
      if (more) more.addEventListener('click', () => { recExpanded = true; writeHash(false); renderRecipients(); });
    }
    $('rec-rows').querySelectorAll('.rec-item').forEach((b) => {
      b.addEventListener('click', () => openProfile(b.dataset.ent));
    });
  }
  $('rs-total').addEventListener('click', () => { recSort = 'total'; writeHash(false); renderRecipients(); });
  $('rs-name').addEventListener('click', () => { recSort = 'name'; writeHash(false); renderRecipients(); });
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
  // WebKit's click focuses the nearest focusable ancestor (MAIN#main), never the
  // control itself, so a plain activeElement read at open time cannot recover it on
  // close; a capture-phase listener remembers the actual clicked control instead.
  let lastClick = { el: null, t: -Infinity };
  document.addEventListener('click', (e) => { lastClick = { el: e.target.closest('button,[role="button"],a'), t: performance.now() }; }, true);
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
    if (!wasOpen) lastFocus = (lastClick.el && performance.now() - lastClick.t < 1000) ? lastClick.el : document.activeElement;
    const per = YEARS.map((y) => ({
      y,
      sum: e.grants.filter((g) => g.y === y).reduce((s, g) => s + g.a, 0),
      count: e.grants.filter((g) => g.y === y).length
    })).filter((p) => p.count > 0);
    const maxP = Math.max(...per.map((p) => p.sum));
    $('pf-title').textContent = dc(e.display);
    const eYears = [...e.years].sort((a, b) => a - b);
    const eYearSpan = eYears.length <= 1 ? String(eYears[0]) : `${eYears[0]}–${eYears[eYears.length - 1]}`;
    $('pf-sub').textContent = `${money(e.total)} · ${num(e.count)} ${grantsWord(e.count)} · ${eYearSpan}`;
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
    // L-10: grouped by year, sticky year header, one receipt per year (not per row)
    {
      const byY = new Map();
      e.grants.slice().sort((a, b) => b.y - a.y || b.a - a.a).forEach((g) => {
        if (!byY.has(g.y)) byY.set(g.y, []);
        byY.get(g.y).push(g);
      });
      const yearsDesc = [...byY.keys()].sort((a, b) => b - a);
      $('pf-grants').innerHTML = yearsDesc.map((y) => {
        const rows = byY.get(y);
        const yearSum = rows.reduce((s, g) => s + g.a, 0);
        const t = tieout[String(y)];
        const chip = t ? receiptMark(t.object_id, 'pf-go', 'filing ↗') : '';
        return `<li class="pf-yh" data-y="${y}"><span>${y}</span><span>${money(yearSum)} · ${num(rows.length)} ${grantsWord(rows.length)}${chip ? ' · ' + chip : ''}</span></li>`
          + rows.map((g) => `
          <li class="pf-g">
            <span class="pf-gp" title="As filed: ${esc(g.p)}">${esc(dc(g.p))}</span>
            <span class="pf-ga">${money(g.a)}</span>
          </li>`).join('');
      }).join('');
    }
    const inY = state.y !== null ? e.grants.filter((g) => g.y === state.y).length : 0;
    const keepY = state.y !== null && inY > 0;
    $('pf-all').textContent = keepY
      ? (inY === 1 ? `Open its one ${state.y} ${grantsWord(1)} in the ledger` : `Open ${num(inY)} ${state.y} ${grantsWord(inY)} in the ledger`)
      : e.count === 1 ? 'Open its one filed row in the ledger'   // P4: never "all 1 lifetime filed row"
        : `Open all ${num(e.count)} ${grantsWord(e.count)} in the ledger`;
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
      // Escape is not a global "clear every filter" shortcut -- it only clears the
      // search box when that box has focus (the conventional meaning of Escape in a
      // text field). #clear-all and each chip's ✕ remain the way to clear a scope
      // set by year/recipient/category/min-amount from anywhere else on the page.
      if (state.tab === 'grants' && document.activeElement === $('q') && state.q) {
        state.q = ''; state.page = 0;
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
          : g.record_type === 'individual_masked'
            ? `<span class="recip-flat" style="font-weight:600" title="${esc(MASKED_TITLE)}">${esc(MASKED_LABEL)}</span>`
            : `<button type="button" class="recip" data-rec="${esc(g.r)}" title="As filed: ${esc(g.r)}">${esc(dc(g.r))}</button>`}</td>
        <td class="amt">${money(g.a)}</td>
        <td class="purpose" title="As filed: ${esc(g.p)}">${esc(dc(g.p))}</td>
        <td class="loc">${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</td>
      </tr>`).join('');
    // mobile cards
    $('grant-cards').innerHTML = slice.map((g, ri) => `
      <li class="gcard" style="--ri:${Math.min(ri, 12)}">
        ${g.record_type === 'unitemized'
          ? `<div class="gcard-flat" title="${UNITEMIZED_TITLE}">`
          : g.record_type === 'individual_masked'
            ? `<div class="gcard-flat" title="${esc(MASKED_TITLE)}">`
            : `<button type="button" class="gcard-btn" data-rec="${esc(g.r)}" aria-label="${esc(dc(g.r))}, ${money(g.a)}, ${g.y}. Opens the recipient profile.">`}
          <div class="gc-top"><span class="gc-y">${g.y}</span><span class="gc-a">${money(g.a)}</span></div>
          <div class="gc-r">${g.record_type === 'individual_masked' ? esc(MASKED_LABEL) : esc(dc(g.r))}${g.record_type === 'unitemized' ? ' · unitemized disclosure' : ''}</div>
          <div class="gc-p">${esc(dc(g.p))}</div>
          <div class="gc-l">${esc([dc(g.c || ''), g.s].filter(Boolean).join(', '))}</div>
        ${g.record_type === 'unitemized' || g.record_type === 'individual_masked' ? '</div>' : '</button>'}
      </li>`).join('');
    $('empty').hidden = slice.length > 0;

    const from = rows.length ? start + 1 : 0;
    const to = Math.min(start + P, rows.length);
    $('page-info').textContent = rows.length
      ? `Showing ${num(from)}–${num(to)} of ${num(rows.length)}`
      : 'No matching grants';
    // P4 (L9): one page of rows has nothing to page through -- no "Previous · Page 1 of 1 · Next"
    { const pg = document.querySelector('.pager'); if (pg) pg.hidden = rows.length <= P; }
    $('prev-page').disabled = state.page === 0;
    $('next-page').disabled = to >= rows.length;
    // long books: First / Last and a typed page number, hidden while two pages are enough
    lastMaxPage = maxPage;
    {
      const many = maxPage >= 2;
      const wrap = $('page-jump-wrap');
      if (wrap) {
        wrap.hidden = !many;
        $('first-page').hidden = !many; $('last-page').hidden = !many;
        $('first-page').disabled = state.page === 0; $('last-page').disabled = state.page >= maxPage;
        const inp = $('page-jump');
        inp.max = String(maxPage + 1);
        if (document.activeElement !== inp) inp.value = String(state.page + 1);
        $('page-total').textContent = num(maxPage + 1);
      }
    }

    document.querySelectorAll('#grant-thead th[data-sort]').forEach((th) => {
      const s = th.dataset.sort;
      const active = state.sort.startsWith(s + '-');
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (state.sort.endsWith('asc') ? 'ascending' : 'descending') : 'none');
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
  $('clear-all').addEventListener('click', () => {
    state.y = null; state.r = null; state.c = null; state.q = ''; state.min = 0; state.page = 0;
    syncControls(); writeHash(true); render();
  });
  let lastMaxPage = 0;   // set by renderGrants: the last page index of the current view
  function gotoPage(p) {
    state.page = Math.max(0, Math.min(lastMaxPage, p)); writeHash(true); renderGrants();
    $('ledger-top').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  $('prev-page').addEventListener('click', () => { if (state.page > 0) gotoPage(state.page - 1); });
  $('next-page').addEventListener('click', () => gotoPage(state.page + 1));
  $('first-page').addEventListener('click', () => gotoPage(0));
  $('last-page').addEventListener('click', () => gotoPage(lastMaxPage));
  {
    const inp = $('page-jump');
    const go = () => {
      const v = Math.floor(Number(inp.value));
      if (!Number.isFinite(v) || inp.value === '') { inp.value = String(state.page + 1); return; }
      gotoPage(v - 1);
    };
    inp.addEventListener('change', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); inp.blur(); } });
    // input is type=text (WebKit's number-input select() does not select on tap), so
    // strip anything but digits as the user types
    inp.addEventListener('input', () => { const d = inp.value.replace(/[^0-9]/g, ''); if (d !== inp.value) inp.value = d; });
    // typing a page number should replace it, not append to whatever page rendered last.
    // WebKit focuses the input before its tap finishes, which clears an immediate
    // select() -- deferring one tick past the tap makes the selection stick.
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('click', () => setTimeout(() => inp.select(), 0));
  }
  // "/" focuses the grants search from anywhere on the page (never while typing or in a dialog)
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (profileId !== null) return;
    e.preventDefault();
    if (state.tab !== 'grants') setTab('grants');
    const q = $('q'); q.focus(); q.select();
  });
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
    // a name or purpose transcribed as filed can begin with a character a spreadsheet
    // reads as a formula (=, +, -, @) or control code (tab, CR) -- an apostrophe defuses
    // that read without altering what was filed (OWASP's CSV-injection mitigation).
    const defuse = (s) => /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return (s.indexOf('"') >= 0 || s.indexOf(',') >= 0 || s.indexOf(NLc) >= 0)
        ? '"' + s.split('"').join('""') + '"' : s;
    };
    const csv = [head].concat(rows.map((g) =>
      [g.y, defuse(g.record_type === 'individual_masked' ? MASKED_LABEL : g.r), defuse((entities.get(aliasToId.get(g.r)) || {}).display || ''), g.a, defuse(g.p), defuse(g.c), g.s, g.o, g.record_type || 'named_recipient'].map(cell).join(','))).join(NLc);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
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
  // "Report it": a mail link that carries the exact view (built at click, so the hash is current)
  {
    const rl = $('report-link');
    if (rl) rl.addEventListener('click', () => {
      rl.href = 'mailto:jjcurry027@gmail.com?subject=' + encodeURIComponent('The Grants Ledger: a problem on ' + document.title.replace(/\s+/g, ' '))
        + '&body=' + encodeURIComponent('Page: ' + location.href + '\n\nWhat I expected:\n\nWhat happened:\n');
    });
  }
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
    // L-07: every filed tax period gets a row in one schedule -- including a year the
    // foundation filed but paid no grants, which still reconciles ($0 = $0) and is
    // part of the badge’s N/N claim -- closed with a double-rule total.
    // repair pass (major): a withheld year has no filing to reconcile, but the one
    // table meant to show every other year reconciles was built from tieout alone,
    // so it never listed the year it was refusing. It is now the union of filed and
    // withheld years; a withheld row renders with dashes, its own fail badge, and a
    // link to why, instead of silently vanishing from the schedule.
    const tieYears = Object.keys(tieout).sort();
    const withheldYears = Object.keys(WITHHELD).sort();
    const allTieYears = [...new Set([...tieYears, ...withheldYears])].sort();
    const exSlug = esc(document.documentElement.dataset.slug || '');
    let sumRows = 0, sumSched = 0, sumRef = 0;
    const tieRows = allTieYears.map((y) => {
      if (!tieout[y]) {
        const w = WITHHELD[y] || {};
        // P4 (L1): a year withheld because it does not reconcile carries both of its filed figures -- the
        // schedule shows exactly how far apart they are; it never enters the totals below
        const hasFig = typeof w.sum === 'number' && typeof w.filed === 'number';
        const wd = hasFig ? w.filed - w.sum : null;
        return `
        <tr class="tie-row is-withheld" data-y="${y}">
          <td data-label="Tax year">${y}</td>
          <td data-label="Grant rows"><span class="tie-v">${hasFig ? num(w.rows) : '—'}</span></td>
          <td data-label="Σ grant schedule"><span class="tie-v">${hasFig ? money(w.sum) : '—'}</span></td>
          <td data-label="Filed ${esc(REF_LBL)}"><span class="tie-v">${hasFig ? money(w.filed) : '—'}</span></td>
          <td data-label="Δ"><span class="badge-fail">${hasFig ? 'Δ\u00a0' + signedMoney(wd) + ' · ' : ''}withheld</span></td>
          <td data-label="Source">${w.object_id ? receiptMark(w.object_id, '', 'Filing ↗') + ' ' : ''}<a href="../../exceptions/#${exSlug}" title="${esc(w.why || 'Named on the exceptions page.')}">Why →</a></td>
        </tr>`;
      }
      const t = tieout[y];
      const delta = t.line25_col_d - t.grant_sum;
      sumRows += t.grant_count; sumSched += t.grant_sum; sumRef += t.line25_col_d;
      const scanned = t.object_id && !/^\d+$/.test(String(t.object_id));
      return `
        <tr class="tie-row" data-y="${y}">
          <td data-label="Tax year">${y}</td>
          <td data-label="Grant rows"><span class="tie-v">${num(t.grant_count)}</span></td>
          <td data-label="Σ grant schedule"><span class="tie-v">${money(t.grant_sum)}</span></td>
          <td data-label="Filed ${esc(REF_LBL)}"><span class="tie-v">${money(t.line25_col_d)}</span></td>
          <td data-label="Δ">${delta === 0 ? '<span class="badge-pass">$0 ✓</span>' : `<span class="badge-fail">Δ\u00a0${signedMoney(delta)} · withheld</span>`}</td>
          <td data-label="Source">${receiptMark(t.object_id, '', scanned ? 'Scan ↗' : 'Filing ↗')} <span class="cm-tier">${scanned ? 'IRS scan' : 'e-file'}</span></td>
        </tr>`;
    }).join('');
    const grandDelta = sumRef - sumSched;
    $('tie-cards').innerHTML = `<table class="tie-table">
      <caption class="sr-only">Reconciliation of the grant schedule to the filed total, by tax year.</caption>
      <thead><tr>
        <th scope="col">Tax year</th><th scope="col">Grant rows</th><th scope="col">Σ grant schedule</th>
        <th scope="col">Filed ${esc(REF_LBL)}</th><th scope="col">Δ</th><th scope="col">Source</th>
      </tr></thead>
      <tbody>${tieRows}</tbody>
      <tfoot><tr>
        <td>Total</td><td>${num(sumRows)}</td><td>${money(sumSched)}</td><td>${money(sumRef)}</td>
        <td>${grandDelta === 0 ? '<span class="badge-pass">$0 ✓</span>' : `<span class="badge-fail">Δ\u00a0${signedMoney(grandDelta)}</span>`}</td><td></td>
      </tr></tfoot>
    </table>`;
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
    // L-14: a handful of merges are worth seeing at a glance; a long table is collapsed
    const entDetails = $('ent-details');
    if (entDetails) {
      $('ent-summary').textContent = `${num(mergedEntities.length)} ${plural(mergedEntities.length, 'merge')}, each reviewed — show the evidence`;
      entDetails.open = mergedEntities.length <= 6;
      entDetails.hidden = mergedEntities.length === 0;
    }
    requestAnimationFrame(() => { if (typeof fitKw === 'function') fitKw(); });
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
    // ux-ledger-05: too few named rows for a median, a range or a concentration share
    // to mean anything -- the total above stays exact; the interior statistics don't
    // pretend to describe a shape with one or two points.
    const tiny = isTiny();
    // P4 (m13): a book with no named row at all says why in its own words; the range tile beside the
    // median no longer repeats the median's sentence word for word
    const tinyHint = !tiny ? null : namedGrants.length === 0
      ? 'No named-recipient rows — every filed row is an unitemized disclosure'
      : `Too few named-recipient rows (${num(namedGrants.length)}, fewer than 10) for this figure`;
    if (tiny) {
      $('kpi-median').textContent = '\u2014';
      $('kpi-median').parentElement.querySelector('.k-hint').textContent = tinyHint;
    } else {
      $('kpi-median').parentElement.querySelector('.k-hint').textContent =
        `${num(scopedNamed.length)} named-recipient rows${SY === null ? ', ' + allYearsPhrase() : ' in ' + SY}`;
    }
    $('kpi-orgs').parentElement.querySelector('.k-hint').textContent =
      `Named recipients${SY === null ? ', ' + allYearsPhrase() : ' in ' + SY}`;
    const tinyNote = document.getElementById('tiny-note');
    if (tinyNote) {
      // P4: a book with no named row at all is explained once, by the coverage note ("All 4 filed rows are unitemized
      // disclosures ..."); "0 named-recipient rows are too few for a median" beneath it said the same thing worse
      tinyNote.hidden = !tiny || (namedGrants.length === 0 && unitemized.length > 0);
      if (tiny) tinyNote.textContent = `${num(namedGrants.length)} named-recipient ${namedGrants.length === 1 ? 'row is' : 'rows are'} too few for a median, a typical-grant range or a recipient-concentration share to mean anything. The totals above are exact; those figures are left out rather than shown with misleading precision.`;
    }
    // Typical grant: the middle half of named grants (25th to 75th percentile).
    // A range says more to a grant writer than one median; "could we fit" starts here.
    {
      const rangeHintEl = document.getElementById('kpi-range-hint');
      const el = $('kpi-range');
      const fit = $('fit-line');
      if (tiny) {
        if (el) el.textContent = '\u2014';
        if (rangeHintEl) rangeHintEl.textContent = 'Same reason as the median';
        if (fit) fit.hidden = true;
      } else if (rowsPending) {
        // P4 (M3): never the preview's quartiles -- the stamped whole-book range, or a plain wait
        if (el) el.textContent = SY === null && STAMPED_RANGE ? STAMPED_RANGE.v : '\u2026';
        if (rangeHintEl) rangeHintEl.textContent = SY === null && STAMPED_RANGE ? STAMPED_RANGE.hint : waitLine();
        if (fit) fit.hidden = true;
      } else {
        const q = (arr, p) => { if (!arr.length) return null; const i = (arr.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };
        const q1 = q(namedAmounts, 0.25), q3 = q(namedAmounts, 0.75);
        if (el) el.textContent = q1 === null ? '\u2014' : (q1 === q3 ? moneyCompact(q1) : moneyCompact(q1) + '\u2013' + moneyCompact(q3));
        if (rangeHintEl) rangeHintEl.textContent = 'The middle half of named grants';
        if (fit) {
          const latest = LATEST, nw = newIn[latest] || 0, ret = returningIn[latest] || 0, tot = nw + ret;
          const byState = new Map();
          namedGrants.forEach((g) => { if (g.s) byState.set(g.s, (byState.get(g.s) || 0) + g.a); });
          const top = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          const namedSum = [...byState.values()].reduce((s, v) => s + v, 0) || 1;
          const parts = [];
          if (tot) parts.push(`In ${latest}, ${Math.round(nw / tot * 100)}% of recipients were funded for the first time in this record`);
          if (top.length) parts.push(`${Math.round(top.reduce((s, x) => s + x[1], 0) / namedSum * 100)}% of named dollars went to recipients in ${top.map((x) => x[0]).join(', ')}`);
          let fitFallback = false;
          if (!parts.length && !rowsPending) { parts.push(`${latest} contains only unitemized disclosures \u2014 no recipient-level comparison is available for that year`); fitFallback = true; }
          fit.hidden = !parts.length || rowsPending;
          fit.textContent = !parts.length ? '' : (fitFallback ? parts.join(' \u00b7 ') : parts.join(' \u00b7 ') + '. Historical record, not eligibility.');
        }
      }
    }
    const coverage = document.getElementById('record-coverage');
    if (coverage) {
      const rolled = unitemized.filter((g) => SY === null || g.y === SY);
      const rolledSum = money(rolled.reduce((sum, g) => sum + g.a, 0));
      const dWord = rolled.length === 1 ? 'disclosure' : 'disclosures';
      coverage.hidden = !rolled.length;
      // P4 (m15): "·"-separated, never a full stop followed by a digit ("$165,466,430. 1" read as a
      // decimal); a book with no named row says so plainly instead of "0 named-recipient rows · $0"
      coverage.innerHTML = (scopedNamed.length
        ? `${num(scopedNamed.length)} named-recipient ${plural(scopedNamed.length, 'row')} \u00b7 ${money(scopedNamed.reduce((sum, g) => sum + g.a, 0))} \u00b7 `
          + `${num(rolled.length)} unitemized ${dWord} (${rolledSum}) retained in filed totals. `
          + 'Unnamed disclosures are excluded from recipient counts, grant medians and recipient comparisons.'
        : `${rolled.length === 1 ? 'The one filed row is an unitemized disclosure' : 'All ' + num(rolled.length) + ' filed rows are unitemized disclosures'} (${rolledSum}), retained in filed totals. `
          + 'The filing names no recipient, so there are no recipient counts, medians or comparisons to make.')
        + ' <a href="../../recovered/">Recover a year like this \u2192</a>';
    }
    if (rowsPending) {   // a median of the largest rows is not the median; the stamps are the only true figures
      $('kpi-orgs').textContent = SY === null ? STAMPED_ORGS : '\u2026';
      $('kpi-orgs').parentElement.querySelector('.k-hint').textContent = SY === null ? 'Named recipients, ' + allYearsPhrase() : `Named recipients in ${SY} \u2014 full list loading`;
      $('kpi-median').textContent = SY === null && STAMPED_MEDIAN ? STAMPED_MEDIAN.v : '\u2026';
      $('kpi-median').parentElement.querySelector('.k-hint').textContent = SY === null && STAMPED_MEDIAN ? STAMPED_MEDIAN.hint : waitLine();
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
          return (d === 0 ? 'Δ\u00a0$0 vs ' : 'Δ\u00a0' + signedMoney(d) + ' vs ') + REF_LBL;
        })()}</span>`;
      }
    }
    // L-11: the phone rail's own scope readout, next to it (the rail never moves to show it)
    const railScope = document.getElementById('rail-scope');
    if (railScope) {
      if (SY === null) { railScope.hidden = true; railScope.textContent = ''; }   // P4 (M2): nothing stale to paint
      else {
        railScope.hidden = false;
        const ty = tieout[String(SY)];
        const d = ty ? ty.line25_col_d - ty.grant_sum : 0;
        railScope.textContent = `In ${SY} · ${money(byYear[SY].sum)} · ${num(byYear[SY].count)} ${grantsWord(byYear[SY].count)} · ${d === 0 ? 'Δ\u00a0$0' : 'Δ\u00a0' + signedMoney(d)}`;
      }
    }
    const dEl = $('kpi-delta');
    dEl.classList.remove('up', 'down');
    const dy = SY !== null ? SY : LATEST;
    const dp = YEARS.indexOf(dy) > 0 ? YEARS[YEARS.indexOf(dy) - 1] : null; // prior FILED year, not dy-1 (years can be non-contiguous when one is withheld)
    dEl.parentElement.querySelector('.k-label').textContent = SY === null ? 'Latest year' : 'Year change';
    if (dp === null) {
      dEl.textContent = '—';
      $('kpi-delta-hint').textContent = Object.keys(tieout).some((k) => +k < dy)
        ? `${dy} is the first year with grants paid`   // P4 (m13): earlier years are filed, at $0
        : `${dy} is the first filed year in the record`;
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
    fitKpis();
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'recipients') renderRecipients();
    else if (state.tab === 'grants') renderGrants();
    else renderMethodology();
    markScrollRegions();
  }
  // R2 (c): a headline figure never wraps and never clips. The four values share one size; when
  // any of them would overflow its cell ("$100K–$250K" in the 2x2 phone grid, or four across
  // beside the sidebar at 1100px) all four step down together, so the strip stays one voice.
  function fitKpis() {
    const vals = [...document.querySelectorAll('.sheet-kpis .k-val')];
    if (!vals.length) return;
    vals.forEach((v) => { v.style.fontSize = ''; });
    let ratio = 1;
    vals.forEach((v) => { const cw = v.clientWidth, sw = v.scrollWidth; if (cw > 0 && sw > cw) ratio = Math.min(ratio, cw / sw); });
    if (ratio < 1) {
      const base = parseFloat(getComputedStyle(vals[0]).fontSize) || 30;
      const fs = Math.max(15, Math.floor(base * ratio * 0.97 * 10) / 10);
      vals.forEach((v) => { v.style.fontSize = fs + 'px'; });
    }
  }
  // R2 (R-5): a table that scrolls sideways (the purpose map, the NTEE map, the grant table
  // between 720 and 899px) has to be reachable and named for a keyboard or screen-reader user.
  function markScrollRegions() {
    document.querySelectorAll('.cm-wrap, .tw, .table-wrap').forEach((w) => {
      if (!w.getClientRects().length) return;   // in a hidden panel: judge it when it shows
      const scrolls = w.scrollWidth > w.clientWidth + 1;
      if (scrolls && !w.hasAttribute('tabindex')) {
        const cap = w.querySelector('caption');
        w.setAttribute('tabindex', '0');
        w.setAttribute('role', 'region');
        w.setAttribute('aria-label', (cap && cap.textContent.trim()) || 'Scrollable table');
        w.dataset.scrollRegion = '1';
      } else if (!scrolls && w.dataset.scrollRegion) {
        w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label');
        delete w.dataset.scrollRegion;
      }
    });
  }

  function syncProfile() {
    if (state.pr !== null && (profileId !== state.pr || profileScopeY !== state.y)) openProfile(state.pr, true);
    else if (state.pr === null && profileId !== null) closeProfile(true, true);
  }
  window.addEventListener('hashchange', () => { readHash(); syncControls(); setTab(state.tab, false); syncProfile(); });
  window.addEventListener('popstate', () => { readHash(); syncControls(); setTab(state.tab, false); syncProfile(); });
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (state.tab === 'grants') renderGrants(); fitKpis(); markScrollRegions(); }, 200); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitKpis());

  // check console — the referee, re-run in the reader's own browser, on the full list only
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
        node.id = 'rows-status'; node.className = 'mini-note rows-status';
        node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
        const host = document.querySelector('.sheet-kpis');
        if (host) host.insertAdjacentElement('afterend', node); else document.body.prepend(node);
      }
      const shown = `${num(grants.length)} largest of ${num(ROWS_TOTAL)} ${grantsWord(ROWS_TOTAL)}`;
      node.classList.toggle('failed', mode !== 'loading');
      if (mode === 'loading') node.innerHTML = `Loading the full grant list \u2014 ${num(ROWS_TOTAL)} rows. The ${esc(shown)} are shown meanwhile.<span class="dr-load" aria-hidden="true"></span>`;
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

  // sticky tab bar + grants toolbar. R2 (R-3/R-4): the tab bar is .stuck exactly while it is
  // pinned at the top -- observed on itself, 1px inside the viewport edge (the old sentinel
  // flipped the class 32px early, while the bar was still in flow, and the class used to add
  // an in-flow row). The grants toolbar counts as pinned from the moment it reaches the bottom
  // of the tab bar's context strip; from then on the strip steps aside (.lt-pinned), so the
  // pinned chrome on a phone is the tab bar plus one toolbar row and nothing else.
  const toolsEl = $('ledger-tools');
  const sentinel = $('tools-sentinel');
  const tabsBar = document.getElementById('tablist');
  let toolsIO = null;
  function observeTools() {
    if (!toolsEl || !sentinel || !('IntersectionObserver' in window)) return;
    if (toolsIO) toolsIO.disconnect();
    const tabsH = tabsBar && getComputedStyle(tabsBar).display !== 'none' ? tabsBar.offsetHeight : 0;
    const top = Math.round(tabsH + (tabsH ? ctxStripH() : 0));
    toolsIO = new IntersectionObserver(([en]) => {
      const r = en.boundingClientRect;
      const pinned = r.width > 0 && !en.isIntersecting && r.top < top + 1;   // width 0: its panel is hidden
      toolsEl.classList.toggle('stuck', pinned);
      if (tabsBar) tabsBar.classList.toggle('lt-pinned', pinned);
    }, { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 });
    toolsIO.observe(sentinel);
  }
  window.setToolsH = setToolsH;
  function setToolsH() {
    if (toolsEl) document.documentElement.style.setProperty('--tools-h', toolsEl.offsetHeight + 'px');
    if (tabsBar) document.documentElement.style.setProperty('--tabs-h', tabsBar.offsetHeight + 'px');
  }
  if (tabsBar && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      const r = en.boundingClientRect;
      tabsBar.classList.toggle('stuck', r.height > 0 && r.top < 1 && en.intersectionRatio < 1);
    }, { rootMargin: '-1px 0px 0px 0px', threshold: [0, 1] }).observe(tabsBar);
  }
  setToolsH();
  observeTools();
  let thT = null;
  window.addEventListener('resize', () => { clearTimeout(thT); thT = setTimeout(() => { setToolsH(); observeTools(); }, 120); });

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
        <td class="cm-kw"><div class="kw-wrap" data-kw="${esc(kwPretty(c.kw))}"><span class="kw-list">${esc(kwPretty(c.kw))}</span> <button type="button" class="kw-more" aria-expanded="false" hidden></button></div></td>
        <td class="cm-n">${num(t.count)}</td>
        <td class="cm-v">${money(t.sum)}</td>
        <td class="cm-p">${share(t.sum, GRAND)}</td>
      </tr>`;
    };
    const other = catTotals.get(CAT_OTHER) || { sum: 0, count: 0 };
    let s2sum = 0, s2count = 0;
    catTotals.forEach((t) => { s2sum += t.s2sum || 0; s2count += t.s2count || 0; });
    host.innerHTML = `<div class="cm-wrap"><table class="cm-table">
      <caption class="sr-only">How every filed purpose is classified into a category on this page.</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">Decided by these words</th><th scope="col">Grants</th><th scope="col">Dollars</th><th scope="col">Share</th></tr></thead>
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
  // P4 (lc-08): each rule's keyword list shows two lines, then "+n words" -- measured on the real cell, so it
  // is right at every width; a click shows the whole rule (the table IS the classifier, nothing is hidden)
  function fitKw() {
    document.querySelectorAll('#cat-map .kw-wrap').forEach((w) => {
      if (!w.getClientRects().length) return;
      const list = w.querySelector('.kw-list'), btn = w.querySelector('.kw-more');
      const words = (w.dataset.kw || '').split(', ');
      if (!btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => { w.classList.toggle('open'); fitKw(); });
      }
      const lh = parseFloat(getComputedStyle(list).lineHeight) || 18;
      const fits = () => w.offsetHeight <= 2 * lh + 2;
      list.textContent = words.join(', '); btn.hidden = true;
      if (w.classList.contains('open')) {
        btn.hidden = false; btn.textContent = 'Show fewer'; btn.setAttribute('aria-expanded', 'true');
        return;
      }
      btn.setAttribute('aria-expanded', 'false');
      if (fits()) return;
      btn.hidden = false;
      let lo = 1, hi = words.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        list.textContent = words.slice(0, mid).join(', ') + ',';
        btn.textContent = `+${words.length - mid} words`;
        if (fits()) lo = mid; else hi = mid - 1;
      }
      list.textContent = words.slice(0, lo).join(', ') + ',';
      btn.textContent = `+${words.length - lo} ${words.length - lo === 1 ? 'word' : 'words'}`;
    });
  }
  { let kT = 0; window.addEventListener('resize', () => { clearTimeout(kT); kT = setTimeout(fitKw, 150); }); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitKw);

  // L-14: a scannable methodology -- a sticky contents strip over whatever sections
  // this book actually has (a fiscal-note book gets one more than a plain one), with
  // the current section highlighted as the reader scrolls.
  function renderMethTOC() {
    const panel = document.getElementById('panel-methodology');
    const toc = document.getElementById('meth-toc');
    if (!panel || !toc) return;
    const heads = [...panel.querySelectorAll('h2[id], h3[id]')];
    if (!heads.length) return;
    // R3 (NEW-3): the strip carries short labels (the full heading rides in the title), so it fits one
    // row on a desktop instead of hiding "Limitations" past the card's edge
    const SHORT = { 'm-referee': 'Referee', 'm-source': 'Source', 'm-bridge': 'Bridging', 'm-canon': 'Name merges', 'm-purpose': 'Purpose map', 'm-limits': 'Limitations' };
    const shortOf = (h) => SHORT[h.id] || (h.id === 'm-scans' ? (/reconcil/i.test(h.textContent) ? 'Filed total' : 'Read from paper') : h.textContent.trim().split(/\s+/).slice(0, 2).join(' '));
    toc.innerHTML = heads.map((h, i) => `<a href="#tab=methodology" data-target="${h.id}" title="${esc(h.textContent.trim())}"${i === 0 ? ' class="cur"' : ''}>${esc(shortOf(h))}</a>`).join('');
    const tocCue = () => toc.classList.toggle('more-r', toc.scrollLeft + toc.clientWidth < toc.scrollWidth - 2);
    toc.addEventListener('scroll', tocCue, { passive: true });
    window.addEventListener('resize', tocCue);
    document.querySelectorAll('[data-tab="methodology"], #tab-methodology').forEach((b) => b.addEventListener('click', () => requestAnimationFrame(tocCue)));
    requestAnimationFrame(tocCue);
    toc.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-target]');
      if (!a) return;
      e.preventDefault();
      const target = document.getElementById(a.dataset.target);
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (toc.offsetHeight + 12), behavior: reducedMotion() ? 'instant' : 'smooth' });
    });
    // P4: the current section is the last heading above a reading line just under the strip; at the end of
    // the page the last section is current even if its heading never reaches that line ("Limitations" sits in
    // the final screen and was never marked)
    let spyRaf = 0;
    const spy = () => {
      spyRaf = 0;
      if (panel.hidden || !toc.getClientRects().length) return;
      const line = toc.getBoundingClientRect().bottom + Math.min(160, innerHeight * 0.22);
      let cur = heads[0];
      heads.forEach((h) => { if (h.getBoundingClientRect().top <= line) cur = h; });
      const se = document.scrollingElement || document.documentElement;
      const last = heads[heads.length - 1];
      if (se.scrollTop + innerHeight >= se.scrollHeight - 4 && last.getBoundingClientRect().top < innerHeight) cur = last;
      toc.querySelectorAll('a').forEach((a) => a.classList.toggle('cur', a.dataset.target === cur.id));
    };
    window.addEventListener('scroll', () => { if (!spyRaf) spyRaf = requestAnimationFrame(spy); }, { passive: true });
    window.addEventListener('resize', () => { if (!spyRaf) spyRaf = requestAnimationFrame(spy); });
    document.querySelectorAll('[data-tab="methodology"], #tab-methodology').forEach((b) => b.addEventListener('click', () => requestAnimationFrame(spy)));
  }
  renderMethTOC();

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

  // ---------- one hover bus: years and recipients light up wherever they appear (L-06) ----------
  (function () {
    function delegateHover(attr, cls) {
      const on = (e) => {
        const el = e.target.closest ? e.target.closest(`[${attr}]`) : null;
        if (!el) return;
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;   // still inside -- ignore inner churn
        const v = el.getAttribute(attr);
        if (!v) return;
        document.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`).forEach((n) => n.classList.add(cls));
      };
      const off = (e) => {
        const el = e.target.closest ? e.target.closest(`[${attr}]`) : null;
        if (!el) return;
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        const v = el.getAttribute(attr);
        if (!v) return;
        document.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`).forEach((n) => n.classList.remove(cls));
      };
      // R2 (R-9): a finger is not a hover. A tap's compatibility mouseover used to leave the
      // tapped year lit everywhere with nothing to clear it; pointer events carry the device,
      // and focus lights the bus only when it is keyboard focus (:focus-visible).
      if ('PointerEvent' in window) {
        document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') on(e); });
        document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse') off(e); });
      } else {
        document.addEventListener('mouseover', on);
        document.addEventListener('mouseout', off);
      }
      document.addEventListener('focusin', (e) => {
        let kbd = true;
        try { kbd = e.target.matches(':focus-visible'); } catch (x) {}
        if (kbd) on(e);
      });
      document.addEventListener('focusout', off);
    }
    if (window.CSS && CSS.escape) { delegateHover('data-y', 'hot-y'); delegateHover('data-ent', 'hot-e'); }
  })();

  // ---------- shared header: save to shortlist, the way back, the full note (L-01/L-02/L-12) ----------
  (function () {
    const PKEY = 'gl_projects';
    const todayISO = () => new Date().toISOString().slice(0, 10);
    function readStore() { try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } }
    function writeStore(s) { try { localStorage.setItem(PKEY, JSON.stringify(s)); } catch (e) {} }
    function activeProject(s) {
      const list = Array.isArray(s.list) ? s.list : [];
      return list.find((p) => p.id === s.active) || list[0] || null;
    }
    function blankProject(nm) {
      return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: nm || 'First project', created: todayISO(), updated: todayISO(), funders: [], notes: {}, evidence: {}, brief: '' };
    }
    const SLUG = document.documentElement.dataset.slug || '';

    function toast(text, linkHref, linkText) {
      let el = document.querySelector('.gl-toast');
      if (!el) { el = document.createElement('div'); el.className = 'gl-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
      el.textContent = text;
      if (linkHref) { const a = document.createElement('a'); a.href = linkHref; a.textContent = linkText || 'Open →'; el.appendChild(a); }
      requestAnimationFrame(() => el.classList.add('show'));
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 4200);
    }

    function syncShortlistCount() {
      const p = activeProject(readStore());
      const n = p && Array.isArray(p.funders) ? p.funders.length : 0;
      document.querySelectorAll('[data-shortlist-count]').forEach((el) => { el.textContent = n; el.hidden = n === 0; });
      return n;
    }

    const saveBtn = $('save-btn');
    if (saveBtn && SLUG) {
      const setPressed = (on) => {
        saveBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const label = saveBtn.querySelector('span');
        if (label) {
          label.className = 'sv';
          label.innerHTML = on ? 'Saved<span class="sv-x"> · in shortlist</span>' : 'Save<span class="sv-x"> to shortlist</span>';
        }
      };
      const initP = activeProject(readStore());
      setPressed(!!(initP && Array.isArray(initP.funders) && initP.funders.includes(SLUG)));
      saveBtn.addEventListener('click', () => {
        const s = readStore();
        if (!Array.isArray(s.list) || !s.list.length) { s.v = 1; const p0 = blankProject('First project'); s.list = [p0]; s.active = p0.id; }
        let p = activeProject(s);
        if (!p) { p = blankProject('First project'); s.list.push(p); s.active = p.id; }
        if (!Array.isArray(p.funders)) p.funders = [];
        if (!p.evidence) p.evidence = {};
        const on = p.funders.includes(SLUG);
        // a plain "Save to shortlist" carries no query scope -- no evidence record is
        // written, so the hub's own "no saved matching selection" copy (whole ledger,
        // saved from its page) renders for it, exactly as for any foundation-wide save.
        if (on) { p.funders = p.funders.filter((u) => u !== SLUG); delete p.evidence[SLUG]; }
        else p.funders.push(SLUG);
        if (p.via) delete p.via[SLUG];   // a save made here is 'saved from its page', never the hub's earlier one
        p.updated = todayISO();
        writeStore(s);
        setPressed(!on);
        const n = syncShortlistCount();
        if (!on) toast(`Saved · ${n} in shortlist · `, 'https://jcurry44.github.io/grants-ledgers/#view=shortlist', 'Open shortlist →');
      });
    }
    syncShortlistCount();

    // the header's "Find funders" reads "← Back to results" when the hub sent us here
    const findLink = $('gl-find');
    if (findLink) {
      try {
        if (document.referrer && /^https:\/\/jcurry44\.github\.io\/grants-ledgers\/(?:$|[?#])/.test(document.referrer) && history.length > 1) {
          findLink.textContent = '← Back to results';
          findLink.removeAttribute('href');
          findLink.tabIndex = 0;
          const back = (e) => { e.preventDefault(); history.back(); };
          findLink.addEventListener('click', back);
          findLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') back(e); });
        }
      } catch (e) {}
    }

    // R2.2 (m-1): the long search placeholder ("Search recipient, purpose, or place…") only where the box
    // can show all of it -- it was clipping to "…or pla" beside the full desktop row -- else "Search grants…".
    // Measured against the box's real width and font, re-measured whenever the toolbar changes width.
    const qIn = $('q');
    const fullPh = qIn ? (qIn.getAttribute('placeholder') || '') : '';
    let phCtx = null;
    const fitPh = () => {
      if (!qIn || !/purpose/.test(fullPh) || !qIn.clientWidth) return;
      let fits = false;
      try {
        const cs = getComputedStyle(qIn);
        phCtx = phCtx || document.createElement('canvas').getContext('2d');
        phCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        fits = phCtx.measureText(fullPh).width <= qIn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      } catch (e) {}
      qIn.setAttribute('placeholder', fits ? fullPh : 'Search grants…');
    };

    // Where the grants controls live. A closed <details> never paints its content (Chromium's
    // ::details-content), so they are MOVED between the row and the "More" menu, never display:contents'd.
    //  <1100px: search + More on one pinned row, everything else in the menu (R2, R-4).
    //  >=1100px: every control on the row -- except where that row would wrap (1100-~1356px beside the
    //  sidebar: the two most common laptop widths). There Compact / Export CSV / Print report / Copy link
    //  fold into More and search + both filters stay on the row: one 63px row at every desktop width
    //  (R2.2, M-4). Measured on the real row, so fonts, zoom and text size are accounted for.
    const ltMore = document.querySelector('.lt-more');
    const ltMenu = ltMore && ltMore.querySelector('.lt-menu');
    if (ltMore && ltMenu && window.matchMedia) {
      const wideTools = matchMedia('(min-width: 1100px)');
      const ltRow = ltMore.parentNode;
      const ltKids = [...ltMenu.children];
      const ltActs = ltKids.filter((k) => k.classList.contains('lt-btn'));
      const rowWraps = () => {
        const ks = [...ltRow.children].filter((k) => k.getClientRects().length && getComputedStyle(k).position !== 'absolute');
        if (ks.length < 2) return false;
        const mid = (k) => { const b = k.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
        const m0 = mid(ks[0]);
        return ks.some((k) => Math.abs(mid(k) - m0) > 8);
      };
      let ltW = -1;
      const placeTools = () => {
        ltMore.classList.remove('lt-fold');
        if (!wideTools.matches) {
          ltKids.forEach((k) => ltMenu.appendChild(k));
          ltMore.hidden = false;
        } else {
          ltKids.forEach((k) => ltRow.insertBefore(k, ltMore));
          ltMore.hidden = true;
          if (ltRow.offsetWidth && rowWraps()) {
            ltActs.forEach((k) => ltMenu.appendChild(k));
            ltMore.hidden = false;
            ltMore.classList.add('lt-fold');
            if (rowWraps()) ltKids.forEach((k) => ltMenu.appendChild(k));   // zoomed / huge text: the one-row phone layout
          }
          if (ltMore.hidden) ltMore.open = false;
        }
        ltW = ltRow.offsetWidth;
        fitPh();
        if (typeof setToolsH === 'function') setToolsH();
      };
      placeTools();
      if (wideTools.addEventListener) wideTools.addEventListener('change', placeTools); else if (wideTools.addListener) wideTools.addListener(placeTools);
      // re-place when the row's width changes -- a resize, or the Grants panel being shown (0 -> its width).
      // Watched on the zero-height sentinel above the toolbar (same width, and a height that moving the
      // controls can never change): watching the row itself re-sized it inside its own callback, which the
      // browser reports as a "ResizeObserver loop" error.
      const ltWatch = $('tools-sentinel') || ltRow;
      if ('ResizeObserver' in window) new ResizeObserver(() => { if (ltRow.offsetWidth !== ltW) placeTools(); }).observe(ltWatch);
      else window.addEventListener('resize', placeTools);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeTools);
      // the menu closes on an outside tap or click, or Escape (focus back on its summary)
      document.addEventListener('click', (e) => { if (ltMore.open && !ltMore.hidden && !ltMore.contains(e.target)) ltMore.open = false; });
      ltMore.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ltMore.open) { ltMore.open = false; const sm = ltMore.querySelector('summary'); if (sm) sm.focus(); }
      });
    } else fitPh();

    // compact row density, remembered across visits (L-09)
    const densityBtn = $('density');
    if (densityBtn) {
      const apply = (on) => {
        if (on) document.body.setAttribute('data-density', 'compact');
        else document.body.removeAttribute('data-density');
        densityBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      let saved = false;
      try { saved = localStorage.getItem('gl-density') === 'compact'; } catch (e) {}
      apply(saved);
      densityBtn.addEventListener('click', () => {
        const on = document.body.dataset.density !== 'compact';
        apply(on);
        try { localStorage.setItem('gl-density', on ? 'compact' : 'comfortable'); } catch (e) {}
      });
    }

    // "Read the full note" expands the clamped mobile lede (L-12)
    const moreBtn = $('hero-more'), ledeP = $('lede-p');
    if (moreBtn && ledeP) {
      moreBtn.addEventListener('click', () => {
        const open = ledeP.classList.toggle('open');
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        moreBtn.textContent = open ? 'Show less' : 'Read the full note';
      });
      // Close-out (5): below 900px the lede is measured, not clamped blind. Four lines or fewer show whole and the
      // button goes (it would cost about as much as the line it hides); a longer lede is cut after three lines with
      // its last line fading out -- the browser's clamp ellipsis landed after a full stop ("filings.…") or mid-word.
      const fitLede = () => {
        ledeP.classList.remove('cut', 'whole');
        if (!window.matchMedia('(max-width: 899px)').matches) { moreBtn.hidden = false; return; }
        ledeP.classList.add('measure');
        const lh = parseFloat(getComputedStyle(ledeP).lineHeight) || 16;
        const lines = Math.round(ledeP.getBoundingClientRect().height / lh);
        ledeP.classList.remove('measure');
        const whole = lines <= 4;
        ledeP.classList.add(whole ? 'whole' : 'cut');
        moreBtn.hidden = whole;
        if (whole && ledeP.classList.contains('open')) { ledeP.classList.remove('open'); moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.textContent = 'Read the full note'; }
      };
      fitLede();
      let fitRaf = 0, fitW = window.innerWidth;
      window.addEventListener('resize', () => { if (window.innerWidth === fitW) return; fitW = window.innerWidth; cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitLede); });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLede);
    }
  })();

  // P4 (M1): the phone sizing reads the figure's character count; a page built before the stamp gets it here
  { const gv = document.querySelector('.grand .g-val'); if (gv && !gv.style.getPropertyValue('--n')) gv.style.setProperty('--n', String(gv.textContent.trim().length)); }

  // init
  readHash();
  syncControls();
  setTab(state.tab, false);
  if (state.pr !== null) openProfile(state.pr, true);
  if (rowsPending) loadRows(); else verifyRows();
  // L-11: a deep link that already scopes the page (a tab, a recipient, a search) has
  // nothing for a phone to gain by opening on the cover -- start at the tab bar instead.
  if ((state.tab !== 'overview' || state.r !== null || state.q) && window.innerWidth < 1100) {
    const tabsEl = $('tablist');
    if (tabsEl) window.scrollTo({ top: tabsEl.offsetTop, behavior: 'instant' });
  }
})();