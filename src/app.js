import { PromiseAudit, analyseTrace, exportTraceReport, validateTrace } from './audit.js';

const sampleTrace = {
  traceVersion: 1,
  instrumentationVersion: '0.1.0',
  adapter: 'explicit PromiseAudit wrapper',
  runtime: 'Node.js 22 fixture',
  label: 'Synthetic image queue',
  startedAt: 0,
  endedAt: 420,
  durationMs: 420,
  status: 'complete',
  droppedEvents: 0,
  markers: [{ id: 'marker-1', name: 'Process selected images', at: 5 }],
  operations: [
    { id: 'promise-1', label: 'Read image metadata', source: '/workspace/src/images.js:12', parentId: '', markerId: 'marker-1', serialGroup: '', detached: false, creationKnown: true, startedAt: 10, settledAt: 105, status: 'fulfilled', rejectionObserved: true },
    { id: 'promise-2', label: 'Resize image one', source: '/workspace/src/queue.js:24', parentId: 'promise-1', markerId: 'marker-1', serialGroup: 'resize-loop', detached: false, creationKnown: true, startedAt: 110, settledAt: 190, status: 'fulfilled', rejectionObserved: true },
    { id: 'promise-3', label: 'Resize image two', source: '/workspace/src/queue.js:24', parentId: 'promise-1', markerId: 'marker-1', serialGroup: 'resize-loop', detached: false, creationKnown: true, startedAt: 195, settledAt: 280, status: 'fulfilled', rejectionObserved: true },
    { id: 'promise-4', label: 'Read optional sidecar', source: '/workspace/src/metadata.js:40', parentId: 'promise-1', markerId: 'marker-1', serialGroup: '', detached: false, creationKnown: true, startedAt: 112, settledAt: 150, status: 'rejected', rejectionObserved: false },
    { id: 'promise-5', label: 'Development metrics flush', source: '/workspace/src/metrics.js:7', parentId: '', markerId: 'marker-1', serialGroup: '', detached: true, ignoredReason: 'Intentional background metrics fixture', creationKnown: true, startedAt: 30, settledAt: null, status: 'pending', rejectionObserved: false }
  ],
  limitations: [
    'Only work passed through the explicit wrapper is instrumented.',
    'Parent identifiers and serial groups are declared evidence, not a perfect runtime causal graph.'
  ]
};

const elements = {
  captureState: document.querySelector('#capture-state'),
  captureButton: document.querySelector('#capture-button'),
  source: document.querySelector('#trace-source'),
  file: document.querySelector('#trace-file'),
  threshold: document.querySelector('#pending-threshold'),
  status: document.querySelector('#job-status'),
  cancel: document.querySelector('#cancel-job'),
  empty: document.querySelector('#empty-state'),
  report: document.querySelector('#report'),
  title: document.querySelector('#trace-title'),
  totals: document.querySelector('#totals'),
  limitation: document.querySelector('#limitation'),
  lanes: document.querySelector('#lanes'),
  rows: document.querySelector('#operation-rows'),
  findings: document.querySelector('#findings'),
  dialog: document.querySelector('#work-dialog'),
  dialogStatus: document.querySelector('#dialog-job-status'),
  dialogCancel: document.querySelector('#dialog-cancel-job'),
  dialogContent: document.querySelector('#dialog-content')
};

let activeController = null;
let currentAnalysis = null;
let inputRevision = 0;

function setStatus(message, loading = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('loading', loading);
  elements.cancel.hidden = !loading;
  elements.dialogStatus.textContent = message;
  elements.dialogStatus.classList.toggle('loading', loading);
  elements.dialogStatus.hidden = !elements.dialog.open && !loading;
  elements.dialogCancel.hidden = !loading;
}

function discardReport(message) {
  inputRevision += 1;
  activeController?.abort();
  currentAnalysis = null;
  elements.report.hidden = true;
  elements.empty.hidden = false;
  elements.title.textContent = 'No current trace';
  elements.totals.replaceChildren();
  elements.lanes.replaceChildren();
  elements.rows.replaceChildren();
  elements.findings.replaceChildren();
  if (elements.dialog.open) elements.dialog.close();
  setStatus(message);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    }, { once: true });
  });
}

async function waitForControlledFixture(milliseconds, signal) {
  try {
    await wait(milliseconds, signal);
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    throw error;
  }
}

async function developmentCapture() {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const revision = inputRevision;
  const audit = new PromiseAudit({ maxEvents: 500 });
  audit.startCapture('Synthetic browser image queue');
  const markerId = audit.marker('Process selected synthetic images');
  elements.captureState.textContent = 'Capture active: explicit wrapper recording, values excluded.';
  elements.captureState.classList.add('active');
  elements.captureButton.disabled = true;
  setStatus('Loading: active development capture · preparing parallel work', true);
  const suppressSyntheticRejection = (event) => {
    if (event.reason?.message === 'Synthetic rejection whose value is not recorded.') {
      event.preventDefault();
    }
  };
  window.addEventListener('unhandledrejection', suppressSyntheticRejection);
  try {
    audit.track('Development metrics flush', () => waitForControlledFixture(1_000, controller.signal), { source: '/workspace/src/metrics.js:7', markerId, detached: true, ignoredReason: 'Intentional background metrics fixture' });
    const metadata = audit.track('Read image metadata', () => wait(90, controller.signal), { source: '/workspace/src/images.js:12', markerId });
    const colourProfile = audit.track('Read colour profile', () => wait(120, controller.signal), { source: '/workspace/src/images.js:18', markerId, parentId: metadata.auditId });
    await Promise.all([metadata, colourProfile]);
    setStatus('Loading: active development capture · observing declared serial group', true);
    await audit.track('Resize image one', () => wait(70, controller.signal), { source: '/workspace/src/queue.js:24', markerId, parentId: metadata.auditId, serialGroup: 'resize-loop' });
    await audit.track('Resize image two', () => wait(75, controller.signal), { source: '/workspace/src/queue.js:24', markerId, parentId: metadata.auditId, serialGroup: 'resize-loop' });
    audit.track('Read optional sidecar', async () => {
      const completed = await waitForControlledFixture(25, controller.signal);
      if (completed) throw new Error('Synthetic rejection whose value is not recorded.');
    }, { source: '/workspace/src/metadata.js:40', markerId, parentId: metadata.auditId });
    await wait(80, controller.signal);
    setStatus('Loading: stopping capture and indexing value-free events', true);
    const trace = audit.stopCapture();
    await wait(55, controller.signal);
    if (revision !== inputRevision) {
      throw new DOMException('Trace controls changed', 'AbortError');
    }
    const analysis = analyseTrace(trace, { longPendingMs: Number(elements.threshold.value) });
    currentAnalysis = analysis;
    render(analysis);
    elements.source.value = JSON.stringify(trace, null, 2);
    setStatus(`Capture complete: ${analysis.operations.length} wrapped operations, ${analysis.coverage.droppedEvents} dropped events and no values recorded.`);
  } catch (error) {
    const ownsOperation = activeController === controller;
    if (audit.active) {
      const trace = audit.stopCapture({ incomplete: true, reason: 'User stopped the synthetic development interaction.' });
      if (ownsOperation && revision === inputRevision) {
        currentAnalysis = analyseTrace(trace, { longPendingMs: Number(elements.threshold.value) });
        render(currentAnalysis);
      }
    }
    if (!ownsOperation) return;
    setStatus(error.name === 'AbortError'
      ? revision !== inputRevision
        ? 'Trace source or threshold changed. The previous report was discarded.'
        : 'Capture stopped. The partial trace is labelled incomplete and controlled fixture timers were cancelled.'
      : `Capture failed recoverably: ${error.message}`);
  } finally {
    window.removeEventListener('unhandledrejection', suppressSyntheticRejection);
    elements.captureState.textContent = 'Capture inactive. Explicit wrapper only.';
    elements.captureState.classList.remove('active');
    elements.captureButton.disabled = false;
    if (activeController === controller) activeController = null;
  }
}

async function processSource() {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const revision = inputRevision;
  try {
    setStatus('Loading: validating value-free trace structure', true);
    await wait(55, controller.signal);
    const trace = validateTrace(JSON.parse(elements.source.value));
    setStatus(`Loading: indexing ${trace.operations.length} operation lifecycles`, true);
    await wait(55, controller.signal);
    const analysis = analyseTrace(trace, { longPendingMs: Number(elements.threshold.value) });
    if (revision !== inputRevision) {
      throw new DOMException('Trace controls changed', 'AbortError');
    }
    currentAnalysis = analysis;
    render(analysis);
    setStatus(`Trace processing complete: ${analysis.operations.length} operations and ${analysis.coverage.droppedEvents} dropped events.`);
  } catch (error) {
    if (activeController !== controller) return;
    setStatus(error.name === 'AbortError'
      ? revision !== inputRevision
        ? 'Trace source or threshold changed. The previous report was discarded.'
        : 'Trace processing cancelled. The prior complete report remains visible.'
      : `Trace processing failed: ${error.message}`);
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function addTotal(label, value) {
  const group = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = String(value);
  group.append(term, description);
  elements.totals.append(group);
}

function render(analysis) {
  elements.empty.hidden = true;
  elements.report.hidden = false;
  elements.title.textContent = analysis.trace.label;
  elements.limitation.textContent = `${analysis.limitation} Capture status: ${analysis.trace.status}. Dropped events: ${analysis.coverage.droppedEvents}. Values captured: no.`;
  elements.totals.replaceChildren();
  addTotal('Operations', analysis.operations.length);
  addTotal('Duration ms', Math.round(analysis.trace.durationMs));
  addTotal('Explicit parents', analysis.coverage.explicitParents);
  addTotal('Dropped events', analysis.coverage.droppedEvents);
  renderLanes(analysis);
  renderTable(analysis);
  renderFindings(analysis);
}

function renderLanes(analysis) {
  elements.lanes.replaceChildren();
  const duration = Math.max(1, analysis.trace.durationMs);
  for (const operation of analysis.operations) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = operation.label;
    const track = document.createElement('span');
    track.className = 'lane-track';
    const bar = document.createElement('span');
    bar.className = `lane-bar ${operation.status}`;
    bar.style.left = `${Math.max(0, ((operation.startedAt - analysis.trace.startedAt) / duration) * 100)}%`;
    bar.style.width = `${Math.max(0.7, (operation.durationMs / duration) * 100)}%`;
    track.append(bar);
    const state = document.createElement('span');
    state.textContent = `${operation.status} · ${Math.round(operation.durationMs)} ms`;
    item.append(name, track, state);
    elements.lanes.append(item);
  }
}

function renderTable(analysis) {
  elements.rows.replaceChildren();
  for (const operation of analysis.operations) {
    const row = document.createElement('tr');
    row.id = `row-${operation.id}`;
    const name = document.createElement('td');
    name.textContent = `${operation.label} (${operation.id})`;
    const state = document.createElement('td');
    const stateText = document.createElement('span');
    stateText.className = `state ${operation.status}`;
    stateText.textContent = operation.status;
    state.append(stateText);
    const duration = document.createElement('td');
    duration.textContent = `${Math.round(operation.durationMs)} ms`;
    const parent = document.createElement('td');
    parent.textContent = operation.parentId || 'Unavailable';
    const marker = document.createElement('td');
    marker.textContent = operation.markerId || 'None';
    const source = document.createElement('td');
    source.textContent = operation.source || 'Unavailable';
    row.append(name, state, duration, parent, marker, source);
    elements.rows.append(row);
  }
}

function focusOperations(ids) {
  for (const row of elements.rows.children) row.classList.remove('highlight');
  const rows = ids.map((id) => document.querySelector(`#row-${CSS.escape(id)}`)).filter(Boolean);
  rows.forEach((row) => row.classList.add('highlight'));
  rows[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function findingGroup(title, values) {
  const section = document.createElement('section');
  section.className = 'finding-group';
  const heading = document.createElement('h4');
  heading.textContent = `${title} (${values.length})`;
  const list = document.createElement('ol');
  if (!values.length) {
    const item = document.createElement('li');
    item.textContent = 'None observed by this focused rule.';
    list.append(item);
  }
  for (const finding of values) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = finding.evidence;
    button.addEventListener('click', () => focusOperations(finding.operationIds));
    const limitation = document.createElement('p');
    limitation.textContent = finding.limitation;
    item.append(button, limitation);
    list.append(item);
  }
  section.append(heading, list);
  elements.findings.append(section);
}

function renderFindings(analysis) {
  elements.findings.replaceChildren();
  findingGroup('Unobserved wrapper rejections', analysis.findings.unobservedRejections);
  findingGroup('Long pending or duration', analysis.findings.longPending);
  findingGroup('Observed serial groups', analysis.findings.serialObservations);
  const coverage = document.createElement('section');
  coverage.className = 'finding-group';
  const heading = document.createElement('h4');
  heading.textContent = 'Parent coverage';
  const text = document.createElement('p');
  text.textContent = `${analysis.coverage.explicitParents} of ${analysis.coverage.operations} operations have explicit parent identifiers. Missing parentage remains visible rather than inferred.`;
  coverage.append(heading, text);
  elements.findings.append(coverage);
}

function download(content, extension, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `promise-audit-trace.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}

function openExport() {
  if (!currentAnalysis) {
    setStatus('No current report is available to export. Process the current trace first.');
    return;
  }
  elements.dialogContent.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Value-free trace export';
  const review = document.createElement('p');
  review.textContent = 'Exports include operation labels, timing, state, declared parentage, markers, rewritten source labels and findings. Arguments, settled values, rejection reasons, request bodies and environment content were never captured.';
  const workspaceLabel = document.createElement('label');
  workspaceLabel.htmlFor = 'workspace-root';
  workspaceLabel.textContent = 'Optional workspace root to rewrite';
  const workspace = document.createElement('input');
  workspace.id = 'workspace-root';
  workspace.value = '/workspace';
  const actions = document.createElement('div');
  actions.className = 'export-actions';
  for (const [label, format, extension, type] of [
    ['Download JSON', 'json', 'json', 'application/json;charset=utf-8'],
    ['Download self-contained HTML', 'html', 'html', 'text/html;charset=utf-8']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const revision = inputRevision;
      const analysis = currentAnalysis;
      try {
        setStatus(`Loading: preparing ${format} trace export`, true);
        await wait(55, controller.signal);
        if (
          revision !== inputRevision ||
          analysis === null ||
          analysis !== currentAnalysis
        ) {
          throw new DOMException('Stopped', 'AbortError');
        }
        const output = exportTraceReport(analysis, format, { workspaceRoot: workspace.value });
        download(output, extension, type);
        setStatus(`${format} trace export prepared locally.`);
      } catch (error) {
        if (activeController !== controller) return;
        setStatus(error.name === 'AbortError' ? 'Trace export cancelled.' : `Trace export failed: ${error.message}`);
      } finally {
        if (activeController === controller) activeController = null;
      }
    });
    actions.append(button);
  }
  elements.dialogContent.append(heading, review, workspaceLabel, workspace, actions);
  elements.dialog.showModal();
}

elements.captureButton.addEventListener('click', developmentCapture);
document.querySelector('#import-button').addEventListener('click', processSource);
document.querySelector('#fixture-button').addEventListener('click', () => {
  discardReport('Synthetic trace selected. Process it to create a current report.');
  elements.source.value = JSON.stringify(sampleTrace, null, 2);
  elements.source.focus();
  setStatus('Synthetic trace fixture loaded. Process it to apply the selected threshold.');
});
elements.source.addEventListener('input', () => {
  discardReport('Trace source changed. The previous report and export were discarded.');
});
elements.threshold.addEventListener('input', () => {
  discardReport('Pending threshold changed. Process the trace again before export.');
});
elements.file.addEventListener('change', async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  discardReport('A different local trace was selected. Reading it now.');
  const controller = new AbortController();
  activeController = controller;
  setStatus('Loading: reading the explicitly selected trace', true);
  try {
    if (file.size > 2_000_000) throw new RangeError('Trace files are limited to 2,000,000 bytes.');
    const source = await file.text();
    if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    elements.source.value = source;
    setStatus('Local trace loaded as untrusted text. Process it when ready.');
  } catch (error) {
    if (activeController !== controller) return;
    setStatus(error.name === 'AbortError' ? 'Trace reading cancelled.' : `Trace reading failed: ${error.message}`);
  } finally {
    if (activeController === controller) activeController = null;
  }
});
elements.cancel.addEventListener('click', () => activeController?.abort());
elements.dialogCancel.addEventListener('click', () => activeController?.abort());
document.querySelector('#export-button').addEventListener('click', openExport);
document.querySelector('#boundary-button').addEventListener('click', () => {
  elements.dialogContent.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Instrumentation limits';
  const text = document.createElement('p');
  text.textContent = 'Promise Audit v0.1 sees only work passed through its explicit wrapper. Parent and serial-group identifiers are supplied by the application, timing is perturbed by instrumentation, and an unobserved rejection finding means no handler passed through this wrapper by the checkpoint. It does not patch global Promise, inspect values or establish perfect runtime causality.';
  elements.dialogContent.append(heading, text);
  elements.dialog.showModal();
});
