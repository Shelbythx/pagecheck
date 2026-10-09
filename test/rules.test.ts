import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { staticRules } from '../src/rules/index.ts';
import type { Issue } from '../src/types.ts';

const HEAD = `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>A perfectly reasonable page title</title>
  <meta name="description" content="A description that is long enough to be useful in search results, but not too long.">
  <link rel="canonical" href="https://example.com/">
  <link rel="icon" href="/favicon.svg">
  <meta property="og:title" content="Example">
  <meta property="og:description" content="Example description">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary_large_image">`;

function page({ head = HEAD, body = '<h1>Hello</h1>', lang = 'en', doctype = true } = {}) {
  return `${doctype ? '<!doctype html>' : ''}<html${lang ? ` lang="${lang}"` : ''}><head>${head}</head><body>${body}</body></html>`;
}

function audit(html: string, url = 'https://example.com/'): Issue[] {
  const p = { url: new URL(url), html, $: load(html) };
  return staticRules.flatMap((rule) => rule.check(p));
}

const ids = (issues: Issue[]) => issues.map((i) => `${i.rule}:${i.severity}`);

describe('static rules', () => {
  it('reports nothing for a well-formed page', () => {
    expect(audit(page())).toEqual([]);
  });

  it('flags a missing or badly sized title', () => {
    expect(ids(audit(page({ head: HEAD.replace(/<title>.*<\/title>/, '') })))).toContain('title:error');
    expect(ids(audit(page({ head: HEAD.replace(/<title>.*<\/title>/, '<title>Hi</title>') })))).toContain('title:warning');
  });

  it('ignores <title> inside inline SVG', () => {
    const html = page({ head: HEAD.replace(/<title>.*<\/title>/, ''), body: '<h1>x</h1><svg><title>icon</title></svg>' });
    expect(ids(audit(html))).toContain('title:error');
  });

  it('requires exactly one h1', () => {
    expect(ids(audit(page({ body: '<h2>No main heading</h2>' })))).toContain('h1:error');
    expect(ids(audit(page({ body: '<h1>One</h1><h1>Two</h1>' })))).toContain('h1:warning');
  });

  it('detects skipped heading levels', () => {
    const issues = audit(page({ body: '<h1>A</h1><h2>B</h2><h4>C</h4><h2>D</h2><h3>E</h3>' }));
    const order = issues.filter((i) => i.rule === 'heading-order');
    expect(order).toHaveLength(1);
    expect(order[0]?.message).toContain('<h2> → <h4>');
  });

  it('treats alt="" as valid but a missing alt as an error', () => {
    const issues = audit(page({ body: '<h1>x</h1><img src="a.png" alt=""><img src="b.png">' }));
    expect(issues.filter((i) => i.rule === 'img-alt').map((i) => i.target)).toEqual(['b.png']);
  });

  it('requires lang, charset and doctype', () => {
    const result = ids(audit(page({ lang: '', doctype: false, head: HEAD.replace('<meta charset="utf-8">', '') })));
    expect(result).toEqual(expect.arrayContaining(['html-lang:error', 'doctype:warning', 'charset:warning']));
  });

  it('accepts a doctype after a leading comment', () => {
    const html = `<!-- build 42 -->\n${page()}`;
    expect(ids(audit(html))).not.toContain('doctype:warning');
  });

  it('flags viewports that block zoom', () => {
    const head = HEAD.replace('initial-scale=1', 'initial-scale=1, maximum-scale=1');
    expect(ids(audit(page({ head })))).toContain('viewport:warning');
  });

  it('requires absolute og:image and canonical URLs', () => {
    const head = HEAD.replace('https://example.com/og.png', '/og.png').replace('href="https://example.com/"', 'href="/"');
    expect(ids(audit(page({ head })))).toEqual(expect.arrayContaining(['open-graph:error', 'canonical:warning']));
  });

  it('warns about noindex', () => {
    const head = `${HEAD}<meta name="robots" content="noindex, nofollow">`;
    expect(ids(audit(page({ head })))).toContain('robots:warning');
  });

  it('checks link text, including Ukrainian vague phrases', () => {
    const body = `<h1>x</h1>
      <a href="/a"><svg></svg></a>
      <a href="/b" aria-label="Instagram"><svg></svg></a>
      <a href="/c"><img src="logo.svg" alt="Home"></a>
      <a href="/d">Детальніше →</a>
      <a href="/e">Read more…</a>`;
    const issues = audit(page({ body })).filter((i) => i.rule === 'link-text');
    expect(issues.map((i) => `${i.severity}:${i.target}`)).toEqual(['warning:<a href="/a">', 'info:/d', 'info:/e']);
  });

  it('accepts every common way of labelling a form field', () => {
    const body = `<h1>x</h1>
      <label for="a">A</label><input id="a">
      <label>B <input name="b"></label>
      <input aria-label="C">
      <input type="hidden" name="token">
      <button type="submit">Send</button>
      <textarea placeholder="Message"></textarea>`;
    const issues = audit(page({ body })).filter((i) => i.rule === 'form-labels');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('placeholder');
  });

  it('finds duplicate ids and dangling in-page anchors', () => {
    const body = '<h1 id="top-title">x</h1><p id="dup"></p><p id="dup"></p><a href="#dup">ok</a><a href="#missing">bad</a><a href="#">noop</a><a href="#top">top</a>';
    const issues = audit(page({ body }));
    expect(issues.filter((i) => i.rule === 'duplicate-ids')).toHaveLength(1);
    expect(issues.filter((i) => i.rule === 'anchor-targets').map((i) => i.message)).toEqual([
      'Link points to #missing, but no element has that id',
    ]);
  });

  it('decodes percent-encoded anchors', () => {
    const body = '<h1>x</h1><section id="контакти"></section><a href="#%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D0%B8">Контакти</a>';
    expect(ids(audit(page({ body })))).not.toContain('anchor-targets:warning');
  });

  it('flags mixed content only on HTTPS pages', () => {
    const body = '<h1>x</h1><img src="http://cdn.example.com/a.png" alt=""><img srcset="http://cdn.example.com/b.png 2x" alt=""><a href="http://example.org">link is fine</a>';
    const onHttps = audit(page({ body })).filter((i) => i.rule === 'mixed-content');
    expect(onHttps.map((i) => i.target)).toEqual(['http://cdn.example.com/a.png', 'http://cdn.example.com/b.png']);
    expect(audit(page({ body }), 'http://example.com/').filter((i) => i.rule === 'mixed-content')).toEqual([]);
  });
});
