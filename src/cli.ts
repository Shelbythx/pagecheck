import { parseArgs } from 'node:util';
import { allRules, auditPage, countIssues, defaultOptions } from './audit.ts';
import { formatPage, formatRules, formatSummary } from './format.ts';
import { createResolver, describeError, toTargetUrl } from './resolver.ts';
import { urlsFromSitemap } from './sitemap.ts';
import type { AuditOptions, PageReport } from './types.ts';
import { USER_AGENT, VERSION } from './version.ts';

export interface IO {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIO: IO = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

type FailOn = 'error' | 'warning' | 'never';

class UsageError extends Error {}

const HELP = `pagecheck ${VERSION}
Pre-launch audit for web pages: SEO tags, Open Graph, accessibility basics,
broken links and heavy images.

Usage
  pagecheck <url-or-file...> [options]
  pagecheck --sitemap https://example.com/sitemap.xml [options]

Examples
  pagecheck https://example.com
  pagecheck dist/index.html dist/about.html --no-external
  pagecheck example.com --json > report.json
  pagecheck --sitemap https://example.com/sitemap.xml --limit 20 --fail-on warning

Options
  --json                 Print a JSON report instead of the human-readable one
  --fail-on <level>      Exit with code 1 on "error" (default), "warning" or "never"
  --no-network           Skip checks that make requests (links, assets, image weight)
  --no-external          Only request resources on the page's own origin
  --max-image-kb <n>     Image size budget in KB (default ${defaultOptions.maxImageKb})
  --timeout <ms>         Timeout per request (default ${defaultOptions.timeoutMs})
  --concurrency <n>      Parallel requests per page (default ${defaultOptions.concurrency})
  --disable <ids>        Comma-separated rule ids to skip, e.g. --disable twitter-card,favicon
  --root <dir>           Folder that "/…" links point to when auditing local files
  --sitemap <url>        Audit the pages listed in a sitemap.xml
  --limit <n>            Max pages to take from the sitemap (default 50)
  --user-agent <ua>      Custom User-Agent header
  --list-rules           Show every rule with its id and exit
  -v, --version          Show version
  -h, --help             Show this help

Exit codes: 0 = passed, 1 = issues at or above --fail-on, 2 = usage error
`;

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new UsageError(`--${name} must be a positive integer, got "${value}"`);
  return number;
}

export function shouldFail(reports: PageReport[], failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  return reports.some((r) => r.counts.error > 0 || (failOn === 'warning' && r.counts.warning > 0));
}

export async function main(argv: string[], io: IO = processIO): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        json: { type: 'boolean', default: false },
        'fail-on': { type: 'string', default: 'error' },
        network: { type: 'boolean', default: true },
        external: { type: 'boolean', default: true },
        'max-image-kb': { type: 'string' },
        timeout: { type: 'string' },
        concurrency: { type: 'string' },
        disable: { type: 'string', multiple: true },
        root: { type: 'string' },
        sitemap: { type: 'string' },
        limit: { type: 'string' },
        'user-agent': { type: 'string' },
        'list-rules': { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });

    const info = values.help ? HELP : values.version ? `${VERSION}\n` : values['list-rules'] ? `${formatRules(allRules)}\n` : '';
    if (info) {
      io.stdout(info);
      return 0;
    }

    const failOn = values['fail-on'] as FailOn;
    if (!['error', 'warning', 'never'].includes(failOn)) {
      throw new UsageError(`--fail-on must be "error", "warning" or "never", got "${failOn}"`);
    }

    const disable = (values.disable ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    const unknown = disable.filter((id) => !allRules.some((rule) => rule.id === id));
    if (unknown.length) throw new UsageError(`Unknown rule id: ${unknown.join(', ')}. Run pagecheck --list-rules to see them all.`);

    const options: AuditOptions = {
      network: values.network,
      external: values.external,
      maxImageKb: positiveInt('max-image-kb', values['max-image-kb'], defaultOptions.maxImageKb),
      timeoutMs: positiveInt('timeout', values.timeout, defaultOptions.timeoutMs),
      concurrency: positiveInt('concurrency', values.concurrency, defaultOptions.concurrency),
      disable,
      ...(values.root ? { root: values.root } : {}),
    };
    const resolver = createResolver({ timeoutMs: options.timeoutMs, userAgent: values['user-agent'] ?? USER_AGENT });

    const targets = [...positionals];
    if (values.sitemap) {
      const limit = positiveInt('limit', values.limit, 50);
      try {
        targets.push(...(await urlsFromSitemap(toTargetUrl(values.sitemap), resolver, limit)));
      } catch (error) {
        throw new UsageError(`Could not read sitemap ${values.sitemap}: ${describeError(error, options.timeoutMs)}`);
      }
    }
    if (targets.length === 0) throw new UsageError('Give at least one URL or file to audit, e.g. pagecheck https://example.com');

    const reports: PageReport[] = [];
    for (const target of targets) {
      const report = await auditPage(target, options, resolver);
      reports.push(report);
      if (!values.json) io.stdout(`${formatPage(report)}\n\n`);
    }

    if (values.json) {
      const summary = { pages: reports.length, ...countIssues(reports.flatMap((r) => r.issues)) };
      io.stdout(`${JSON.stringify({ version: VERSION, summary, pages: reports }, null, 2)}\n`);
    } else if (reports.length > 1) {
      io.stdout(`${formatSummary(reports)}\n`);
    }

    return shouldFail(reports, failOn) ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr(`pagecheck: ${(error as Error).message}\nRun pagecheck --help for usage.\n`);
      return 2;
    }
    throw error;
  }
}
