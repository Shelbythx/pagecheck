import { defineRule, isAbsoluteHttpUrl, normalize, truncate } from './define.ts';

export const title = defineRule({
  id: 'title',
  category: 'seo',
  description: 'Page has one <title> of 10–60 characters',
  check({ $ }, report) {
    const titles = $('head > title');
    if (titles.length === 0) return report('error', 'Missing <title> element');

    const text = normalize(titles.first().text());
    if (!text) return report('error', '<title> is empty');
    if (titles.length > 1) report('warning', `Found ${titles.length} <title> elements; browsers use only the first`);
    if (text.length < 10 || text.length > 60) {
      report('warning', `Title is ${text.length} characters (recommended 10–60)`, truncate(text));
    }
  },
});

export const metaDescription = defineRule({
  id: 'meta-description',
  category: 'seo',
  description: 'Page has a meta description of 50–160 characters',
  check({ $ }, report) {
    const metas = $('meta[name="description" i]');
    if (metas.length === 0) return report('warning', 'Missing <meta name="description">');

    const text = normalize(metas.first().attr('content'));
    if (!text) return report('warning', 'Meta description is empty');
    if (metas.length > 1) report('warning', `Found ${metas.length} meta descriptions; keep only one`);
    if (text.length < 50 || text.length > 160) {
      report('warning', `Description is ${text.length} characters (recommended 50–160)`, truncate(text));
    }
  },
});

export const canonical = defineRule({
  id: 'canonical',
  category: 'seo',
  description: 'Canonical link, if present, is single and absolute',
  check({ $ }, report) {
    const links = $('link[rel~="canonical" i]');
    if (links.length === 0) return report('info', 'No <link rel="canonical">; search engines will pick the canonical URL themselves');
    if (links.length > 1) return report('error', `Found ${links.length} canonical links; search engines may ignore all of them`);

    const href = normalize(links.attr('href'));
    if (!href) return report('error', 'Canonical link has an empty href');
    if (!isAbsoluteHttpUrl(href)) report('warning', 'Canonical URL should be absolute (https://…)', href);
  },
});

export const robots = defineRule({
  id: 'robots',
  category: 'seo',
  description: 'Page is not accidentally hidden from search engines',
  check({ $ }, report) {
    $('meta[name="robots" i], meta[name="googlebot" i]').each((_, el) => {
      const content = normalize($(el).attr('content')).toLowerCase();
      if (/\b(noindex|none)\b/.test(content)) {
        report('warning', 'Page asks search engines not to index it — make sure this is intended', `content="${content}"`);
      }
    });
  },
});

export const h1 = defineRule({
  id: 'h1',
  category: 'seo',
  description: 'Page has exactly one <h1>',
  check({ $ }, report) {
    const count = $('h1').length;
    if (count === 0) report('error', 'Page has no <h1> heading');
    else if (count > 1) report('warning', `Page has ${count} <h1> headings; one main heading is clearer for readers and search engines`);
  },
});
