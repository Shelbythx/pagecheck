import type { CheerioAPI } from 'cheerio';

export type Severity = 'error' | 'warning' | 'info';

export type Category = 'seo' | 'social' | 'a11y' | 'html' | 'security' | 'links' | 'performance';

export interface Issue {
  /** Id of the rule that produced the issue, e.g. `img-alt`. */
  rule: string;
  severity: Severity;
  message: string;
  /** What triggered the issue: a URL, an element snippet or a text fragment. */
  target?: string;
}

export interface Page {
  /** Final URL of the page after redirects (`file:` for local files). */
  url: URL;
  html: string;
  $: CheerioAPI;
}

export interface RuleInfo {
  id: string;
  category: Category;
  description: string;
}

/** A synchronous check that only looks at the HTML of the page. */
export interface Rule extends RuleInfo {
  check(page: Page): Issue[];
}

export type Report = (severity: Severity, message: string, target?: string) => void;

export interface ResourceInfo {
  ok: boolean;
  /** HTTP status code (absent for local files and network failures). */
  status?: number;
  /** Size in bytes, when it could be determined. */
  size?: number;
  /** Human-readable reason when the resource could not be reached. */
  error?: string;
}

export interface LoadedPage {
  url: URL;
  html: string;
  /** Issues discovered while loading, e.g. a redirect. */
  notes: Issue[];
}

/** Abstracts "where pages and resources come from": HTTP or the local file system. */
export interface Resolver {
  load(target: string): Promise<LoadedPage>;
  text(url: URL): Promise<string>;
  probe(url: URL, options: { needSize: boolean }): Promise<ResourceInfo>;
}

export interface AuditOptions {
  /** Run checks that make requests (broken links, assets, image weight). */
  network: boolean;
  /** Also request resources on other origins (CDNs, external links). */
  external: boolean;
  /** Images heavier than this are reported. */
  maxImageKb: number;
  timeoutMs: number;
  /** Max parallel requests. */
  concurrency: number;
  /** Rule ids to skip. */
  disable: string[];
  /** Directory that root-relative links (`/about`) point to when auditing local files. */
  root?: string;
}

export interface PageReport {
  url: string;
  score: number;
  counts: Record<Severity, number>;
  issues: Issue[];
  durationMs: number;
  /** Set when the page itself could not be loaded. */
  error?: string;
}
