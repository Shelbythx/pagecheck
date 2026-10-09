import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function run(...args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { stdout: (t) => void (stdout += t), stderr: (t) => void (stderr += t) });
  return { code, stdout, stderr };
}

describe('cli', () => {
  it('prints a JSON report', async () => {
    const { code, stdout } = await run(fixture('broken.html'), '--json', '--no-network');
    const json = JSON.parse(stdout);
    expect(code).toBe(1);
    expect(json.summary.pages).toBe(1);
    expect(json.pages[0].issues.some((i: { rule: string }) => i.rule === 'img-alt')).toBe(true);
  });

  it('exits 0 for a clean page and honours --fail-on', async () => {
    expect((await run(fixture('site/index.html'), '--no-external')).code).toBe(0);
    expect((await run(fixture('broken.html'), '--no-network', '--fail-on', 'never')).code).toBe(0);
  });

  it('fails on warnings when asked to', async () => {
    const { code } = await run(fixture('site/index.html'), '--no-network', '--disable', 'canonical', '--fail-on', 'warning');
    expect(code).toBe(0);
    const strict = await run(fixture('broken.html'), '--no-network', '--disable', 'h1,img-alt,open-graph,html-lang', '--fail-on', 'warning');
    expect(strict.code).toBe(1);
  });

  it('prints a summary when auditing several pages', async () => {
    const { stdout } = await run(fixture('site/index.html'), fixture('broken.html'), '--no-network');
    expect(stdout).toContain('Summary: 2 pages');
  });

  it('rejects bad input with exit code 2', async () => {
    expect((await run()).code).toBe(2);
    expect((await run('x.html', '--fail-on', 'sometimes')).stderr).toContain('--fail-on');
    expect((await run('x.html', '--timeout', '-5')).code).toBe(2);
    expect((await run('x.html', '--disable', 'no-such-rule')).stderr).toContain('Unknown rule id');
    expect((await run('--wat')).code).toBe(2);
  });

  it('lists rules and prints help', async () => {
    expect((await run('--list-rules')).stdout).toContain('broken-links');
    expect((await run('--help')).stdout).toContain('Usage');
  });
});
