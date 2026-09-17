const formPanel = document.getElementById('form-panel');
const progressPanel = document.getElementById('progress-panel');
const form = document.getElementById('install-form');
const formError = document.getElementById('form-error');
const startBtn = document.getElementById('start-btn');
const stepsEl = document.getElementById('steps');
const logEl = document.getElementById('log');
const logPathEl = document.getElementById('log-path');
const copyBtn = document.getElementById('copy-log');
const resultEl = document.getElementById('result');
const progressTitle = document.getElementById('progress-title');

/** @type {Map<string, HTMLLIElement>} */
const stepNodes = new Map();
let logPath = '';
let finished = false;

async function init() {
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
      /* ignore */
    }
  };
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
    if (ev.message && ev.status === 'failed') appendLog(`STEP ${ev.step} failed: ${ev.message}`);
    return;
  }

  if (ev.type === 'log') {
    const prefix = ev.level === 'ok' ? 'OK  ' : ev.level === 'error' ? 'ERROR  ' : '';
    appendLog(prefix + (ev.message || ''));
    return;
  }

  if (ev.type === 'done' || (ev.type === 'state' && ev.status === 'ok')) {
    finished = true;
    showResult('ok', ev);
    return;
  }

  if (ev.type === 'state' && ev.status === 'failed') {
    finished = true;
    showResult('failed', ev);
  }
}

function setStep(id, status) {
  const li = stepNodes.get(id);
  if (!li) return;
  li.className = status || 'pending';
  const mark = li.querySelector('.mark');
  if (!mark) return;
  if (status === 'running') mark.textContent = '●';
  else if (status === 'ok') mark.textContent = '✓';
  else if (status === 'failed') mark.textContent = '✕';
  else mark.textContent = '○';
}

function appendLog(line) {
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  logEl.scrollTop = logEl.scrollHeight;
}

function showResult(kind, ev) {
  progressTitle.textContent = kind === 'ok' ? 'Installed' : 'Install failed';
  resultEl.hidden = false;
  resultEl.className = `result ${kind}`;
  if (kind === 'ok') {
    const hint = ev.result?.hint || ev.message || 'Done.';
    const dest = ev.result?.dest || '';
    resultEl.innerHTML = `<h3>All set</h3><p>${escapeHtml(hint)}</p>${
      dest ? `<p>Workspace: <code>${escapeHtml(dest)}</code></p>` : ''
    }<p>You can close this tab.</p>`;
  } else {
    const err = ev.error || {};
    const step = err.stepLabel || err.step || 'unknown';
    const msg = err.message || 'Something went wrong.';
    const lp = err.logPath || logPath;
    logPathEl.textContent = lp;
    resultEl.innerHTML = `<h3>Stopped at: ${escapeHtml(step)}</h3>
      <p>${escapeHtml(msg)}</p>
      <p>Send Tim the log below (or the file at <code>${escapeHtml(lp)}</code>).</p>
      <p>Keep this tab open until you have copied the log.</p>`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const assistant =
    /** @type {HTMLInputElement|null} */ (
      form.querySelector('input[name="assistant"]:checked')
    )?.value || 'none';

  const payload = {
    name: /** @type {HTMLInputElement} */ (document.getElementById('name')).value,
    email: /** @type {HTMLInputElement} */ (document.getElementById('email')).value,
    passphrase: /** @type {HTMLInputElement} */ (document.getElementById('passphrase')).value,
    assistant,
  };

  startBtn.disabled = true;
  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    startBtn.disabled = false;
    formError.hidden = false;
    formError.textContent = (data.errors || [data.error || 'Could not start']).join(' ');
    return;
  }

  formPanel.hidden = true;
  progressPanel.hidden = false;
  if (data.logPath) {
    logPath = data.logPath;
    logPathEl.textContent = logPath;
  }
  appendLog('Starting install…');
});

copyBtn.addEventListener('click', async () => {
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

void finished;
init();
