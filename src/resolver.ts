import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LoadedPage, Resolver, ResourceInfo } from './types.ts';

/** Thrown when the audited page itself cannot be loaded. */
export class LoadError extends Error {
  override name = 'LoadError';
}

export interface ResolverOptions {
  timeoutMs: number;
  userAgent: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Turns what the user typed into a URL: `https://…` stays as is, an existing
 * path becomes a `file:` URL and `example.com` is treated as `https://example.com`.
 */
export function toTargetUrl(target: string, cwd = process.cwd()): URL {
  if (/^(https?|file):/i.test(target)) return new URL(target);
  const local = path.resolve(cwd, target);
  if (!existsSync(local) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(target)) return new URL(`https://${target}`);
  return pathToFileURL(local);
}

export function describeError(error: unknown, timeoutMs?: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return timeoutMs ? `timed out after ${timeoutMs} ms` : 'timed out';
    }
    const code = (error.cause as { code?: string } | undefined)?.code;
    if (code) return code;
    return error.message;
  }
  return String(error);
}

export function createResolver(options: ResolverOptions): Resolver {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = { 'user-agent': options.userAgent };
  const cache = new Map<string, Promise<ResourceInfo>>();

  const request = (url: URL, method: 'GET' | 'HEAD', accept = '*/*') =>
    fetchImpl(url, {
      method,
      headers: { ...headers, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs),
    });

  async function loadHttp(url: URL): Promise<LoadedPage> {
    let response: Response;
    try {
      response = await request(url, 'GET', 'text/html,application/xhtml+xml');
    } catch (error) {
      throw new LoadError(`Could not reach ${url.href}: ${describeError(error, options.timeoutMs)}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new LoadError(`${url.href} responded with HTTP ${response.status}`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (type && !/html/i.test(type)) {
      await response.body?.cancel();
      throw new LoadError(`${url.href} is not an HTML page (content-type: ${type})`);
    }

    const finalUrl = new URL(response.url || url.href);
    const notes =
      finalUrl.href !== url.href
        ? [{ rule: 'redirect', severity: 'info' as const, message: 'Requested URL redirects; link to the final address directly', target: `${url.href} → ${finalUrl.href}` }]
        : [];
    return { url: finalUrl, html: await response.text(), notes };
  }

  async function loadFile(url: URL): Promise<LoadedPage> {
    let filePath = fileURLToPath(url);
    const info = await stat(filePath).catch(() => null);
    if (!info) throw new LoadError(`File not found: ${filePath}`);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    try {
      return { url: pathToFileURL(filePath), html: await readFile(filePath, 'utf8'), notes: [] };
    } catch {
      throw new LoadError(`Could not read ${filePath}`);
    }
  }

  async function probeHttp(url: URL, needSize: boolean): Promise<ResourceInfo> {
    try {
      let response = await request(url, 'HEAD');
      let length = response.headers.get('content-length');

      // Plenty of servers answer HEAD with 403/404/405 although GET works,
      // and some omit Content-Length. Confirm with a real GET in those cases.
      if (!response.ok || (needSize && !length)) {
        response = await request(url, 'GET');
        length = response.headers.get('content-length');
        if (response.ok && needSize && !length) {
          const size = (await response.arrayBuffer()).byteLength;
          return { ok: true, status: response.status, size };
        }
        await response.body?.cancel();
      }

      const size = length ? Number(length) : undefined;
      return size !== undefined && Number.isFinite(size)
        ? { ok: response.ok, status: response.status, size }
        : { ok: response.ok, status: response.status };
    } catch (error) {
      return { ok: false, error: describeError(error, options.timeoutMs) };
    }
  }

  async function findFile(filePath: string): Promise<{ size: number } | null> {
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile()) return { size: info.size };
    if (info?.isDirectory()) return findFile(path.join(filePath, 'index.html'));
    // Static hosts usually serve /about from about.html
    if (!info && !path.extname(filePath)) return findFile(`${filePath}.html`);
    return null;
  }

  async function probeFile(url: URL): Promise<ResourceInfo> {
    const clean = new URL(url.href);
    clean.search = '';
    const found = await findFile(fileURLToPath(clean));
    return found ? { ok: true, size: found.size } : { ok: false, error: 'file not found' };
  }

  return {
    load(target) {
      const url = toTargetUrl(target);
      return url.protocol === 'file:' ? loadFile(url) : loadHttp(url);
    },

    async text(url) {
      if (url.protocol === 'file:') return readFile(fileURLToPath(url), 'utf8');
      const response = await request(url, 'GET');
      if (!response.ok) throw new LoadError(`${url.href} responded with HTTP ${response.status}`);
      return response.text();
    },

    probe(url, { needSize }) {
      const key = `${needSize ? 'size' : 'head'} ${url.href.split('#')[0]}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = url.protocol === 'file:' ? probeFile(url) : probeHttp(url, needSize);
        cache.set(key, pending);
      }
      return pending;
    },
  };
}
