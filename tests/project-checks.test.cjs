// Run with: node --test tests/*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'hub.html'), 'utf8');
const fleet = JSON.parse(fs.readFileSync(path.join(root, 'db/registry.json'), 'utf8')).fleet;
const coverage = JSON.parse(fs.readFileSync(path.join(root, 'db/coverage.json'), 'utf8'));
const slug = 'johnahartfor';
const toPlain = value => JSON.parse(JSON.stringify(value));
function functionSource(name) {
  const match = source.match(new RegExp('^  function ' + name + '\\([^\\n]*\\}\\r?$', 'm'))
    || source.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, 'Cannot find production helper ' + name);
  return match[0];
}
function harness() {
  let nextId = 0;
  const ctx = {
    URL, F: fleet, COVERAGE: coverage, NOTES: {}, PKEY: 'gl_projects',
    todayISO: () => '2026-10-30', uid: () => 'test-' + ++nextId,
    observedBehaviour: () => null, renderList() {}, syncAddButtons() {},
    money: amount => '$' + amount.toLocaleString('en-US'),
    localStorage: { getItem: () => null },
  };
  ctx.flash = (text, bad) => { ctx.notice = { text, bad }; };
  ctx.loadProject = id => { ctx.STORE.active = id; };
  ctx.PROJ = () => ctx.STORE.list.find(p => p.id === ctx.STORE.active);
  vm.createContext(ctx);
  const blank = source.match(/  const blankProject = [^\n]+/)[0];
  const cleanVia = source.match(/  const cleanVia = [^\n]+/)[0];
  const columns = source.match(/  const FCOLS = \[[^]*?\n  \];/)[0];
  const imports = source.match(/      rd\.onload = \(\) => \{[^]*?\n      };/)[0];
  vm.runInContext(blank + '\n' + cleanVia + '\n' + columns + '\n'
    + ['cleanChecks', 'checkStatus', 'researchCheck', 'projectFile', 'cleanEvidence', 'readStore',
      'namedGrantStats', 'namedGrantCoverage', 'funderRow', 'csv'].map(functionSource).join('\n'), ctx);
  vm.runInContext('globalThis.makeProject = blankProject; globalThis.exportColumns = FCOLS;', ctx);
  const first = ctx.makeProject('First project');
  ctx.STORE = { v: 1, active: first.id, list: [first] };
  ctx.importProject = payload => {
    ctx.rd = { result: typeof payload === 'string' ? payload : JSON.stringify(payload) };
    vm.runInContext(imports + '\nrd.onload();', ctx);
  };
  return ctx;
}
const validCheck = () => ({ status: 'open', source: 'https://example.org/grants?program=health',
  checked: '2026-10-30', next: 'Confirm the geographic restriction, then send an inquiry.' });

test('checks accept web sources, reject executable URLs and embedded credentials', () => {
  const ctx = harness();
  for (const source of ['https://example.org/grants', 'http://example.org/grants']) {
    const result = ctx.cleanChecks({ [slug]: { ...validCheck(), source } }, [slug]);
    assert.equal(result[slug].source, source);
  }
  for (const source of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/file',
    'https://user:password@example.org', '//example.org/grants', '/grants', 'not a URL']) {
    const result = ctx.cleanChecks({ [slug]: { ...validCheck(), source } }, [slug]);
    assert.equal(result[slug].source, '', source);
    assert.equal(result[slug].next, validCheck().next);
  }
});

test('checks reject invalid dates, normalize unknown statuses and bound notes', () => {
  const ctx = harness();
  for (const checked of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', 'tomorrow']) {
    assert.equal(ctx.cleanChecks({ [slug]: { ...validCheck(), checked } }, [slug])[slug].checked, '');
  }
  assert.equal(ctx.cleanChecks({ [slug]: { ...validCheck(), checked: '2024-02-29' } }, [slug])[slug].checked, '2024-02-29');
  const result = ctx.cleanChecks({ [slug]: { status: 'guaranteed', next: 'x'.repeat(2200) } }, [slug])[slug];
  assert.equal(result.status, 'unknown');
  assert.equal(result.next.length, 2000);
  assert.equal(ctx.checkStatus(result), 'Not checked');
});

test('checks retain only selected own funder properties', () => {
  const ctx = harness();
  const result = ctx.cleanChecks({ [slug]: validCheck(), notInProject: validCheck() }, [slug]);
  assert.deepEqual(Object.keys(result), [slug]);
  const inherited = Object.create({ [slug]: validCheck() });
  assert.deepEqual(Object.keys(ctx.cleanChecks(inherited, [slug])), []);
  assert.deepEqual(Object.keys(ctx.cleanChecks(null, [slug])), []);
});

test('project backup and actual import handler preserve checks and drop nonexistent funders', () => {
  const ctx = harness();
  const p = ctx.makeProject('Health research');
  p.funders = [slug, 'not-a-published-funder'];
  p.checks = { [slug]: validCheck(), 'not-a-published-funder': validCheck() };
  p.notes = { [slug]: 'Strong historical match.' };
  p.brief = 'Compare health funders.';
  const backup = JSON.parse(ctx.projectFile(p));
  assert.equal(backup.format, 'grants-ledger-project');
  assert.deepEqual(backup.project.checks[slug], validCheck());
  ctx.importProject(backup);
  const restored = ctx.PROJ();
  assert.equal(restored.name, 'Health research');
  assert.deepEqual(Array.from(restored.funders), [slug]);
  assert.deepEqual(toPlain(restored.checks), { [slug]: validCheck() });
  assert.equal(restored.notes[slug], p.notes[slug]);
  assert.equal(restored.brief, p.brief);
  assert.match(ctx.notice.text, /1 name not in this collection left out/);
});

test('older project files without checks remain importable and read as not checked', () => {
  const ctx = harness();
  ctx.importProject({ format: 'grants-ledger-project', v: 1,
    project: { name: 'Legacy project', funders: [slug], notes: { [slug]: 'Existing note.' } } });
  assert.deepEqual(toPlain(ctx.PROJ().checks), {});
  assert.equal(ctx.PROJ().notes[slug], 'Existing note.');
  assert.equal(ctx.checkStatus(ctx.researchCheck(slug)), 'Not checked');
  const saved = { v: 1, active: 'older', list: [{ id: 'older', name: 'Legacy saved project', funders: [slug], notes: {} }] };
  ctx.localStorage.getItem = key => key === 'gl_projects' ? JSON.stringify(saved) : null;
  const read = ctx.readStore();
  assert.deepEqual(toPlain(read.list[0].checks), {});
  assert.equal(read.active, 'older');
});

test('invalid project import leaves existing work untouched', () => {
  const ctx = harness();
  const before = JSON.stringify(ctx.STORE);
  ctx.importProject('not JSON');
  assert.equal(JSON.stringify(ctx.STORE), before);
  assert.equal(ctx.notice.bad, true);
});

test('status labels and CSV exports preserve researcher assessment, source, date and next step', () => {
  const ctx = harness();
  ctx.PROJ().funders = [slug];
  ctx.PROJ().checks = { [slug]: validCheck() };
  const labels = { unknown: 'Not checked', open: 'Accepting inquiries / applications',
    invitation: 'Invitation only', closed: 'Closed', unclear: 'Needs clarification' };
  for (const [status, label] of Object.entries(labels)) assert.equal(ctx.checkStatus({ status }), label);
  const row = ctx.funderRow(fleet.find(f => f.u === slug));
  assert.equal(row.application_status, labels.open);
  assert.equal(row.guidance_source, validCheck().source);
  assert.equal(row.checked_date, validCheck().checked);
  assert.equal(row.next_step, validCheck().next);
  const csv = ctx.csv(ctx.exportColumns, [row], false);
  assert.match(csv, /Application status \(researcher assessment\)/);
  for (const value of [labels.open, validCheck().source, validCheck().checked, validCheck().next]) {
    assert.ok(csv.includes('"' + value + '"'), value + ' missing from CSV');
  }
});
