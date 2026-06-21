/* eslint-disable */
// Agent-output markdown → HTML, lifted verbatim from the client (issue #2).
//
// A minimal, dependency-free renderer for the markdown subset agents actually
// emit: headings, bold/italic, inline + fenced code, bullet lists, paragraphs.
// EVERYTHING is HTML-escaped first, so agent-generated text can never inject
// markup — raw `<script>`, attribute injection, etc. all render as inert text.
// Kept dependency-free to stay clean-room / browser-safe.
//
// Fenced code blocks are pulled out before markdown processing and parked behind
// a NUL-delimited placeholder (`\0CB<n>\0`) so their bodies aren't markdown- or
// inline-processed; NUL can't collide with anything in real agent prose.

// Escape the three HTML-significant characters. Exported so the client can share
// the exact same escaping where it builds its own markup.
export const escapeHtml = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export const renderMarkdown = (src) => {
  const blocks = [];
  let text = String(src).replace(/\r\n/g, '\n');
  // Pull fenced code out first so its body isn't markdown-processed. Match
  // closed fences, then a dangling open fence (mid-stream) up to end of text.
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => {
    blocks.push(code.replace(/\n+$/, ''));
    return `\0CB${blocks.length - 1}\0`;
  });
  text = text.replace(/```[^\n]*\n?([\s\S]*)$/, (_m, code) => {
    blocks.push(code.replace(/\n+$/, ''));
    return `\0CB${blocks.length - 1}\0`;
  });
  const inline = (s) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    list = [];
  };
  text.split('\n').forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    const cb = line.match(/^\0CB(\d+)\0$/);
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (cb) {
      flushPara();
      flushList();
      out.push(`<pre><code>${escapeHtml(blocks[+cb[1]])}</code></pre>`);
    } else if (h) {
      flushPara();
      flushList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (li) {
      flushPara();
      list.push(li[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  });
  flushPara();
  flushList();
  return out.join('');
};
