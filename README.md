<div align="center">

# Promise Audit

**Trace the promises your JavaScript application started, abandoned and waited on in the wrong order.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

A promise nobody awaited, a loop that fetched ten things one after another, a job that never settled. None of these throw an error, so they're easy to miss. Promise Audit wraps the async work you label, records when each piece started, what it waited on and when it settled, and flags the patterns that look wrong.

## What it does

- Wraps labelled async work and records creation, settlement, parents and serial groups
- Never records arguments or resolved values
- Flags promises left pending too long and work that ran in sequence
- Lets unhandled rejections reach the runtime's own handler as normal
- Comes with a browser viewer and a command-line report
- Exports value-free JSON or a self-contained HTML report

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/Promise-Audit.git
cd Promise-Audit
npm start
```

Open http://127.0.0.1:4183 and press **Run synthetic development capture**, or **Load trace fixture** to open a saved trace.

## Usage

```js
import { PromiseAudit, analyseTrace } from './src/audit.js';

const audit = new PromiseAudit();
audit.startCapture('Image queue');

await audit.track('Resize first image', () => resize(first), { serialGroup: 'queue' });
await audit.track('Resize second image', () => resize(second), { serialGroup: 'queue' });

const report = analyseTrace(audit.stopCapture(), { longPendingMs: 1_000 });
```

From the command line:

```sh
node fixtures/instrumented-example.mjs        # run a small instrumented example
node src/cli.js fixtures/sample-trace.json    # summarise a saved trace
```

## Status

v0.1 only sees promises you pass through its API. It doesn't hook every promise in the runtime. Next up are OpenTelemetry correlation, Deno and Bun support, and a flame-style view of async waits.

## Development

```sh
npm test        # instrumentation tests
npm run check   # tests plus syntax checks
```

## License

[MIT](LICENSE)
