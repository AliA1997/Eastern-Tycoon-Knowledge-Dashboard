// Minimal YAML-style front matter: one `key: value` per line; values may be JSON-quoted.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { /* keep the raw value */ }
    }
    data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

export function formatFrontmatter(data) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(String(value ?? ''))}`);
  return `---\n${lines.join('\n')}\n---\n`;
}
