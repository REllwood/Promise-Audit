#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { analyseTrace, exportTraceReport, validateTrace } from './audit.js';

async function standardInput() {
  let source = '';
  for await (const chunk of process.stdin) {
    source += chunk;
    if (source.length > 2_000_000) throw new RangeError('Trace input exceeds 2,000,000 characters.');
  }
  return source;
}

try {
  process.stderr.write('Loading: validating and analysing the supplied value-free trace locally.\n');
  const path = process.argv[2];
  const source = path ? await readFile(path, 'utf8') : await standardInput();
  const trace = validateTrace(JSON.parse(source));
  const analysis = analyseTrace(trace, { longPendingMs: Number(process.env.PROMISE_AUDIT_LONG_MS ?? 1000) });
  process.stdout.write(`${exportTraceReport(analysis, 'json', { workspaceRoot: process.cwd() })}\n`);
  process.stderr.write(`Trace analysis complete: ${analysis.operations.length} operations and ${analysis.coverage.droppedEvents} dropped events.\n`);
} catch (error) {
  process.stderr.write(`Promise Audit failed: ${error.message}\n`);
  process.exitCode = 1;
}
