const formPanel = document.getElementById('form-panel');
const progressPanel = document.getElementById('progress-panel');
const form = document.getElementById('install-form');
const formError = document.getElementById('form-error');
const startBtn = document.getElementById('start-btn');
const btnLabel = startBtn.querySelector('.btn-label');
const btnBusy = startBtn.querySelector('.btn-busy');
const stepsEl = document.getElementById('steps');
const logEl = document.getElementById('log');
const logPathEl = document.getElementById('log-path');
const logDetails = document.getElementById('log-details');
const copyBtn = document.getElementById('copy-log');
const resultEl = document.getElementById('result');
const progressTitle = document.getElementById('progress-title');
const progressTitleText = document.getElementById('progress-title-text');

const statePanel = document.getElementById('state-panel');
const stateBadge = document.getElementById('state-badge');
const stateSummary = document.getElementById('state-summary');
const stateChecks = document.getElementById('state-checks');
const stateExtra = document.getElementById('state-extra');

const destInput = document.getElementById('dest');
const destChoices = document.getElementById('dest-choices');
const destStatus = document.getElementById('dest-status');
const allowCloudRow = document.getElementById('allow-cloud-row');
const allowCloud = document.getElementById('allow-cloud');
const removePreviousRow = document.getElementById('remove-previous-row');
const removePrevious = document.getElementById('remove-previous');
const removePreviousLabel = document.getElementById('remove-previous-label');

/** @type {Map<string, HTMLLIElement>} */
const stepNodes = new Map();
let logPath = '';
let inspectTimer = null;
let lastInspect = null;

async function init() {
  try {
    const meta = await fetch('/api/meta').then((r) => r.json());
    logPath = meta.logPath || '';
    logPathEl.textContent = logPath;
    for (const step of meta.steps || []) {
      const li = document.createElement('li');
      li.dataset.step = step.id;
      li.className = 'pending';
      li.innerHTML = `<span class="mark">○</span><span class="label">${escapeHtml(step.label)}</span>`;
      stepsEl.appendChild(li);
      stepNodes.set(step.id, li);
    }

    if (destInput && meta.defaultDest) destInput.value = meta.defaultDest;
    renderChoices(meta.candidates || []);
    renderState(meta);

    const es = new EventSource('/api/events');
    es.onmessage = (msg) => {
      try {
        handleEvent(JSON.parse(msg.data));
      } catch {
        /* ignore bad events */
      }
    };
    es.onerror = () => {
      /* keep page usable if SSE drops briefly */
    };
  } catch (e) {
    formError.hidden = false;
    formError.textContent =
      'Could not reach the installer. Close this tab and run the installer again.';
  }
}

/** The folder shortcuts we offer under the input. */
function renderChoices(candidates) {
  if (!destChoices) return;
  destChoices.innerHTML = '';
  for (const c of candidates) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${c.cloud ? ' chip-warn' : ''}${c.recommended ? ' chip-rec' : ''}`;
    btn.title = c.path;
    btn.innerHTML = `<strong>${escapeHtml(c.label)}</strong><span>${escapeHtml(c.note)}</span>`;
    btn.addEventListener('click', () => {
      destInput.value = c.path;
      queueInspect(0);
    });
    destChoices.appendChild(btn);
  }
}

/** The "what is on this machine right now" panel. */
function renderState(data) {
  if (!statePanel) return;
  const install = data.install;
  if (!install) return;
  statePanel.hidden = false;

  const status = install.status;
  stateBadge.className = `badge badge-${status}`;
  stateBadge.textContent =
    status === 'installed' ? 'Installed' : status === 'partial' ? 'Incomplete' : 'Not installed';
  stateSummary.textContent = install.summary || '';

  stateChecks.innerHTML = '';
  for (const c of install.checks || []) {
    const li = document.createElement('li');
    li.className = c.ok ? 'check ok' : c.required ? 'check bad' : 'check warn';
    li.innerHTML = `<span class="mark">${c.ok ? '✓' : c.required ? '✕' : '!'}</span>
      <span class="label">${escapeHtml(c.label)}</span>
      <code>${escapeHtml(c.detail || '')}</code>`;
    stateChecks.appendChild(li);
  }

  const extra = [];
  if (install.cloud) {
    extra.push(
      `<p class="warn">This folder is synced by <strong>${escapeHtml(install.cloud.label)}</strong>. That is what corrupts checkouts — pick a local folder.</p>`,
    );
  }
  for (const o of data.others || []) {
    extra.push(
      `<p class="warn">Another install: <code>${escapeHtml(o.dest)}</code> (${escapeHtml(o.status)})</p>`,
    );
  }
  const shortcuts = data.shortcuts || [];
  if (shortcuts.length) {
    extra.push(
      `<p>Shortcuts found:</p><ul class="paths">${shortcuts
        .map(
          (s) =>
            `<li><code>${escapeHtml(s.path)}</code>${
              s.target ? ` → <code>${escapeHtml(s.target)}</code>` : ''
            }${s.dead ? ' <em>(target missing)</em>' : ''}</li>`,
        )
        .join('')}</ul>`,
    );
  } else {
    extra.push('<p>No Sleep Network shortcut found on this machine.</p>');
  }
  stateExtra.innerHTML = extra.join('');

  // Offer the cleanup only when there is something to clean.
  const removable = (data.others || []).length;
  const deadShortcuts = shortcuts.filter((s) => s.dead).length;
  if (removePreviousRow) {
    if (removable || deadShortcuts) {
      removePreviousRow.hidden = false;
      removePreviousLabel.textContent = removable
        ? `Delete the other install${removable > 1 ? 's' : ''} and its shortcuts`
        : 'Delete the dead shortcuts';
      if (removable) removePrevious.checked = true;
    } else {
      removePreviousRow.hidden = true;
      removePrevious.checked = false;
    }
  }
}

/** Ask the server about the typed folder, debounced. */
function queueInspect(delay = 400) {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectTimer = setTimeout(runInspect, delay);
}

async function runInspect() {
  if (!destInput) return;
  const dest = destInput.value.trim();
  if (!dest) return;
  try {
    const data = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dest, allowCloud: Boolean(allowCloud?.checked) }),
    }).then((r) => r.json());
    lastInspect = data;

    destStatus.hidden = false;
    if (data.errors?.length) {
      destStatus.className = 'dest-status bad';
      destStatus.textContent = data.errors.join(' ');
    } else if (data.warnings?.length) {
      destStatus.className = 'dest-status warn';
      destStatus.textContent = data.warnings.join(' ');
    } else {
      destStatus.className = 'dest-status ok';
      destStatus.textContent = `Will install into ${data.dest}`;
    }

    if (allowCloudRow) allowCloudRow.hidden = !data.cloud;
    renderState(data);
  } catch {
    /* leave the last good state on screen */
  }
}

function handleEvent(ev) {
  if (ev.type === 'hello') {
    if (ev.logPath) {
      logPath = ev.logPath;
      logPathEl.textContent = logPath;
    }
    return;
  }

  if (ev.type === 'step') {
    setStep(ev.step, ev.status);
    if (ev.message && ev.status === 'failed') {
      appendLog(`Failed: ${ev.message}`);
      if (logDetails) logDetails.open = true;
    }
    return;
  }

  if (ev.type === 'log') {
    const prefix = ev.level === 'ok' ? 'OK  ' : ev.level === 'error' ? 'ERROR  ' : '';
    appendLog(prefix + (ev.message || ''));
    return;
  }

  if (ev.type === 'done' || (ev.type === 'state' && ev.status === 'ok')) {
    showResult('ok', ev);
    return;
  }

  if (ev.type === 'state' && ev.status === 'failed') {
    showResult('failed', ev);
  }
}

function setStep(id, status) {
  const li = stepNodes.get(id);
  if (!li) return;
  li.className = status || 'pending';
  const mark = li.querySelector('.mark');
  if (!mark) return;
  if (status === 'running') {
    mark.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  } else if (status === 'ok') {
    mark.textContent = '✓';
  } else if (status === 'failed') {
    mark.textContent = '✕';
  } else {
    mark.textContent = '○';
  }
}

function appendLog(line) {
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  logEl.scrollTop = logEl.scrollHeight;
}

function setBusy(busy) {
  startBtn.disabled = busy;
  if (btnLabel) btnLabel.hidden = busy;
  if (btnBusy) btnBusy.hidden = !busy;
}

function showResult(kind, ev) {
  progressTitle.classList.toggle('is-done', kind === 'ok');
  progressTitle.classList.toggle('is-failed', kind === 'failed');
  progressTitleText.textContent = kind === 'ok' ? 'Ready' : 'Something went wrong';
  resultEl.hidden = false;
  resultEl.className = `result ${kind}`;

  if (kind === 'ok') {
    const r = ev.result || ev || {};
    const dest = r.dest || '';
    const opened = Boolean(r.opened);
    const parts = [`<h3>You're set</h3>`];

    parts.push(
      opened
        ? '<p><strong>Sleep Network Launcher</strong> is opening now.</p>'
        : `<p><strong>The launcher did not open by itself.</strong>${
            r.openEvidence ? ` <span class="muted">(${escapeHtml(r.openEvidence)})</span>` : ''
          }</p><p>${escapeHtml(r.howTo || 'Double-click Sleep Network Launcher on your desktop.')}</p>`,
    );

    const rows = [];
    if (dest) rows.push(['Workspace', dest]);
    if (r.shortcut) rows.push(['Shortcut', r.shortcut]);
    if (r.target) rows.push(['Starts', r.target]);
    if (r.icon) rows.push(['Icon', r.icon]);
    if (rows.length) {
      parts.push(
        `<table class="paths-table">${rows
          .map(
            ([k, v]) =>
              `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(v)}</code></td></tr>`,
          )
          .join('')}</table>`,
      );
    }

    const removed = [...(r.removed || []), ...(r.shortcutsRemoved || [])];
    if (removed.length) {
      parts.push(
        `<p>Removed from the previous install:</p><ul class="paths">${removed
          .map((p) => `<li><code>${escapeHtml(p)}</code></li>`)
          .join('')}</ul>`,
      );
    }

    if ((r.checks || []).length) {
      parts.push(
        `<details class="verify"><summary>What was verified</summary><ul class="checks">${r.checks
          .map(
            (c) =>
              `<li class="check ${c.ok ? 'ok' : 'bad'}"><span class="mark">${
                c.ok ? '✓' : '✕'
              }</span><span class="label">${escapeHtml(c.label)}</span><code>${escapeHtml(
                c.detail || '',
              )}</code></li>`,
          )
          .join('')}</ul></details>`,
      );
    }

    parts.push('<p>You can close this tab.</p>');
    resultEl.innerHTML = parts.join('');
  } else {
    const err = ev.error || {};
    const step = err.stepLabel || err.step || 'unknown step';
    const msg = err.message || 'Something went wrong.';
    const lp = err.logPath || logPath;
    logPathEl.textContent = lp;
    if (logDetails) logDetails.open = true;
    resultEl.innerHTML = `<h3>Stopped at: ${escapeHtml(step)}</h3>
      <p>${escapeHtml(msg)}</p>
      <p>Click <strong>Copy log</strong> and send it to Tim.</p>
      <p>Keep this tab open until you have the log.</p>`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const payload = {
    name: /** @type {HTMLInputElement} */ (document.getElementById('name')).value,
    email: /** @type {HTMLInputElement} */ (document.getElementById('email')).value,
    passphrase: /** @type {HTMLInputElement} */ (document.getElementById('passphrase')).value,
    assistant:
      /** @type {HTMLSelectElement} */ (document.getElementById('assistant')).value || 'none',
    dest: destInput ? destInput.value.trim() : '',
    allowCloud: Boolean(allowCloud?.checked),
    removePrevious: Boolean(removePrevious?.checked && !removePreviousRow.hidden),
  };

  setBusy(true);
  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setBusy(false);
      formError.hidden = false;
      formError.textContent = (data.errors || [data.error || 'Could not start']).join(' ');
      return;
    }

    formPanel.hidden = true;
    if (statePanel) statePanel.hidden = true;
    progressPanel.hidden = false;
    progressTitle.classList.remove('is-done', 'is-failed');
    progressTitleText.textContent = 'Working…';
    if (data.logPath) {
      logPath = data.logPath;
      logPathEl.textContent = logPath;
    }
    appendLog('Starting…');
  } catch {
    setBusy(false);
    formError.hidden = false;
    formError.textContent = 'Could not start. Close this tab and run the installer again.';
  }
});

if (destInput) {
  destInput.addEventListener('input', () => queueInspect());
  destInput.addEventListener('blur', () => queueInspect(0));
}
if (allowCloud) allowCloud.addEventListener('change', () => queueInspect(0));

copyBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    const text = await fetch('/api/log').then((r) => r.text());
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied';
    setTimeout(() => {
      copyBtn.textContent = 'Copy log';
    }, 1500);
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
