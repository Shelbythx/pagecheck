import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPage } from '../src/audit.ts';
import { mapLimit, resolveReference } from '../src/network.ts';
import { createResolver } from '../src/resolver.ts';
import { urlsFromSitemap } from '../src/sitemap.ts';

const BIG_IMAGE = Buffer.alloc(400 * 1024);
const SMALL_IMAGE = Buffer.alloc(2 * 1024);

let server: Server;
let origin: string;

const pageHtml = () => `<!doctype html><html lang="en"><head><title>Test page</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/missing.js"></script>
</head><body><h1>Test</h1>
  <a href="/ok">ok</a>
  <a href="/ok#section">same target, different hash</a>
  <a href="/gone">gone</a>
  <a href="/head-not-allowed">HEAD rejected</a>
  <a href="/redirect">redirect</a>
  <a href="mailto:hi@example.com">mail</a>
  <a href="tel:+380000000000">phone</a>
  <a href="#">top</a>
  <img src="/big.jpg" alt="">
  <img src="/small.png" alt="">
  <img src="/chunked.jpg" alt="">
</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (status: number, body: Buffer | string, type: string, length = true) => {
      const buffer = typeof body === 'string' ? Buffer.from(body) : body;
      res.writeHead(status, length ? { 'content-type': type, 'content-length': buffer.length } : { 'content-type': type });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    };
    switch (req.url) {
      case '/':
        return send(200, pageHtml(), 'text/html; charset=utf-8');
      case '/ok':
      case '/style.css':
        return send(200, 'ok', 'text/plain');
      case '/head-not-allowed':
        return req.method === 'HEAD' ? send(405, '', 'text/plain') : send(200, 'fine', 'text/plain');
      case '/redirect':
        res.writeHead(301, { location: '/ok' });
        return res.end();
      case '/old-home':
        res.writeHead(301, { location: '/' });
        return res.end();
      case '/big.jpg':
        return send(200, BIG_IMAGE, 'image/jpeg');
      case '/small.png':
        return send(200, SMALL_IMAGE, 'image/png');
      case '/chunked.jpg':
        // No Content-Length: forces a GET that measures the body
        return send(200, BIG_IMAGE, 'image/jpeg', false);
      case '/data.json':
        return send(200, '{}', 'application/json');
      case '/sitemap.xml':
        return send(200, `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/pages.xml</loc></sitemap></sitemapindex>`, 'application/xml');
      case '/pages.xml':
        return send(
          200,
          `<urlset><url><loc>${origin}/</loc></url><url><loc><![CDATA[${origin}/ok?a=1&b=2]]></loc></url><url><loc>${origin}/ok?x=1&amp;y=2</loc></url></urlset>`,
          'application/xml',
        );
      default:
        return send(404, 'not found', 'text/plain');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('network checks over HTTP', () => {
  it('finds broken links and assets, and measures image weight', async () => {
    const report = await auditPage(`${origin}/`, { maxImageKb: 300 });
    const found = report.issues
      .filter((i) => ['broken-links', 'broken-assets', 'image-weight'].includes(i.rule))
      .map((i) => `${i.rule}:${i.target?.replace(origin, '')}`)
      .sort();

    expect(found).toEqual([
      'broken-assets:/missing.js',
      'broken-links:/gone',
      'image-weight:/big.jpg',
      'image-weight:/chunked.jpg',
    ]);
  });

  it('respects --disable and --no-network', async () => {
    const report = await auditPage(`${origin}/`, { disable: ['image-weight', 'broken-assets'] });
    expect(report.issues.map((i) => i.rule)).not.toContain('image-weight');
    expect(report.issues.map((i) => i.rule)).not.toContain('broken-assets');

    const offline = await auditPage(`${origin}/`, { network: false });
    expect(offline.issues.map((i) => i.rule)).not.toContain('broken-links');
  });

  it('reports redirects of the audited URL', async () => {
    const report = await auditPage(`${origin}/old-home`);
    expect(report.url).toBe(`${origin}/`);
    expect(report.issues).toContainEqual(expect.objectContaining({ rule: 'redirect', severity: 'info' }));
  });

  it('turns load failures into a failed report instead of throwing', async () => {
    const missing = await auditPage(`${origin}/nope`);
    expect(missing.error).toMatch(/HTTP 404/);
    expect(missing.score).toBe(0);

    const notHtml = await auditPage(`${origin}/data.json`);
    expect(notHtml.error).toMatch(/not an HTML page/);
  });

  it('probes each URL once per resolver', async () => {
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls++;
      return fetch(input, init);
    };
    const resolver = createResolver({ timeoutMs: 5000, userAgent: 'test', fetch: counting });
    await Promise.all([1, 2, 3].map(() => resolver.probe(new URL(`${origin}/ok`), { needSize: false })));
    expect(calls).toBe(1);
  });

  it('reads sitemap indexes and decodes entities', async () => {
    const resolver = createResolver({ timeoutMs: 5000, userAgent: 'test' });
    const urls = await urlsFromSitemap(new URL(`${origin}/sitemap.xml`), resolver, 10);
    expect(urls).toEqual([`${origin}/`, `${origin}/ok?a=1&b=2`, `${origin}/ok?x=1&y=2`]);
    expect(await urlsFromSitemap(new URL(`${origin}/sitemap.xml`), resolver, 1)).toHaveLength(1);
  });
});

describe('local files', () => {
  const site = fileURLToPath(new URL('./fixtures/site/', import.meta.url));

  it('resolves root-relative links, folders and extensionless pages', async () => {
    const report = await auditPage(`${site}index.html`, { external: false });
    expect(report.issues).toEqual([]);
    expect(report.score).toBe(100);
  });

  it('accepts a folder and audits its index.html', async () => {
    const report = await auditPage(site, { external: false });
    expect(report.url.endsWith('/site/index.html')).toBe(true);
  });

  it('reports missing local files', async () => {
    const report = await auditPage(fileURLToPath(new URL('./fixtures/broken.html', import.meta.url)), { external: false });
    const broken = report.issues.filter((i) => i.rule.startsWith('broken-')).map((i) => i.target).sort();
    expect(broken).toEqual(['/nowhere', '/og.png', '/pricing', 'hero.jpg', 'missing.png']);
  });
});

describe('helpers', () => {
  const base = new URL('https://example.com/blog/post');

  it('resolves only requestable references', () => {
    expect(resolveReference('../img/a.png', base)?.href).toBe('https://example.com/img/a.png');
    expect(resolveReference('/a#b', base)?.href).toBe('https://example.com/a');
    for (const ref of ['#top', 'mailto:a@b.c', 'tel:123', 'javascript:void(0)', 'tg://resolve?domain=x', '', '  ']) {
      expect(resolveReference(ref, base)).toBeUndefined();
    }
  });

  it('maps protocol-relative URLs to https for local files', () => {
    expect(resolveReference('//cdn.example.com/x.js', new URL('file:///site/index.html'))?.href).toBe('https://cdn.example.com/x.js');
  });

  it('limits concurrency', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
