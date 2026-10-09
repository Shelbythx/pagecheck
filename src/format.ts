import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import type { Issue, PageReport, RuleInfo, Severity } from './types.ts';

const ICON: Record<Severity, string> = { error: '✖', warning: '▲', info: '●' };
const PAINT: Record<Severity, (text: string) => string> = { error: pc.red, warning: pc.yellow, info: pc.blue };
/** Repetitive rules (e.g. 40 images without alt) are cut to this many lines. */
const MAX_PER_RULE = 5;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function displayUrl(url: string): string {
  if (!url.startsWith('file:')) return url;
  const relative = path.relative(process.cwd(), fileURLToPath(url));
  return relative.startsWith('..') ? fileURLToPath(url) : relative || '.';
}

function paintScore(score: number): string {
  const paint = score >= 90 ? pc.green : score >= 60 ? pc.yellow : pc.red;
  return paint(pc.bold(`${score}/100`));
}

export function formatCounts(counts: Record<Severity, number>): string {
  return [
    counts.error ? pc.red(plural(counts.error, 'error')) : plural(0, 'error'),
    counts.warning ? pc.yellow(plural(counts.warning, 'warning')) : plural(0, 'warning'),
    `${counts.info} info`,
  ].join(', ');
}

export function formatPage(report: PageReport): string {
  const lines = [`${pc.bold(displayUrl(report.url))}  ${paintScore(report.score)}`, ''];

  if (report.error) {
    lines.push(`  ${pc.red(`${ICON.error} ${report.error}`)}`);
    return lines.join('\n');
  }
  if (report.issues.length === 0) {
    lines.push(`  ${pc.green('✔ No issues found')}`);
  }

  const width = Math.max(...report.issues.map((issue) => issue.rule.length), 0);
  const indent = ' '.repeat(2 + 2 + 8 + width + 2);
  // Issues arrive sorted by severity; group them by severity + rule so long runs can be collapsed.
  const groups = new Map<string, Issue[]>();
  for (const issue of report.issues) {
    const key = `${issue.severity}:${issue.rule}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }

  for (const issues of groups.values()) {
    const rule = issues[0]?.rule ?? '';
    for (const issue of issues.slice(0, MAX_PER_RULE)) {
      const paint = PAINT[issue.severity];
      lines.push(`  ${paint(ICON[issue.severity])} ${paint(issue.severity.padEnd(7))} ${pc.dim(rule.padEnd(width))}  ${issue.message}`);
      if (issue.target) lines.push(`${indent}${pc.dim(issue.target)}`);
    }
    if (issues.length > MAX_PER_RULE) {
      lines.push(`${indent}${pc.dim(`…and ${issues.length - MAX_PER_RULE} more (use --json for the full list)`)}`);
    }
  }

  lines.push('', `  ${formatCounts(report.counts)} ${pc.dim(`· ${(report.durationMs / 1000).toFixed(1)}s`)}`);
  return lines.join('\n');
}

export function formatSummary(reports: PageReport[]): string {
  const total = { error: 0, warning: 0, info: 0 };
  for (const report of reports) {
    total.error += report.counts.error;
    total.warning += report.counts.warning;
    total.info += report.counts.info;
  }
  const average = Math.round(reports.reduce((sum, r) => sum + r.score, 0) / Math.max(reports.length, 1));
  const worst = [...reports].sort((a, b) => a.score - b.score).slice(0, 5);

  const lines = [pc.bold(`Summary: ${plural(reports.length, 'page')}, average score ${paintScore(average)}`), `  ${formatCounts(total)}`];
  if (reports.length > 2) {
    lines.push('', pc.dim('  Lowest scores:'));
    for (const report of worst) lines.push(`  ${String(report.score).padStart(3)}  ${displayUrl(report.url)}`);
  }
  return lines.join('\n');
}

export function formatRules(rules: RuleInfo[]): string {
  const width = Math.max(...rules.map((rule) => rule.id.length));
  return rules.map((rule) => `${rule.id.padEnd(width)}  ${pc.dim(rule.category.padEnd(11))}  ${rule.description}`).join('\n');
}
