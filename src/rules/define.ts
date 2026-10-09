import type { Issue, Page, Report, Rule, RuleInfo } from '../types.ts';

/**
 * Wraps a rule body so it can report issues through a callback instead of
 * building issue objects by hand.
 */
export function defineRule(def: RuleInfo & { check(page: Page, report: Report): void }): Rule {
  const { check, ...info } = def;
  return {
    ...info,
    check(page) {
      const issues: Issue[] = [];
      check(page, (severity, message, target) => {
        issues.push(target ? { rule: info.id, severity, message, target } : { rule: info.id, severity, message });
      });
      return issues;
    },
  };
}

/** Collapses whitespace the way a browser renders text. */
export function normalize(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Shortens long strings for terminal output. */
export function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Opening tag of an element, e.g. `<img src="/hero.jpg" class="hero">`. */
export function openingTag(html: string): string {
  const end = html.indexOf('>');
  return truncate(normalize(end === -1 ? html : html.slice(0, end + 1)), 100);
}

/** Reads `<meta property="…">` or `<meta name="…">`, whichever is present. */
export function metaContent(page: Page, key: string): string | undefined {
  const { $ } = page;
  const el = $(`meta[property="${key}" i], meta[name="${key}" i]`).first();
  return el.length ? normalize(el.attr('content')) : undefined;
}

export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
