import { readFileSync } from 'node:fs';

// Works from both src/ (development) and dist/ (published package).
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export const VERSION = pkg.version;
export const USER_AGENT = `pagecheck/${VERSION} (+https://github.com/Shelbythx/pagecheck)`;
