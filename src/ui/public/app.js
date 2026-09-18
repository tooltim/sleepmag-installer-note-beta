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

/** @type {Map<string, HTMLLIElement>} */
const stepNodes = new Map();
let logPath = '';

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
    formError.textContent = 'Could not reach the installer. Close this tab and run the installer again.';
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
    const dest = ev.result?.dest || '';
    const opened = ev.result?.opened || ev.opened;
    resultEl.innerHTML = `<h3>You're set</h3>
      <p>${
        opened
          ? '<strong>Sleep Network Launcher</strong> is opening now.'
          : 'Open <strong>Sleep Network Launcher</strong> on your desktop.'
      }</p>
      ${dest ? `<p>Workspace: <code>${escapeHtml(dest)}</code></p>` : ''}
      <p>You can close this tab.</p>`;
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
    assistant: /** @type {HTMLSelectElement} */ (document.getElementById('assistant')).value || 'none',
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
