/* eslint-disable */
// Run: node --import tsx --test src/models/markdown.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from './markdown.mjs';

describe('renderMarkdown — block structure', () => {
  test('headings render at their level', () => {
    assert.equal(renderMarkdown('# Title'), '<h1>Title</h1>');
    assert.equal(renderMarkdown('### Deep'), '<h3>Deep</h3>');
    assert.equal(renderMarkdown('###### Six'), '<h6>Six</h6>');
  });

  test('paragraphs wrap, blank lines split, soft line breaks become <br>', () => {
    assert.equal(renderMarkdown('hello world'), '<p>hello world</p>');
    assert.equal(renderMarkdown('one\ntwo'), '<p>one<br>two</p>');
    assert.equal(renderMarkdown('one\n\ntwo'), '<p>one</p><p>two</p>');
  });

  test('bullet lists collect into a single <ul>', () => {
    assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
    // '*' bullets work too
    assert.equal(renderMarkdown('* x\n* y'), '<ul><li>x</li><li>y</li></ul>');
  });

  test('a paragraph followed by a list flushes the paragraph first', () => {
    assert.equal(renderMarkdown('intro\n- item'), '<p>intro</p><ul><li>item</li></ul>');
  });
});

describe('renderMarkdown — inline marks', () => {
  test('bold and italic', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
    assert.equal(renderMarkdown('say *hi*'), '<p>say <em>hi</em></p>');
  });

  test('inline code is wrapped in <code> and not further escaped inside', () => {
    assert.equal(renderMarkdown('use `x` now'), '<p>use <code>x</code> now</p>');
  });
});

describe('renderMarkdown — fenced code', () => {
  test('closed fence becomes <pre><code> with body escaped', () => {
    const html = renderMarkdown('```\nconst x = 1 < 2;\n```');
    assert.equal(html, '<pre><code>const x = 1 &lt; 2;</code></pre>');
  });

  test('fence body is NOT markdown-processed', () => {
    const html = renderMarkdown('```\n# not a heading\n**not bold**\n```');
    assert.equal(html, '<pre><code># not a heading\n**not bold**</code></pre>');
  });

  test('a dangling open fence (mid-stream) is still captured', () => {
    const html = renderMarkdown('```\nstreaming output');
    assert.equal(html, '<pre><code>streaming output</code></pre>');
  });
});

describe('renderMarkdown — XSS / escaping (agent output is untrusted)', () => {
  test('raw HTML tags are escaped, not rendered', () => {
    assert.equal(renderMarkdown('a <b>tag</b>'), '<p>a &lt;b&gt;tag&lt;/b&gt;</p>');
  });

  test('a <script> tag is inert', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.ok(!/<script>/.test(html), 'must not contain a live <script> tag');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('attribute-injection attempts are escaped', () => {
    const html = renderMarkdown('"><img src=x onerror=alert(1)>');
    assert.ok(!/<img/.test(html), 'must not contain a live <img> tag');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('HTML inside a heading is escaped', () => {
    assert.equal(renderMarkdown('# <i>x</i>'), '<h1>&lt;i&gt;x&lt;/i&gt;</h1>');
  });

  test('HTML inside a code fence is escaped (no live markup)', () => {
    const html = renderMarkdown('```\n<script>evil()</script>\n```');
    assert.ok(!/<script>/.test(html));
    assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
  });

  test('ampersands are escaped before tags so entities cannot be reconstructed', () => {
    assert.equal(renderMarkdown('a & b'), '<p>a &amp; b</p>');
  });
});

describe('escapeHtml', () => {
  test('escapes the three HTML-significant characters', () => {
    assert.equal(escapeHtml('<a> & </a>'), '&lt;a&gt; &amp; &lt;/a&gt;');
  });
  test('coerces non-strings', () => {
    assert.equal(escapeHtml(42), '42');
  });
});
