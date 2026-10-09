import { defineRule } from './define.ts';

const RESOURCE_ATTRIBUTES: Array<[selector: string, attribute: string]> = [
  ['img[src]', 'src'],
  ['script[src]', 'src'],
  ['link[rel~="stylesheet" i][href]', 'href'],
  ['iframe[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
  ['embed[src]', 'src'],
  ['object[data]', 'data'],
];

export const mixedContent = defineRule({
  id: 'mixed-content',
  category: 'security',
  description: 'HTTPS pages do not load resources over plain HTTP',
  check({ $, url }, report) {
    if (url.protocol !== 'https:') return;

    const insecure = new Set<string>();
    for (const [selector, attribute] of RESOURCE_ATTRIBUTES) {
      $(selector).each((_, el) => {
        const value = ($(el).attr(attribute) ?? '').trim();
        if (/^http:\/\//i.test(value)) insecure.add(value);
      });
    }
    $('img[srcset], source[srcset]').each((_, el) => {
      for (const candidate of ($(el).attr('srcset') ?? '').split(',')) {
        const value = candidate.trim().split(/\s+/)[0] ?? '';
        if (/^http:\/\//i.test(value)) insecure.add(value);
      }
    });

    for (const resource of insecure) {
      report('error', 'Resource is loaded over HTTP on an HTTPS page; browsers block or flag it', resource);
    }
  },
});
