// Double-click (or double-tap) any part of the page to queue a UI change for Claude.
// kb-ui-edit is never allowed to edit this file, and the server always injects it,
// so this keeps working even if a change breaks the rest of the page.
(() => {
  if (window.__kbQueueLoaded) return;
  window.__kbQueueLoaded = true;

  const STYLE = `
.kbq-panel{position:fixed;right:12px;bottom:96px;z-index:2147483000;max-width:calc(100vw - 24px);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1f23}
.kbq-toggle{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #d6d3cc;background:#fff;color:inherit;font:inherit;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.kbq-count{display:inline-block;min-width:20px;margin-left:6px;padding:0 6px;border-radius:999px;background:#b5482a;color:#fff;font-size:12px;text-align:center}
.kbq-body{position:absolute;right:0;bottom:52px;width:min(340px,calc(100vw - 24px));max-height:min(60vh,420px);overflow:auto;padding:12px;background:#fff;border:1px solid #d6d3cc;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.kbq-hint{margin:0 0 8px;color:#5d636e}
.kbq-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.kbq-item{padding:8px;border:1px solid #e2e0da;border-radius:8px;overflow-wrap:anywhere}
.kbq-status{display:inline-block;margin-right:6px;font-size:12px;font-weight:700}
.kbq-queued .kbq-status{color:#5d636e}.kbq-working .kbq-status{color:#a15c00}.kbq-done .kbq-status{color:#1f7a4d}.kbq-failed .kbq-status{color:#9b1c1c}
.kbq-detail{margin:4px 0 0;color:#5d636e;font-size:13px}
.kbq-highlight{position:fixed;z-index:2147482999;pointer-events:none;border:2px dashed #b5482a;border-radius:6px;background:rgba(181,72,42,.08)}
.kbq-pop{position:fixed;z-index:2147483001;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 24px));padding:12px;background:#fff;color:#1d1f23;border:1px solid #d6d3cc;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.kbq-pop label{font-weight:600}
.kbq-pop textarea{width:100%;box-sizing:border-box;min-height:72px;padding:8px;font:inherit;color:inherit;background:#fff;border:1px solid #d6d3cc;border-radius:8px;resize:vertical}
.kbq-target{color:#5d636e;font-size:12px;overflow-wrap:anywhere}
.kbq-actions{display:flex;justify-content:flex-end;gap:8px}
.kbq-btn{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #d6d3cc;background:#fff;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.kbq-primary{background:#b5482a;border-color:#b5482a;color:#fff}
.kbq-error{margin:0;color:#9b1c1c}
[data-kbq][hidden],.kbq-count[hidden]{display:none!important}
@media (max-width:599px){.kbq-pop{left:12px!important;right:12px;top:auto!important;bottom:12px;width:auto}}
@media (prefers-color-scheme:dark){
.kbq-panel,.kbq-pop{color:#eceae6}
.kbq-toggle,.kbq-body,.kbq-pop,.kbq-btn,.kbq-pop textarea{background:#1f2226;border-color:#3a3e45}
.kbq-item{border-color:#33373d}
.kbq-hint,.kbq-detail,.kbq-target,.kbq-queued .kbq-status{color:#a2a7b0}
.kbq-primary{background:#e0714f;border-color:#e0714f;color:#15171a}
}`;

  const make = (tag, className, html = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.dataset.kbq = '';
    node.innerHTML = html;
    return node;
  };
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = make('div', 'kbq-panel', `
    <button type="button" class="kbq-toggle" aria-expanded="false">UI changes<span class="kbq-count" hidden>0</span></button>
    <div class="kbq-body" data-kbq hidden>
      <p class="kbq-hint">Double-click (or double-tap) any part of the page to ask Claude to change it.</p>
      <ol class="kbq-list"></ol>
    </div>`);
  const highlight = make('div', 'kbq-highlight');
  highlight.hidden = true;
  const pop = make('form', 'kbq-pop', `
    <label for="kbq-prompt">What should change here?</label>
    <textarea id="kbq-prompt" rows="3" placeholder="e.g. Make this button smaller and move it left"></textarea>
    <div class="kbq-target"></div>
    <p class="kbq-error" data-kbq role="alert" hidden></p>
    <div class="kbq-actions">
      <button type="button" class="kbq-btn kbq-cancel">Cancel</button>
      <button type="submit" class="kbq-btn kbq-primary">Queue change</button>
    </div>`);
  pop.hidden = true;
  document.body.append(panel, highlight, pop);

  const toggle = panel.querySelector('.kbq-toggle');
  const body = panel.querySelector('.kbq-body');
  const countEl = panel.querySelector('.kbq-count');
  const listEl = panel.querySelector('.kbq-list');
  const promptEl = pop.querySelector('textarea');
  const targetEl = pop.querySelector('.kbq-target');
  const errorEl = pop.querySelector('.kbq-error');
  let target = null;
  let openedAt = 0;

  function setOpen(open) {
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(body.hidden));

  const LABELS = { queued: 'Queued', working: 'Working…', done: 'Done', failed: 'Failed' };
  function renderQueue(items) {
    const active = items.filter((i) => i.status === 'queued' || i.status === 'working').length;
    countEl.textContent = String(active);
    countEl.hidden = active === 0;
    listEl.innerHTML = items.length
      ? items.slice().reverse().map((i) => `
        <li class="kbq-item kbq-${escapeHtml(i.status)}">
          <span class="kbq-status">${LABELS[i.status] ?? escapeHtml(i.status)}</span>${escapeHtml(i.prompt)}
          ${i.summary ? `<p class="kbq-detail">${escapeHtml(i.summary)}</p>` : ''}
          ${i.error ? `<p class="kbq-detail">${escapeHtml(i.error)}</p>` : ''}
        </li>`).join('')
      : '<li class="kbq-detail">No changes yet.</li>';
  }

  function cssPath(node) {
    const parts = [];
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !c.startsWith('kbq-')).slice(0, 2);
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ') || 'body';
  }

  function describe(node) {
    const text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return `<${node.tagName.toLowerCase()}>${text ? ` "${text}"` : ''}`;
  }

  function place(node) {
    const r = node.getBoundingClientRect();
    Object.assign(highlight.style, {
      top: `${r.top - 3}px`, left: `${r.left - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`,
    });
    const w = pop.offsetWidth || 360;
    const h = pop.offsetHeight || 200;
    const top = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    Object.assign(pop.style, { top: `${top}px`, left: `${left}px` });
  }

  function open(raw, event) {
    if (!(raw instanceof Element)) return;
    if (raw.closest('[data-kbq]') || raw.closest('input, textarea, select, [contenteditable]')) return;
    if (Date.now() - openedAt < 500) return;
    event?.preventDefault();
    window.getSelection()?.removeAllRanges();
    target = raw.closest('button, a') || raw;
    openedAt = Date.now();
    targetEl.textContent = `Changing: ${describe(target)}`;
    errorEl.hidden = true;
    promptEl.value = '';
    highlight.hidden = false;
    pop.hidden = false;
    place(target);
    promptEl.focus();
  }

  function close() {
    pop.hidden = true;
    highlight.hidden = true;
    target = null;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  // The first click of a double-click can run the element's action and move it (Sync Drive
  // shifts left when its status text grows), so the dblclick lands on whatever slid under
  // the pointer. Use the element under the first press instead.
  let firstPress = { time: 0, node: null };
  document.addEventListener('mousedown', (e) => {
    if (e.detail <= 1) firstPress = { time: Date.now(), node: e.target };
  }, true);
  document.addEventListener('dblclick', (e) => {
    const recent = Date.now() - firstPress.time < 1000 && firstPress.node?.isConnected;
    open(recent ? firstPress.node : e.target, e);
  });
  let lastTap = { time: 0, node: null };
  document.addEventListener('touchend', (e) => {
    if (e.touches.length || e.changedTouches.length !== 1) return;
    const now = Date.now();
    if (now - lastTap.time < 350 && lastTap.node === e.target) {
      lastTap = { time: 0, node: null };
      open(e.target, e);
    } else {
      lastTap = { time: now, node: e.target };
    }
  }, { passive: false });

  addEventListener('resize', () => { if (target) place(target); });
  addEventListener('scroll', () => { if (target) place(target); }, { passive: true });
  pop.querySelector('.kbq-cancel').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) pop.requestSubmit();
  });

  pop.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = promptEl.value.trim();
    if (!prompt) { showError('Describe the change first.'); return; }
    if (!target) return;
    const payload = {
      prompt,
      selector: cssPath(target),
      text: (target.innerText || target.textContent || '').trim().slice(0, 500),
      html: target.outerHTML.slice(0, 2048),
    };
    try {
      const res = await fetch('/api/ui-change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      close();
      setOpen(true);
      refresh();
    } catch (err) {
      showError(err instanceof TypeError ? "Can't reach the local server." : err.message);
    }
  });

  async function refresh() {
    try { renderQueue(await (await fetch('/api/ui-queue')).json()); } catch { /* server unavailable */ }
  }

  function pageBusy() {
    if (!pop.hidden && promptEl.value.trim()) return true;
    try { return typeof window.kbBusy === 'function' && Boolean(window.kbBusy()); } catch { return false; }
  }

  let reloadScheduled = false;
  function reloadWhenIdle(started = Date.now()) {
    if (pageBusy() && Date.now() - started < 120_000) {
      setTimeout(() => reloadWhenIdle(started), 1000);
      return;
    }
    location.reload();
  }

  if ('EventSource' in window) {
    const events = new EventSource('/api/events');
    events.addEventListener('ui-queue', (e) => {
      try { renderQueue(JSON.parse(e.data)); } catch { /* ignore a bad event */ }
    });
    events.addEventListener('reload', () => {
      if (reloadScheduled) return;
      reloadScheduled = true;
      reloadWhenIdle();
    });
  }
  refresh();
})();
