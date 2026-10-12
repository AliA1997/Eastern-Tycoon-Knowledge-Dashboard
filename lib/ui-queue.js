// Sequential in-memory queue for double-click UI change requests.
import { randomUUID } from 'node:crypto';

export function createUiQueue({ runEdit, onChange = () => {}, onSettled = async () => {}, maxItems = 50 }) {
  const items = [];
  let draining = null;

  const toPublic = ({ id, prompt, status, summary, error, at }) => ({ id, prompt, status, summary, error, at });
  const list = () => items.map(toPublic);
  const notify = () => onChange(list());

  async function drain() {
    let next;
    while ((next = items.find((i) => i.status === 'queued'))) {
      next.status = 'working';
      notify();
      try {
        const result = await runEdit(next);
        Object.assign(next, { status: 'done', summary: result.summary ?? '' });
      } catch (err) {
        Object.assign(next, { status: 'failed', error: err.message });
      }
      notify();
      try { await onSettled(next); } catch (err) { console.error('ui-queue onSettled failed:', err); }
      trim();
    }
  }

  function trim() {
    while (items.length > maxItems) {
      const index = items.findIndex((i) => i.status === 'done' || i.status === 'failed');
      if (index < 0) break;
      items.splice(index, 1);
    }
  }

  return {
    add(request) {
      const item = { ...request, id: randomUUID(), at: new Date().toISOString(), status: 'queued', summary: null, error: null };
      items.push(item);
      trim();
      notify();
      const accepted = { id: item.id, status: 'queued' }; // captured before drain() marks it working
      if (!draining) draining = drain().finally(() => { draining = null; });
      return accepted;
    },
    list,
    whenIdle: () => draining ?? Promise.resolve(),
  };
}
