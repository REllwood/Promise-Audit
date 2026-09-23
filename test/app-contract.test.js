import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('trace and threshold edits revoke stale report export authority', () => {
  assert.match(appSource, /function discardReport\(/);
  assert.match(
    appSource,
    /elements\.source\.addEventListener\('input',[\s\S]*?discardReport\(/
  );
  assert.match(
    appSource,
    /elements\.threshold\.addEventListener\('input',[\s\S]*?discardReport\(/
  );
  assert.match(appSource, /currentAnalysis = null/);
  assert.match(appSource, /elements\.report\.hidden = true/);
  assert.match(appSource, /revision !== inputRevision/);
  assert.match(appSource, /if \(!currentAnalysis\)/);
});

test('controlled fixture cancellation is handled inside detached factories', () => {
  assert.match(appSource, /async function waitForControlledFixture\(/);
  assert.match(appSource, /if \(error\.name === 'AbortError'\) return false/);
  assert.match(
    appSource,
    /Development metrics flush'[\s\S]*?waitForControlledFixture\(1_000/
  );
  assert.match(
    appSource,
    /Read optional sidecar'[\s\S]*?if \(completed\) throw new Error/
  );
});
