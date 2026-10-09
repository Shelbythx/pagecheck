# pagecheck

[![CI](https://github.com/Shelbythx/pagecheck/actions/workflows/ci.yml/badge.svg)](https://github.com/Shelbythx/pagecheck/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**A pre-launch check for web pages, in one command.** pagecheck catches the things that slip through right before a site goes live: a missing `og:image` that leaves Telegram previews blank, a 1.5 MB hero photo, a link to a page you renamed, a form field with only a placeholder.

It works on live URLs, on a local dev server, and on built HTML files, so you can run it in CI before deploying.

```text
$ pagecheck http://localhost:3000

http://localhost:3000/  68/100

  ✖ error   img-alt        Image is missing an alt attribute
                           /img/pumpkin-latte.png
  ✖ error   broken-links   Broken link (HTTP 404)
                           http://localhost:3000/prices
  ▲ warning open-graph     Missing og:image — shared links will have no preview picture
  ▲ warning form-labels    Form field has no label (a placeholder disappears while typing and is not a label)
                           <input type="tel" name="phone" placeholder="Ваш телефон">
  ▲ warning heading-order  Heading level skipped: <h2> → <h4>
                           Сезонні напої
  ▲ warning image-weight   Image weighs 1445 KB (budget 300 KB); compress it or serve WebP/AVIF
                           http://localhost:3000/img/hero.jpg
  ● info    open-graph     Missing og:description
  ● info    link-text      Link text «Детальніше» does not say where the link goes
                           /prices

  2 errors, 4 warnings, 2 info · 0.1s
```

## Why not just Lighthouse?

Lighthouse is great, but it needs Chrome, takes a while per page and mostly scores performance. pagecheck is a small Node CLI with no browser: markup checks take milliseconds, links are probed in parallel, every problem gets one line with the exact element to fix, and the exit code is CI-friendly. Use both.

## Features

- **23 checks** across SEO, link previews, accessibility, HTML validity, security and performance ([full list](#rules))
- **Live URLs, local servers and files.** `pagecheck dist/` audits `dist/index.html`; root-relative links like `/about` are resolved against the folder, including `about.html` and `about/index.html`
- **Broken link and asset detection** with parallel requests, per-run caching, and a HEAD → GET fallback for servers that reject HEAD
- **Whole sites via sitemap.xml**, including sitemap index files
- **Ukrainian-aware**: flags vague link text like «Детальніше» or «тут», and warns when a missing charset would garble Cyrillic
- **JSON output and exit codes** for CI pipelines
- **Typed programmatic API** if you want to build on top of it

## Install

```bash
# from GitHub
npm install -g github:Shelbythx/pagecheck

# or clone and link
git clone https://github.com/Shelbythx/pagecheck && cd pagecheck
npm install && npm link
```

Requires Node.js 22 or newer.

## Usage

```bash
pagecheck https://example.com                  # one page
pagecheck example.com about.example.com        # several; "https://" is optional
pagecheck dist/index.html dist/contacts.html   # built files
pagecheck dist/ --no-external                  # offline: skip CDNs and external links
pagecheck --sitemap https://example.com/sitemap.xml --limit 20
pagecheck https://example.com --json > report.json
```

| Option | Default | Description |
| --- | --- | --- |
| `--json` | | Print a JSON report instead of the human-readable one |
| `--fail-on <level>` | `error` | Exit with code 1 on `error`, `warning`, or `never` |
| `--no-network` | | Skip checks that make requests (links, assets, image weight) |
| `--no-external` | | Only request resources on the page's own origin |
| `--max-image-kb <n>` | `300` | Image size budget |
| `--timeout <ms>` | `10000` | Timeout per request |
| `--concurrency <n>` | `8` | Parallel requests per page |
| `--disable <ids>` | | Comma-separated rule ids to skip |
| `--root <dir>` | page's folder | Where `/…` links point when auditing local files |
| `--sitemap <url>` | | Audit pages listed in a sitemap (URL or local file) |
| `--limit <n>` | `50` | Max pages to take from the sitemap |
| `--user-agent <ua>` | `pagecheck/<version>` | Custom User-Agent header |
| `--list-rules` | | Print all rules |

**Exit codes:** `0` passed, `1` found issues at or above `--fail-on`, `2` usage error.

**Scoring:** each page starts at 100 and loses 10 points per error and 3 per warning. Info notes do not cost points.

## Rules

| Id | Category | Severity | What it checks |
| --- | --- | --- | --- |
| `title` | SEO | error / warning | `<title>` exists and is 10–60 characters |
| `meta-description` | SEO | warning | Meta description exists and is 50–160 characters |
| `h1` | SEO | error / warning | Exactly one `<h1>` |
| `canonical` | SEO | error / warning / info | Canonical link is single and absolute |
| `robots` | SEO | warning | Page is not accidentally `noindex` |
| `redirect` | SEO | info | The audited URL redirects somewhere else |
| `open-graph` | Social | error / warning / info | `og:title`, `og:description`, absolute `og:image` |
| `twitter-card` | Social | info | `twitter:card` is set |
| `favicon` | Social | info | `<link rel="icon">` is declared |
| `html-lang` | A11y | error | `<html lang>` is set |
| `viewport` | A11y | error / warning | Responsive viewport that allows zooming |
| `img-alt` | A11y | error | Every image has an `alt` attribute |
| `link-text` | A11y | warning / info | Links have meaningful text (EN + UK phrase list) |
| `form-labels` | A11y | warning | Inputs have a label, `aria-label` or `title` |
| `heading-order` | A11y | warning | Heading levels are not skipped |
| `doctype` | HTML | warning | `<!doctype html>` is present |
| `charset` | HTML | warning | Encoding is declared |
| `duplicate-ids` | HTML | warning | `id` values are unique |
| `anchor-targets` | HTML | warning | `#section` links point to an existing id |
| `mixed-content` | Security | error | No `http://` resources on HTTPS pages |
| `broken-links` | Links | error / warning | Links do not return 404 or fail (external non-404 failures are warnings, because many sites block bots) |
| `broken-assets` | Links | error | Images, scripts, styles, icons and `og:image` load |
| `image-weight` | Performance | warning | Images fit the size budget |

## Use in CI

Audit the build output before deploying:

```yaml
# .github/workflows/deploy.yml
- run: npm run build
- run: npx --yes github:Shelbythx/pagecheck dist/ --no-external --fail-on error
```

Or audit production on a schedule and keep the JSON as an artifact:

```yaml
- run: npx --yes github:Shelbythx/pagecheck --sitemap https://example.com/sitemap.xml --json > pagecheck.json
- uses: actions/upload-artifact@v4
  with:
    name: pagecheck-report
    path: pagecheck.json
```

## Programmatic API

```ts
import { auditPage } from 'pagecheck';

const report = await auditPage('https://example.com', { maxImageKb: 200, disable: ['twitter-card'] });

console.log(report.score); // 87
for (const issue of report.issues) {
  console.log(issue.severity, issue.rule, issue.message, issue.target);
}
```

## How it works

```text
            ┌─────────────┐   load(target)    ┌──────────────────────────┐
 CLI ─────▶ │   audit.ts  │ ────────────────▶ │ Resolver                 │
            │             │                   │  http: fetch + timeout   │
            │ static rules│ ◀──── HTML ────── │  file: fs, index.html,   │
            │ (cheerio)   │                   │        about → about.html│
            │             │   probe(url)      │  cache: one request/URL  │
            │ network     │ ────────────────▶ │  HEAD, GET on fallback   │
            │ checks      │  (mapLimit, 8)    └──────────────────────────┘
            └─────────────┘
```

- **Static rules** (`src/rules/`) are pure functions of the parsed HTML. Each is around 10–20 lines and is tested on small HTML snippets.
- **Network checks** (`src/network.ts`) collect every link and asset, deduplicate them, and probe them through a `Resolver` with limited concurrency.
- **The `Resolver` interface** hides whether a page comes from HTTP or the file system. That is what lets the same checks run on `dist/` and in production, and it makes the network code testable with a local server.

### Adding a rule

```ts
// src/rules/seo.ts
export const metaKeywords = defineRule({
  id: 'meta-keywords',
  category: 'seo',
  description: 'Meta keywords are ignored by search engines',
  check({ $ }, report) {
    if ($('meta[name="keywords" i]').length) report('info', 'Meta keywords are ignored by Google and Bing');
  },
});
```

Then add it to `staticRules` in `src/rules/index.ts` and write a test in `test/rules.test.ts`.

## Development

```bash
npm install
npm run dev -- https://example.com   # runs src/ directly (Node 22.18+ strips types natively)
npm test                             # vitest: rules, local HTTP server, file system, CLI
npm run typecheck
npm run build                        # emits dist/
```

## Roadmap

- `pagecheck.config.json` for per-project defaults and rule severity overrides
- HTML report with filters
- `--crawl` mode that follows internal links instead of needing a sitemap

## License

[MIT](LICENSE) © Svyatoslav Maliuga
