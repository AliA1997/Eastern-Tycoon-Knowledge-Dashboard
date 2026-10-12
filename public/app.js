// Eastern Tycoon Knowledge — ask, sync and feedback.
(() => {
  const STORE_KEY = 'kb-conversation-v1';
  const $ = (id) => document.getElementById(id);
  const els = {
    list: $('messages'), empty: $('empty'), form: $('ask-form'), input: $('question'),
    sync: $('sync-btn'), syncStatus: $('sync-status'),
  };
  const busy = { asks: 0, sync: false, context: 0 };
  // Read by ui-queue.js so a UI-change reload waits for work in flight.
  window.kbBusy = () => busy.asks > 0 || busy.sync || busy.context > 0;

  const state = load();

  function load() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY));
      if (saved && Array.isArray(saved.messages)) {
        for (const m of saved.messages) {
          if (m.status === 'pending') Object.assign(m, { status: 'error', error: 'The page reloaded before this answer arrived.', detail: null });
          m.savingContext = false;
        }
        return { messages: saved.messages, draft: typeof saved.draft === 'string' ? saved.draft : '' };
      }
    } catch { /* storage unavailable or corrupt */ }
    return { messages: [], draft: '' };
  }

  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error("Can't reach the local server. Is `npm start` still running?"), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, detail: data?.detail });
    }
    return data;
  }

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function renderText(text) {
    return escapeHtml(text).split(/\n{2,}/).map((p) => `<p>${p
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')}</p>`).join('');
  }

  function renderSource(src) {
    const url = /https:\/\/\S+/.exec(src)?.[0];
    if (!url) return `<li><code>${escapeHtml(src)}</code></li>`;
    const label = src.replace(url, '').replace(/[\s—–-]+$/, '').trim() || 'Google Drive doc';
    return `<li><code>${escapeHtml(label)}</code> · <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open in Drive</a></li>`;
  }

  function renderFeedback(m) {
    const pressed = (r) => String(m.rating === r);
    let html = `<div class="feedback">
      <button type="button" class="rate" data-action="rate" data-rating="up" aria-pressed="${pressed('up')}">👍 Helpful</button>
      <button type="button" class="rate" data-action="rate" data-rating="down" aria-pressed="${pressed('down')}">👎 Not helpful</button>
      ${m.rateError ? `<span class="note is-error" role="alert">${escapeHtml(m.rateError)}</span>` : ''}
    </div>`;
    if (m.rating === 'down' && !m.contextSaved) {
      html += `<form class="context-form" data-action="save-context">
        <label for="ctx-${m.id}">Add the missing context</label>
        <p class="note">Write what the answer should have said. It's saved to the knowledge base and used in future answers.</p>
        <textarea id="ctx-${m.id}" name="text" rows="4">${escapeHtml(m.contextDraft)}</textarea>
        ${m.contextError ? `<p class="note is-error" role="alert">${escapeHtml(m.contextError)}</p>` : ''}
        <div class="actions">
          <button type="submit" class="btn btn-primary"${m.savingContext ? ' disabled' : ''}>${m.savingContext ? 'Saving…' : 'Save to context'}</button>
        </div>
      </form>`;
    }
    if (m.contextSaved) {
      html += `<div class="saved" role="status">✓ Saved. Ask again to use it.
        <button type="button" class="btn btn-secondary" data-action="reask">Re-ask</button></div>`;
    }
    return html;
  }

  function renderMessage(m) {
    const li = document.createElement('li');
    li.className = 'message';
    li.dataset.id = m.id;
    let answer;
    if (m.status === 'pending') {
      answer = '<div class="msg-a"><span class="thinking">Thinking… searching the project</span></div>';
    } else if (m.status === 'error') {
      answer = `<div class="msg-a is-error" role="alert">
        <p><strong>${escapeHtml(m.error)}</strong></p>
        ${m.detail ? `<details><summary>Details</summary><pre>${escapeHtml(m.detail)}</pre></details>` : ''}
        <div class="actions"><button type="button" class="btn btn-secondary" data-action="retry">Try again</button></div>
      </div>`;
    } else {
      const sources = m.sources?.length
        ? `<div class="sources"><strong>Sources</strong><ul>${m.sources.map(renderSource).join('')}</ul></div>`
        : '';
      answer = `<div class="msg-a${m.isNo ? ' is-no' : ''}"><div class="answer-text">${renderText(m.answer)}</div>${sources}</div>${renderFeedback(m)}`;
    }
    li.innerHTML = `<div class="msg-q">${escapeHtml(m.question)}</div>${answer}`;
    return li;
  }

  function upsert(m) {
    const next = renderMessage(m);
    const current = els.list.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
    if (current) current.replaceWith(next);
    else els.list.appendChild(next);
    els.empty.hidden = state.messages.length > 0;
  }

  const scrollToEnd = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  const findMessage = (node) => state.messages.find((m) => m.id === node.closest('.message')?.dataset.id);

  async function ask(question) {
    question = question.trim();
    if (!question) return;
    const m = { id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, question, status: 'pending' };
    state.messages.push(m);
    busy.asks++;
    save(); upsert(m); scrollToEnd();
    try {
      const r = await api('/api/ask', { question });
      Object.assign(m, { serverId: r.id, answer: r.answer, sources: r.sources, isNo: r.isNo, status: 'done' });
    } catch (err) {
      Object.assign(m, { status: 'error', error: err.message, detail: err.detail ?? null });
    } finally {
      busy.asks--;
    }
    save(); upsert(m); scrollToEnd();
  }

  async function rate(m, rating) {
    const previous = m.rating;
    Object.assign(m, { rating, rateError: null });
    save(); upsert(m);
    try {
      await api('/api/feedback', { id: m.serverId, rating, question: m.question, answer: m.answer, sources: m.sources });
    } catch (err) {
      Object.assign(m, { rating: previous, rateError: `Couldn't save your rating: ${err.message}` });
    }
    save(); upsert(m);
    if (m.rating === 'down') document.getElementById(`ctx-${m.id}`)?.focus();
  }

  async function saveContext(m, text) {
    if (!text.trim()) {
      m.contextError = 'Write the missing context first.';
      upsert(m);
      return;
    }
    Object.assign(m, { savingContext: true, contextError: null, contextDraft: text });
    busy.context++;
    upsert(m);
    try {
      await api('/api/context', { id: m.serverId, text, question: m.question });
      Object.assign(m, { contextSaved: true, contextDraft: '' });
    } catch (err) {
      m.contextError = `Couldn't save: ${err.message}`;
    } finally {
      busy.context--;
      m.savingContext = false;
    }
    save(); upsert(m);
  }

  function describeRun(r) {
    if (!r) return 'Not synced yet';
    const when = new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    let text = `Synced ${when} — ${r.added} new, ${r.updated} updated, ${r.removed} removed`;
    if (r.errors?.length) text += `, ${r.errors.length} failed`;
    return text;
  }

  function setSyncStatus(text, isError = false, detail = '') {
    els.syncStatus.textContent = text;
    els.syncStatus.classList.toggle('is-error', isError);
    els.syncStatus.title = detail || '';
  }

  async function sync() {
    busy.sync = true;
    els.sync.disabled = true;
    els.sync.textContent = 'Syncing…';
    setSyncStatus('Pulling the latest docs from Google Drive…');
    try {
      const r = await api('/api/sync', {});
      setSyncStatus(describeRun(r), Boolean(r.errors?.length), (r.errors ?? []).map((e) => `${e.title}: ${e.error}`).join('\n'));
    } catch (err) {
      setSyncStatus(
        err.status === 409 ? 'A sync is already running. Try again in a minute.' : `Sync failed: ${err.message}`,
        true, err.detail,
      );
    } finally {
      busy.sync = false;
      els.sync.disabled = false;
      els.sync.textContent = 'Sync Drive';
    }
  }

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = els.input.value;
    els.input.value = '';
    state.draft = '';
    autosize(); save();
    ask(question);
  });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.input.addEventListener('input', () => { state.draft = els.input.value; autosize(); save(); });
  els.empty.addEventListener('click', (e) => {
    const example = e.target.closest('.example');
    if (example) ask(example.textContent);
  });
  els.sync.addEventListener('click', sync);

  els.list.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    const m = button && findMessage(button);
    if (!m) return;
    if (button.dataset.action === 'rate') rate(m, button.dataset.rating);
    else if (button.dataset.action === 'retry' || button.dataset.action === 'reask') ask(m.question);
  });
  els.list.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-action="save-context"]');
    const m = form && findMessage(form);
    if (!m) return;
    e.preventDefault();
    saveContext(m, form.elements.text.value);
  });
  els.list.addEventListener('input', (e) => {
    if (e.target.name !== 'text') return;
    const m = findMessage(e.target);
    if (m) { m.contextDraft = e.target.value; save(); }
  });

  state.messages.forEach(upsert);
  els.empty.hidden = state.messages.length > 0;
  els.input.value = state.draft;
  autosize();
  api('/api/sync/last').then((r) => setSyncStatus(describeRun(r))).catch(() => setSyncStatus('Not synced yet'));
})();
