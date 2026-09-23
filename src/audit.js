const TRACE_VERSION = 1;
const INSTRUMENTATION_VERSION = '0.1.0';
const MAX_IMPORTED_OPERATIONS = 5_000;

function boundedText(value, label, maximum = 300, required = false) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new TypeError(`${label} must be text.`);
  }
  if (value.length > maximum) throw new RangeError(`${label} exceeds ${maximum.toLocaleString('en-AU')} characters.`);
  if (required && !value.trim()) throw new RangeError(`${label} cannot be empty.`);
  return value.replace(/\0/gu, '\uFFFD');
}

function finiteTime(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number.`);
  return value;
}

function runtimeLabel() {
  if (globalThis.process?.versions?.node) return `Node.js ${globalThis.process.versions.node}`;
  return `Browser ${globalThis.navigator?.userAgent ?? 'unknown'}`.slice(0, 300);
}

function cloneOperation(operation) {
  return {
    id: operation.id,
    label: operation.label,
    source: operation.source,
    parentId: operation.parentId,
    markerId: operation.markerId,
    serialGroup: operation.serialGroup,
    detached: operation.detached,
    ignoredReason: operation.ignoredReason,
    creationKnown: operation.creationKnown,
    startedAt: operation.startedAt,
    settledAt: operation.settledAt,
    status: operation.status,
    rejectionObserved: operation.rejectionObserved,
    rejectionObservedAt: operation.rejectionObservedAt
  };
}

export class PromiseAudit {
  #active = false;
  #clock;
  #wallClock;
  #maxEvents;
  #operations = new Map();
  #markers = [];
  #events = [];
  #droppedEvents = 0;
  #nextOperation = 1;
  #nextMarker = 1;
  #capture = null;
  #lastMarkerId = '';

  constructor(options = {}) {
    this.#clock = typeof options.clock === 'function' ? options.clock : () => performance.now();
    this.#wallClock = typeof options.wallClock === 'function' ? options.wallClock : () => new Date().toISOString();
    this.#maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents >= 10 ? Math.min(options.maxEvents, 100_000) : 5_000;
  }

  get active() {
    return this.#active;
  }

  startCapture(label = 'Development interaction') {
    if (this.#active) throw new RangeError('A capture is already active.');
    this.#operations = new Map();
    this.#markers = [];
    this.#events = [];
    this.#droppedEvents = 0;
    this.#nextOperation = 1;
    this.#nextMarker = 1;
    this.#lastMarkerId = '';
    this.#capture = {
      traceVersion: TRACE_VERSION,
      instrumentationVersion: INSTRUMENTATION_VERSION,
      adapter: 'explicit PromiseAudit wrapper',
      runtime: runtimeLabel(),
      label: boundedText(label, 'Capture label', 160, true),
      startedAt: finiteTime(this.#clock(), 'Capture start'),
      startedWallTime: boundedText(this.#wallClock(), 'Capture wall time', 100, true)
    };
    this.#active = true;
    this.#recordEvent('capture-start', '');
    return this.#capture.startedAt;
  }

  marker(name) {
    this.#requireActive();
    const marker = {
      id: `marker-${this.#nextMarker++}`,
      name: boundedText(name, 'Marker name', 160, true),
      at: finiteTime(this.#clock(), 'Marker time')
    };
    this.#markers.push(marker);
    this.#lastMarkerId = marker.id;
    this.#recordEvent('marker', marker.id);
    return marker.id;
  }

  track(label, promiseOrFactory, options = {}) {
    this.#requireActive();
    const id = `promise-${this.#nextOperation++}`;
    const operation = {
      id,
      label: boundedText(label, 'Promise label', 160, true),
      source: boundedText(options.source ?? '', 'Promise source', 500),
      parentId: boundedText(options.parentId ?? '', 'Promise parent id', 100),
      markerId: boundedText(options.markerId ?? this.#lastMarkerId, 'Promise marker id', 100),
      serialGroup: boundedText(options.serialGroup ?? '', 'Promise serial group', 120),
      detached: options.detached === true,
      ignoredReason: options.detached === true ? boundedText(options.ignoredReason ?? 'Declared intentional background work', 'Detached reason', 300, true) : '',
      creationKnown: typeof promiseOrFactory === 'function',
      startedAt: finiteTime(this.#clock(), 'Promise start'),
      settledAt: null,
      status: 'pending',
      rejectionObserved: false,
      rejectionObservedAt: null
    };

    if (this.#operations.size >= this.#maxEvents) {
      this.#droppedEvents += 1;
      const fallback = typeof promiseOrFactory === 'function'
        ? Promise.resolve().then(promiseOrFactory)
        : Promise.resolve(promiseOrFactory);
      return this.#thenable(fallback, '');
    }

    this.#operations.set(id, operation);
    this.#recordEvent('created', id);
    let base;
    try {
      base = typeof promiseOrFactory === 'function'
        ? Promise.resolve().then(promiseOrFactory)
        : Promise.resolve(promiseOrFactory);
    } catch (error) {
      base = Promise.reject(error);
    }

    const publicPromise = base.then(
      (value) => value,
      (error) => {
        throw error;
      }
    );
    base.then(
      () => this.#settle(id, 'fulfilled'),
      () => {
        this.#settle(id, 'rejected');
        queueMicrotask(() => {
          const current = this.#operations.get(id);
          if (current && !current.rejectionObserved) this.#recordEvent('rejection-unobserved-at-checkpoint', id);
        });
      }
    );
    return this.#thenable(publicPromise, id);
  }

  annotate(operationId, options = {}) {
    this.#requireActive();
    const operation = this.#operations.get(operationId);
    if (!operation) throw new RangeError(`Unknown operation id: ${operationId}`);
    if (options.detached === true) {
      operation.detached = true;
      operation.ignoredReason = boundedText(options.ignoredReason ?? 'Declared intentional background work', 'Detached reason', 300, true);
    }
    this.#recordEvent('annotated', operationId);
  }

  stopCapture(options = {}) {
    this.#requireActive();
    const endedAt = finiteTime(this.#clock(), 'Capture end');
    this.#recordEvent('capture-stop', '');
    this.#active = false;
    return {
      ...this.#capture,
      endedAt,
      durationMs: Math.max(0, endedAt - this.#capture.startedAt),
      status: options.incomplete === true || this.#droppedEvents > 0 ? 'partial' : 'complete',
      partialReason: options.incomplete === true
        ? boundedText(options.reason ?? 'Capture stopped before the interaction completed.', 'Partial reason', 300, true)
        : this.#droppedEvents > 0 ? 'Trace buffer limit reached; some lifecycle events were dropped.' : '',
      droppedEvents: this.#droppedEvents,
      markers: this.#markers.map((marker) => ({ ...marker })),
      operations: [...this.#operations.values()].map(cloneOperation),
      lifecycleEvents: this.#events.map((event) => ({ ...event })),
      limitations: [
        'Only work passed through the explicit wrapper is instrumented.',
        'Parent identifiers and serial groups are declared evidence, not a perfect runtime causal graph.',
        'Unhandled findings mean rejection was not observed through this wrapper by the analysis checkpoint.'
      ]
    };
  }

  #requireActive() {
    if (!this.#active) throw new RangeError('Start a development capture before recording work.');
  }

  #settle(id, status) {
    const operation = this.#operations.get(id);
    if (!operation || operation.status !== 'pending') return;
    operation.status = status;
    operation.settledAt = finiteTime(this.#clock(), 'Promise settlement');
    this.#recordEvent(status, id);
  }

  #observeRejection(id) {
    if (!id) return;
    const operation = this.#operations.get(id);
    if (!operation || operation.rejectionObserved) return;
    operation.rejectionObserved = true;
    operation.rejectionObservedAt = finiteTime(this.#clock(), 'Rejection observation');
    this.#recordEvent('rejection-observed', id);
  }

  #thenable(base, id) {
    const audit = this;
    return {
      then(onFulfilled, onRejected) {
        if (typeof onRejected === 'function') audit.#observeRejection(id);
        const next = base.then(onFulfilled, onRejected);
        return audit.#thenable(next, id);
      },
      catch(onRejected) {
        audit.#observeRejection(id);
        const next = base.catch(onRejected);
        return audit.#thenable(next, id);
      },
      finally(onFinally) {
        const next = base.finally(onFinally);
        return audit.#thenable(next, id);
      },
      get auditId() {
        return id;
      },
      [Symbol.toStringTag]: 'Promise'
    };
  }

  #recordEvent(type, targetId) {
    if (this.#events.length >= this.#maxEvents) {
      this.#droppedEvents += 1;
      return;
    }
    this.#events.push({
      sequence: this.#events.length + 1,
      type,
      targetId,
      at: finiteTime(this.#clock(), 'Lifecycle event time')
    });
  }
}

function validateOperation(candidate, index) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError(`Trace operation ${index + 1} must be an object.`);
  const status = boundedText(candidate.status, `Trace operation ${index + 1} status`, 30, true);
  if (!['pending', 'fulfilled', 'rejected'].includes(status)) throw new RangeError(`Trace operation ${index + 1} has an unsupported status.`);
  return {
    id: boundedText(candidate.id, `Trace operation ${index + 1} id`, 100, true),
    label: boundedText(candidate.label, `Trace operation ${index + 1} label`, 160, true),
    source: boundedText(candidate.source ?? '', `Trace operation ${index + 1} source`, 500),
    parentId: boundedText(candidate.parentId ?? '', `Trace operation ${index + 1} parent id`, 100),
    markerId: boundedText(candidate.markerId ?? '', `Trace operation ${index + 1} marker id`, 100),
    serialGroup: boundedText(candidate.serialGroup ?? '', `Trace operation ${index + 1} serial group`, 120),
    detached: candidate.detached === true,
    ignoredReason: boundedText(candidate.ignoredReason ?? '', `Trace operation ${index + 1} ignored reason`, 300),
    creationKnown: candidate.creationKnown !== false,
    startedAt: finiteTime(candidate.startedAt, `Trace operation ${index + 1} start`),
    settledAt: candidate.settledAt == null ? null : finiteTime(candidate.settledAt, `Trace operation ${index + 1} settlement`),
    status,
    rejectionObserved: candidate.rejectionObserved === true,
    rejectionObservedAt: candidate.rejectionObservedAt == null ? null : finiteTime(candidate.rejectionObservedAt, `Trace operation ${index + 1} rejection observation`)
  };
}

export function validateTrace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A trace object is required.');
  if (value.traceVersion !== TRACE_VERSION) throw new RangeError('Only Promise Audit trace version 1 is supported.');
  if (!Array.isArray(value.operations) || value.operations.length > MAX_IMPORTED_OPERATIONS) throw new RangeError(`Trace operations must be an array of at most ${MAX_IMPORTED_OPERATIONS}.`);
  const operations = value.operations.map(validateOperation);
  const ids = new Set();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new RangeError(`Duplicate trace operation id: ${operation.id}`);
    ids.add(operation.id);
  }
  if (value.markers !== undefined && !Array.isArray(value.markers)) {
    throw new TypeError('Trace markers must be an array.');
  }
  if ((value.markers?.length ?? 0) > 1_000) {
    throw new RangeError('Trace markers must contain at most 1,000 entries.');
  }
  if (value.limitations !== undefined && !Array.isArray(value.limitations)) {
    throw new TypeError('Trace limitations must be an array.');
  }
  if ((value.limitations?.length ?? 0) > 20) {
    throw new RangeError('Trace limitations must contain at most 20 entries.');
  }
  const markers = Array.isArray(value.markers) ? value.markers.map((marker, index) => ({
    id: boundedText(marker.id ?? `marker-${index + 1}`, `Marker ${index + 1} id`, 100, true),
    name: boundedText(marker.name ?? 'Unnamed marker', `Marker ${index + 1} name`, 160, true),
    at: finiteTime(marker.at, `Marker ${index + 1} time`)
  })) : [];
  return {
    traceVersion: 1,
    instrumentationVersion: boundedText(value.instrumentationVersion ?? 'unknown', 'Instrumentation version', 50, true),
    adapter: boundedText(value.adapter ?? 'unknown adapter', 'Trace adapter', 120, true),
    runtime: boundedText(value.runtime ?? 'unknown runtime', 'Trace runtime', 300, true),
    label: boundedText(value.label ?? 'Untitled trace', 'Trace label', 160, true),
    startedAt: finiteTime(value.startedAt ?? 0, 'Trace start'),
    endedAt: finiteTime(value.endedAt ?? 0, 'Trace end'),
    durationMs: finiteTime(value.durationMs ?? Math.max(0, (value.endedAt ?? 0) - (value.startedAt ?? 0)), 'Trace duration'),
    status: value.status === 'complete' ? 'complete' : 'partial',
    partialReason: boundedText(value.partialReason ?? '', 'Partial reason', 300),
    droppedEvents: Number.isInteger(value.droppedEvents) && value.droppedEvents >= 0 ? value.droppedEvents : 0,
    markers,
    operations,
    limitations: Array.isArray(value.limitations) ? value.limitations.map((item, index) => boundedText(item, `Limitation ${index + 1}`, 500, true)) : []
  };
}

export function analyseTrace(traceValue, options = {}) {
  const trace = validateTrace(traceValue);
  const longPendingMs = Number.isFinite(options.longPendingMs) && options.longPendingMs >= 0 ? options.longPendingMs : 1_000;
  const operations = trace.operations.map((operation) => ({
    ...operation,
    durationMs: Math.max(0, (operation.settledAt ?? trace.endedAt) - operation.startedAt),
    parentCoverage: operation.parentId ? 'explicit parent id supplied' : 'parent unavailable'
  }));
  const unobservedRejections = operations.filter((operation) => operation.status === 'rejected' && !operation.rejectionObserved && !operation.detached).map((operation) => ({
    type: 'unobserved rejection',
    operationIds: [operation.id],
    source: operation.source,
    evidence: `${operation.label} rejected and no rejection observer was recorded through this wrapper before capture stopped.`,
    limitation: 'This does not prove the wider runtime lacked another observer outside the wrapper.'
  }));
  const longPending = operations.filter((operation) => operation.durationMs >= longPendingMs).map((operation) => ({
    type: operation.status === 'pending' ? 'long pending at capture end' : 'long duration observation',
    operationIds: [operation.id],
    source: operation.source,
    evidence: `${operation.label} was ${operation.status} after ${Math.round(operation.durationMs)} ms; threshold ${longPendingMs} ms.`,
    limitation: operation.detached ? `Operation was declared detached: ${operation.ignoredReason}.` : 'Duration alone does not establish a defect or resource leak.'
  }));
  const groups = new Map();
  for (const operation of operations) {
    if (!operation.serialGroup) continue;
    if (!groups.has(operation.serialGroup)) groups.set(operation.serialGroup, []);
    groups.get(operation.serialGroup).push(operation);
  }
  const serialObservations = [];
  for (const [group, members] of groups) {
    const ordered = members.sort((left, right) => left.startedAt - right.startedAt);
    if (ordered.length < 2 || ordered.some(({ settledAt }) => settledAt == null)) continue;
    const serial = ordered.slice(1).every((operation, index) => operation.startedAt >= ordered[index].settledAt);
    if (serial) {
      serialObservations.push({
        type: 'observed serial group',
        operationIds: ordered.map(({ id }) => id),
        source: ordered.map(({ source }) => source).filter(Boolean).join(', '),
        evidence: `${ordered.length} operations in declared group “${group}” did not overlap in this capture.`,
        limitation: 'Declared grouping and observed timing do not prove that parallel execution would be correct.'
      });
    }
  }
  const missingParents = operations.filter((operation) => !operation.parentId).map((operation) => operation.id);
  return {
    reportVersion: 1,
    trace,
    operations,
    thresholds: { longPendingMs },
    findings: { unobservedRejections, longPending, serialObservations },
    coverage: {
      operations: operations.length,
      explicitParents: operations.length - missingParents.length,
      missingParentOperationIds: missingParents,
      droppedEvents: trace.droppedEvents
    },
    limitation: 'Findings describe events visible through the explicit wrapper and declared relationships, not perfect runtime causality.'
  };
}

function rewriteSource(source, workspaceRoot) {
  if (!source) return '';
  const normalised = source.replace(/\\/gu, '/');
  const root = workspaceRoot ? workspaceRoot.replace(/\\/gu, '/').replace(/\/+$/u, '') : '';
  if (root && normalised.startsWith(`${root}/`)) return normalised.slice(root.length + 1);
  if (normalised.startsWith('/') || /^[A-Za-z]:\//u.test(normalised)) return `<absolute>/${normalised.split('/').at(-1)}`;
  return normalised;
}

export function exportTraceReport(analysisValue, format = 'json', options = {}) {
  if (!analysisValue || analysisValue.reportVersion !== 1) throw new TypeError('A Promise Audit analysis is required.');
  const report = {
    reportVersion: 1,
    label: analysisValue.trace.label,
    status: analysisValue.trace.status,
    runtime: analysisValue.trace.runtime,
    adapter: analysisValue.trace.adapter,
    instrumentationVersion: analysisValue.trace.instrumentationVersion,
    durationMs: analysisValue.trace.durationMs,
    droppedEvents: analysisValue.trace.droppedEvents,
    operations: analysisValue.operations.map((operation) => ({
      id: operation.id,
      label: operation.label,
      source: rewriteSource(operation.source, options.workspaceRoot ?? ''),
      parentId: operation.parentId,
      markerId: operation.markerId,
      serialGroup: operation.serialGroup,
      detached: operation.detached,
      ignoredReason: operation.ignoredReason,
      creationKnown: operation.creationKnown,
      startedAt: operation.startedAt,
      settledAt: operation.settledAt,
      status: operation.status,
      rejectionObserved: operation.rejectionObserved,
      durationMs: operation.durationMs
    })),
    markers: analysisValue.trace.markers,
    thresholds: analysisValue.thresholds,
    findings: analysisValue.findings,
    coverage: analysisValue.coverage,
    limitation: analysisValue.limitation,
    valuesCaptured: false
  };
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format !== 'html') throw new RangeError('Unsupported trace export format.');
  const escape = (value) => String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const rows = report.operations.map((operation) => `<tr><td>${escape(operation.id)}</td><td>${escape(operation.label)}</td><td>${escape(operation.status)}</td><td>${Math.round(operation.durationMs)} ms</td><td>${escape(operation.parentId || 'unavailable')}</td><td>${escape(operation.source)}</td></tr>`).join('');
  const findings = [...report.findings.unobservedRejections, ...report.findings.longPending, ...report.findings.serialObservations].map((finding) => `<li><strong>${escape(finding.type)}</strong>: ${escape(finding.evidence)} ${escape(finding.limitation)}</li>`).join('');
  return `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.label)} trace</title><style>body{max-width:75rem;margin:3rem auto;padding:0 1rem;font:16px/1.5 system-ui;color:#172231}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-top:1px solid #bbc2c8;padding:.6rem;vertical-align:top}</style><main><h1>${escape(report.label)}</h1><p>${escape(report.limitation)}</p><p>Capture status: ${escape(report.status)}. Values captured: no. Dropped events: ${report.droppedEvents}.</p><h2>Operations</h2><table><thead><tr><th>ID</th><th>Label</th><th>State</th><th>Duration</th><th>Parent</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table><h2>Findings</h2><ul>${findings || '<li>No focused findings.</li>'}</ul></main></html>`;
}
