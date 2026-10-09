import { load } from 'cheerio';
import { networkChecks, runNetworkChecks } from './network.ts';
import { createResolver, LoadError } from './resolver.ts';
import { staticRules } from './rules/index.ts';
import type { AuditOptions, Issue, Page, PageReport, Resolver, RuleInfo, Severity } from './types.ts';
import { USER_AGENT } from './version.ts';

export const defaultOptions: AuditOptions = {
  network: true,
  external: true,
  maxImageKb: 300,
  timeoutMs: 10_000,
  concurrency: 8,
  disable: [],
};

export const allRules: RuleInfo[] = [
  ...staticRules.map(({ id, category, description }) => ({ id, category, description })),
  ...networkChecks,
  { id: 'redirect', category: 'seo', description: 'Reports when the audited URL redirects somewhere else' },
];

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function countIssues(issues: Issue[]): Record<Severity, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

/** 100 minus 10 per error and 3 per warning. Info notes do not affect the score. */
export function scoreOf(counts: Record<Severity, number>): number {
  return Math.max(0, 100 - counts.error * 10 - counts.warning * 3);
}

export async function auditPage(
  target: string,
  options: Partial<AuditOptions> = {},
  resolver?: Resolver,
): Promise<PageReport> {
  const opts: AuditOptions = { ...defaultOptions, ...options };
  const disabled = new Set(opts.disable);
  const source = resolver ?? createResolver({ timeoutMs: opts.timeoutMs, userAgent: USER_AGENT });
  const started = performance.now();

  try {
    const loaded = await source.load(target);
    const page: Page = { url: loaded.url, html: loaded.html, $: load(loaded.html) };

    const issues: Issue[] = [...loaded.notes];
    for (const rule of staticRules) {
      if (!disabled.has(rule.id)) issues.push(...rule.check(page));
    }
    if (opts.network) issues.push(...(await runNetworkChecks(page, source, opts)));

    const kept = issues
      .filter((issue) => !disabled.has(issue.rule))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const counts = countIssues(kept);

    return {
      url: page.url.href,
      score: scoreOf(counts),
      counts,
      issues: kept,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    if (!(error instanceof LoadError)) throw error;
    return {
      url: target,
      score: 0,
      counts: { error: 1, warning: 0, info: 0 },
      issues: [{ rule: 'page-load', severity: 'error', message: error.message }],
      durationMs: Math.round(performance.now() - started),
      error: error.message,
    };
  }
}
