import { PromiseAudit, analyseTrace, exportTraceReport } from '../src/audit.js';

const audit = new PromiseAudit({ maxEvents: 200 });
audit.startCapture('Synthetic Node.js example');
const markerId = audit.marker('Begin synthetic work');

const first = audit.track(
  'Resolve synthetic item',
  () => Promise.resolve('this value is intentionally not recorded'),
  { source: 'fixtures/instrumented-example.mjs:8', markerId, serialGroup: 'example-loop' }
);
await first;

const second = audit.track(
  'Resolve second synthetic item',
  () => Promise.resolve({ another: 'unrecorded value' }),
  { source: 'fixtures/instrumented-example.mjs:15', markerId, parentId: first.auditId, serialGroup: 'example-loop' }
);
await second;

const trace = audit.stopCapture();
const report = analyseTrace(trace, { longPendingMs: 1_000 });
process.stdout.write(`${exportTraceReport(report, 'json')}\n`);
