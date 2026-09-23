import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PromiseAudit, analyseTrace, exportTraceReport, validateTrace } from '../src/audit.js';

test('wrapper records fulfilled lifecycle and explicit parentage without settled values', async () => {
  let time = 0;
  const audit = new PromiseAudit({ clock: () => time, wallClock: () => '2026-07-24T00:00:00Z' });
  audit.startCapture('Fixture');
  const markerId = audit.marker('Start work');
  const parent = audit.track('Parent', () => {
    time = 10;
    return Promise.resolve({ secretValue: 'not recorded' });
  }, { source: '/workspace/src/fixture.js:1', markerId });
  await parent;
  time = 12;
  const child = audit.track('Child', () => {
    time = 20;
    return Promise.resolve('another value');
  }, { parentId: parent.auditId, markerId });
  await child;
  time = 25;
  const trace = audit.stopCapture();
  assert.equal(trace.operations[0].status, 'fulfilled');
  assert.equal(trace.operations[1].parentId, parent.auditId);
  assert.equal(JSON.stringify(trace).includes('secretValue'), false);
  assert.equal(JSON.stringify(trace).includes('another value'), false);
});

test('imported unobserved rejection evidence remains a conservative finding', () => {
  const analysis = analyseTrace(validateTrace({
    traceVersion: 1,
    instrumentationVersion: '0.1.0',
    adapter: 'fixture',
    runtime: 'Node.js fixture',
    label: 'Rejected fixture',
    startedAt: 0,
    endedAt: 10,
    durationMs: 10,
    status: 'complete',
    markers: [],
    operations: [{
      id: 'promise-1',
      label: 'Rejected operation',
      source: '/workspace/src/failure.js:4',
      startedAt: 0,
      settledAt: 5,
      status: 'rejected',
      rejectionObserved: false
    }]
  }), { longPendingMs: 100 });
  assert.equal(analysis.findings.unobservedRejections.length, 1);
  assert.match(analysis.findings.unobservedRejections[0].limitation, /does not prove/i);
});

test('ignored tracked rejection still reaches the native runtime event', () => {
  const moduleUrl = new URL('../src/audit.js', import.meta.url).href;
  const source = `
    import { PromiseAudit } from ${JSON.stringify(moduleUrl)};
    const audit = new PromiseAudit();
    audit.startCapture('native event fixture');
    process.once('unhandledRejection', () => {
      process.stdout.write('native-unhandled-observed');
      process.exit(0);
    });
    audit.track('ignored rejection', () => Promise.reject(new Error('fixture')));
    setTimeout(() => process.exit(2), 100);
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /native-unhandled-observed/);
});

test('awaiting rejected tracked work records wrapper rejection observation', async () => {
  let time = 0;
  const audit = new PromiseAudit({ clock: () => time });
  audit.startCapture('Observed rejection');
  const tracked = audit.track('Observed operation', () => {
    time = 5;
    return Promise.reject(new Error('not captured'));
  });
  await assert.rejects(async () => tracked);
  time = 10;
  const analysis = analyseTrace(audit.stopCapture());
  assert.equal(analysis.operations[0].rejectionObserved, true);
  assert.equal(analysis.findings.unobservedRejections.length, 0);
});

test('a rejection handler on a derived wrapper chain shares observation state', async () => {
  let time = 0;
  const audit = new PromiseAudit({ clock: () => time });
  audit.startCapture('Derived handler');
  const tracked = audit.track('Observed through chain', () => {
    time = 5;
    return Promise.reject(new Error('not captured'));
  });
  await tracked.then((value) => value).catch(() => 'handled');
  time = 10;
  const analysis = analyseTrace(audit.stopCapture());
  assert.equal(analysis.operations[0].rejectionObserved, true);
  assert.equal(analysis.findings.unobservedRejections.length, 0);
});

test('analysis reports pending duration and declared serial groups without causal certainty', async () => {
  let time = 0;
  const audit = new PromiseAudit({ clock: () => time });
  audit.startCapture('Serial fixture');
  const pending = audit.track('Pending background work', () => new Promise(() => {}), { detached: true, ignoredReason: 'Fixture background work' });
  assert.equal(pending.auditId, 'promise-1');
  const first = audit.track('First serial item', () => {
    time = 30;
    return Promise.resolve();
  }, { serialGroup: 'loop' });
  await first;
  time = 31;
  const second = audit.track('Second serial item', () => {
    time = 65;
    return Promise.resolve();
  }, { serialGroup: 'loop' });
  await second;
  time = 100;
  const analysis = analyseTrace(audit.stopCapture(), { longPendingMs: 50 });
  assert.ok(analysis.findings.longPending.some(({ operationIds }) => operationIds.includes('promise-1')));
  assert.equal(analysis.findings.serialObservations.length, 1);
  assert.match(analysis.findings.serialObservations[0].limitation, /do not prove/i);
});

test('buffer exhaustion labels the trace partial rather than hiding dropped events', async () => {
  let time = 0;
  const audit = new PromiseAudit({ clock: () => time, maxEvents: 10 });
  audit.startCapture('Bounded fixture');
  for (let index = 0; index < 20; index += 1) {
    time += 1;
    const operation = audit.track(`Operation ${index}`, Promise.resolve());
    await operation;
  }
  time += 1;
  const trace = audit.stopCapture();
  assert.equal(trace.status, 'partial');
  assert.ok(trace.droppedEvents > 0);
  assert.match(trace.partialReason, /buffer limit/i);
});

test('import rejects trace metadata overflow instead of silently truncating it', () => {
  const base = {
    traceVersion: 1,
    operations: [],
    markers: [],
    limitations: []
  };
  assert.throws(
    () => validateTrace({
      ...base,
      markers: Array.from({ length: 1_001 }, (_, index) => ({
        id: `marker-${index}`,
        name: 'Marker',
        at: index
      }))
    }),
    /at most 1,000/
  );
  assert.throws(
    () => validateTrace({ ...base, limitations: Array(21).fill('Limit') }),
    /at most 20/
  );
});

test('exports rewrite paths and explicitly declare that values were not captured', () => {
  const trace = validateTrace({
    traceVersion: 1,
    instrumentationVersion: '0.1.0',
    adapter: 'fixture',
    runtime: 'Node.js fixture',
    label: '<script>fixture</script>',
    startedAt: 0,
    endedAt: 100,
    durationMs: 100,
    status: 'complete',
    droppedEvents: 0,
    markers: [],
    operations: [{ id: 'p1', label: 'Work', source: '/workspace/src/a.js:4', startedAt: 0, settledAt: 10, status: 'fulfilled' }]
  });
  const analysis = analyseTrace(trace);
  const json = exportTraceReport(analysis, 'json', { workspaceRoot: '/workspace' });
  assert.match(json, /src\/a\.js:4/);
  assert.match(json, /\"valuesCaptured\": false/);
  const html = exportTraceReport(analysis, 'html');
  assert.doesNotMatch(html, /<script>fixture/);
  assert.match(html, /&lt;script&gt;/);
});
