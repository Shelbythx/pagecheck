import { defineRule, openingTag } from './define.ts';

export const doctype = defineRule({
  id: 'doctype',
  category: 'html',
  description: 'Document starts with <!doctype html> (otherwise browsers use quirks mode)',
  check({ html }, report) {
    const withoutBomAndComments = html.replace(/^﻿/, '').replace(/^(\s*<!--[\s\S]*?-->)*\s*/, '');
    if (!/^<!doctype html\s*>/i.test(withoutBomAndComments)) {
      report('warning', 'Missing <!doctype html>; the page renders in quirks mode');
    }
  },
});

export const charset = defineRule({
  id: 'charset',
  category: 'html',
  description: 'Character encoding is declared (prevents garbled Cyrillic)',
  check({ $ }, report) {
    const declared = $('meta[charset]').length > 0 || $('meta[http-equiv="content-type" i]').length > 0;
    if (!declared) report('warning', 'Missing <meta charset="utf-8">; non-Latin text may render as garbage');
  },
});

export const duplicateIds = defineRule({
  id: 'duplicate-ids',
  category: 'html',
  description: 'id attributes are unique',
  check({ $ }, report) {
    const counts = new Map<string, number>();
    $('[id]').each((_, el) => {
      const id = $(el).attr('id') ?? '';
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    for (const [id, count] of counts) {
      if (count > 1) report('warning', `id="${id}" is used ${count} times; labels, anchors and scripts will only find the first`);
    }
  },
});

export const anchorTargets = defineRule({
  id: 'anchor-targets',
  category: 'html',
  description: 'In-page links (#section) point to an existing element',
  check({ $ }, report) {
    const targets = new Set<string>();
    $('[id]').each((_, el) => void targets.add($(el).attr('id') ?? ''));
    $('a[name]').each((_, el) => void targets.add($(el).attr('name') ?? ''));

    $('a[href^="#"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (href === '#' || href.startsWith('#!') || href.toLowerCase() === '#top') return;
      let fragment = href.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // keep the raw fragment if it is not valid percent-encoding
      }
      if (!targets.has(fragment)) report('warning', `Link points to #${fragment}, but no element has that id`, openingTag($.html(el)));
    });
  },
});
