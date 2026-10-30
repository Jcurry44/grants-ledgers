// Run with: node --test tests/metrics.test.cjs
// The deployed app is inline JavaScript: execute the actual pure helpers, then
// check their output against the published row data and coverage classifications.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'hub.html'), 'utf8');
const json = name => JSON.parse(fs.readFileSync(path.join(root, 'db', name), 'utf8'));
const registry = json('registry.json');
const coverage = json('coverage.json');
const fleet = registry.fleet;
function functionSource(name) {
  const match = source.match(new RegExp('^  function ' + name + '\\([^\\n]*\\}\\r?$', 'm'))
    || source.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, 'Cannot find production helper ' + name);
  return match[0];
}
const ctx = { F: fleet, COVERAGE: coverage, NOTES: {}, observedBehaviour: () => null,
  URL, PROJ: () => ({ checks: {} }) };
vm.createContext(ctx);
vm.runInContext(['cleanChecks', 'checkStatus', 'researchCheck', 'namedGrantStats', 'namedGrantCoverage', 'funderRow', 'sortQueryRows'].map(functionSource).join('\n'), ctx);
const funder = slug => fleet.find(f => f.u === slug);
const stats = slug => ctx.namedGrantStats(funder(slug), coverage);

test('Genentech retains its filed total without inventing an average grant', () => {
  const f = funder('genentechpat');
  assert.equal(f.t, 16211290850);
  assert.equal(f.g, 5);
  const s = stats(f.u);
  assert.equal(s.n, 0);
  assert.equal(s.average, null);
  assert.equal(s.unitemized, 5);
  assert.equal(ctx.namedGrantCoverage(s), 'No itemized named-recipient grants');
  const exported = ctx.funderRow(f, { n: f.g });
  assert.equal(exported.average, '');
  assert.equal(exported.named_n, 0);
  assert.equal(exported.total, f.t);
  assert.equal(exported.n, 5);
});

for (const slug of ['johnahartfor', 'opensocietyi', 'enterpriseho', 'roundhousefo']) {
  test(slug + ': mean agrees with named source rows; disclosures and masked individuals stay excluded', () => {
    const rows = json('fnd/' + slug + '.json');
    const named = rows.filter(g => g[6] === 'named_recipient' && g[1]);
    const s = stats(slug);
    assert.equal(s.n, named.length);
    assert.equal(s.total, named.reduce((sum, g) => sum + g[2], 0));
    assert.equal(s.average, s.total / named.length);
    const exported = ctx.funderRow(funder(slug));
    assert.equal(exported.average, s.average);
    assert.equal(exported.named_n, s.n);
    assert.equal(exported.named_total, s.total);
  });
}

test('all foundation classifications reconcile before a mean is shown', () => {
  let count = 0, dollars = 0;
  for (const f of fleet) {
    const s = ctx.namedGrantStats(f, coverage);
    assert.ok(s, f.u + ' has inconsistent coverage');
    count += s.n;
    dollars += s.total;
  }
  assert.equal(count, coverage.totals.named_rows);
  assert.equal(dollars, coverage.totals.named_dollars);
});

test('missing or inconsistent metadata produces unavailable, never a fabricated zero', () => {
  const f = funder('genentechpat');
  assert.equal(ctx.namedGrantStats(f, null), null);
  const invalid = { funders: { [f.u]: { ...coverage.funders[f.u], named_rows: 1 } } };
  assert.equal(ctx.namedGrantStats(f, invalid), null);
  const stale = { funders: { [f.u]: { ...coverage.funders[f.u], dollars: f.t + 1 } } };
  assert.equal(ctx.namedGrantStats(f, stale), null);
});

test('average sort puts unavailable after zero and negative values', () => {
  ctx.$ = () => ({ value: 'median' });
  ctx.qState = { rows: [[0, 1, 200, null], [1, 1, 100, -10], [2, 1, 300, 0], [3, 1, 400, 25]] };
  ctx.sortQueryRows();
  assert.deepEqual(Array.from(ctx.qState.rows, row => row[0]), [3, 2, 1, 0]);
});

test('filtered evidence rejects unitemized rows, blank names and masked recipients', () => {
  const placeholder = source.match(/  const queryPlaceholder = [^\n]+/)[0];
  const named = source.match(/  function namedRecipient\(name\) \{[^\n]+/)[0];
  vm.runInContext(placeholder + '\n' + named + '\n' + functionSource('queryEvidenceRows'), ctx);
  const rows = [
    [2024, 'E123', 100, 0, 1, 'Named nonprofit', 'named_recipient'],
    [2024, '', 9000000, 0, 1, 'Various recipients', 'unitemized'],
    [2024, '', 200, 0, 1, '[INDIVIDUAL RECIPIENT - WITHHELD FROM INDEX]', 'named_recipient'],
    [2024, '', 100, 0, 1, '', 'named_recipient'],
    [2024, '', 900, 0, 1, 'Any unforeseen placeholder', 'unitemized'],
  ];
  const matches = ctx.queryEvidenceRows(rows, { cat: 'all', st: 'all', min: 0, yr: 0 });
  assert.deepEqual(Array.from(matches, row => row.index), [0]);
});
