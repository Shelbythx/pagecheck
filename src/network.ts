import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditOptions, Issue, Page, Resolver, RuleInfo } from './types.ts';

export const networkChecks: RuleInfo[] = [
  { id: 'broken-links', category: 'links', description: 'Links (<a href>) do not lead to 404s or dead hosts' },
  { id: 'broken-assets', category: 'links', description: 'Images, scripts, stylesheets, icons and og:image load' },
  { id: 'image-weight', category: 'performance', description: 'Images stay under the size budget (--max-image-kb)' },
];

interface Target {
  url: URL;
  /** The reference exactly as written in the HTML, for reporting. */
  ref: string;
  link: boolean;
  asset: boolean;
  image: boolean;
}

/** Runs async work over items with at most `limit` tasks in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Resolves an href/src against the page. Returns undefined for references that
 * cannot be requested (mailto:, tel:, javascript:, in-page anchors…).
 * For local files, root-relative paths (`/img/a.png`) resolve against `root`.
 */
export function resolveReference(ref: string, base: URL, root?: URL): URL | undefined {
  const value = ref.trim();
  if (!value || value.startsWith('#')) return undefined;

  let url: URL;
  try {
    if (base.protocol === 'file:' && value.startsWith('//')) url = new URL(`https:${value}`);
    else if (base.protocol === 'file:' && root && value.startsWith('/')) url = new URL(`.${value}`, root);
    else url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) return undefined;
  url.hash = '';
  return url;
}

function isExternal(url: URL, page: URL): boolean {
  return page.protocol === 'file:' ? url.protocol !== 'file:' : url.origin !== page.origin;
}

function collectTargets(page: Page, root: URL | undefined): Target[] {
  const { $ } = page;
  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? new URL(baseHref, page.url) : page.url;
  const pageWithoutHash = page.url.href.split('#')[0];
  const targets = new Map<string, Target>();

  const add = (ref: string | undefined, kind: 'link' | 'asset' | 'image') => {
    if (!ref) return;
    const url = resolveReference(ref, base, root);
    if (!url) return;
    if (kind === 'link' && url.href === pageWithoutHash) return;

    const target = targets.get(url.href) ?? { url, ref: ref.trim(), link: false, asset: false, image: false };
    if (kind === 'link') target.link = true;
    else target.asset = true;
    if (kind === 'image') target.image = true;
    targets.set(url.href, target);
  };

  $('a[href], area[href]').each((_, el) => add($(el).attr('href'), 'link'));
  $('img[src]').each((_, el) => add($(el).attr('src'), 'image'));
  $('script[src]').each((_, el) => add($(el).attr('src'), 'asset'));
  $('link[href]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    if (/\b(stylesheet|icon|apple-touch-icon|manifest)\b/.test(rel)) add($(el).attr('href'), 'asset');
  });
  add($('meta[property="og:image" i], meta[name="og:image" i]').first().attr('content'), 'image');

  return [...targets.values()];
}

export async function runNetworkChecks(page: Page, resolver: Resolver, options: AuditOptions): Promise<Issue[]> {
  const disabled = new Set(options.disable);
  const checkLinks = !disabled.has('broken-links');
  const checkAssets = !disabled.has('broken-assets');
  const checkWeight = !disabled.has('image-weight');
  if (!checkLinks && !checkAssets && !checkWeight) return [];

  const root =
    page.url.protocol === 'file:'
      ? options.root
        ? pathToFileURL(path.resolve(options.root) + path.sep)
        : new URL('.', page.url)
      : undefined;

  const targets = collectTargets(page, root).filter(
    (t) =>
      (options.external || !isExternal(t.url, page.url)) &&
      ((t.link && checkLinks) || (t.asset && checkAssets) || (t.image && checkWeight)),
  );

  const results = await mapLimit(targets, options.concurrency, (t) =>
    resolver.probe(t.url, { needSize: t.image && checkWeight }),
  );

  const issues: Issue[] = [];
  const maxBytes = options.maxImageKb * 1024;

  targets.forEach((target, index) => {
    const info = results[index];
    if (!info) return;
    const shown = target.url.protocol === 'file:' ? target.ref : target.url.href;
    const reason = info.status ? `HTTP ${info.status}` : (info.error ?? 'unreachable');

    if (!info.ok) {
      if (target.asset && checkAssets) {
        issues.push({ rule: 'broken-assets', severity: 'error', message: `${target.image ? 'Image' : 'Resource'} failed to load (${reason})`, target: shown });
      } else if (target.link && checkLinks) {
        const external = isExternal(target.url, page.url);
        const definitelyGone = info.status === 404 || info.status === 410;
        issues.push(
          !external || definitelyGone
            ? { rule: 'broken-links', severity: 'error', message: `Broken link (${reason})`, target: shown }
            : {
                rule: 'broken-links',
                severity: 'warning',
                message: `External link answered ${reason}; some sites block automated checks, so verify it by hand`,
                target: shown,
              },
        );
      }
      return;
    }

    if (target.image && checkWeight && info.size !== undefined && info.size > maxBytes) {
      issues.push({
        rule: 'image-weight',
        severity: 'warning',
        message: `Image weighs ${Math.round(info.size / 1024)} KB (budget ${options.maxImageKb} KB); compress it or serve WebP/AVIF`,
        target: shown,
      });
    }
  });

  return issues;
}
