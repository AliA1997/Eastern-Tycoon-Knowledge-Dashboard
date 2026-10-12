export const NO_ANSWER = 'No — not in the project context.';

// Matches "Sources:", "**Sources:**", "**Sources**:", "## Sources:" (a colon is required).
const SOURCES_LINE = /^\s*(?:#+\s*)?(?:\*\*)?sources(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/i;

export function parseAnswer(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  let index = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SOURCES_LINE.test(lines[i])) { index = i; break; }
  }
  const answer = (index < 0 ? lines : lines.slice(0, index)).join('\n').trim();
  const sources = [];
  if (index >= 0) {
    const inline = SOURCES_LINE.exec(lines[index])[1];
    const raw = [...(inline ? inline.split(/,\s+/) : []), ...lines.slice(index + 1)];
    for (const item of raw) {
      const cleaned = item.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/`/g, '').trim();
      if (cleaned && !sources.includes(cleaned)) sources.push(cleaned);
    }
  }
  return { answer, sources, isNo: answer.replace(/\s+/g, ' ') === NO_ANSWER };
}
