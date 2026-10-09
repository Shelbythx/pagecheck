import { defineRule, isAbsoluteHttpUrl, metaContent } from './define.ts';

export const openGraph = defineRule({
  id: 'open-graph',
  category: 'social',
  description: 'Open Graph tags for link previews in Telegram, Facebook, LinkedIn, Viber…',
  check(page, report) {
    if (!metaContent(page, 'og:title')) report('warning', 'Missing og:title — link previews will fall back to <title> or show nothing');
    if (!metaContent(page, 'og:description')) report('info', 'Missing og:description');

    const image = metaContent(page, 'og:image');
    if (!image) report('warning', 'Missing og:image — shared links will have no preview picture');
    else if (!isAbsoluteHttpUrl(image)) report('error', 'og:image must be an absolute URL, otherwise most platforms ignore it', image);

    const url = metaContent(page, 'og:url');
    if (url && !isAbsoluteHttpUrl(url)) report('warning', 'og:url should be an absolute URL', url);
  },
});

export const twitterCard = defineRule({
  id: 'twitter-card',
  category: 'social',
  description: 'twitter:card is set so X/Twitter shows a large preview',
  check(page, report) {
    if (!metaContent(page, 'twitter:card')) report('info', 'Missing twitter:card (e.g. "summary_large_image")');
  },
});

export const favicon = defineRule({
  id: 'favicon',
  category: 'social',
  description: 'Page declares a favicon',
  check({ $ }, report) {
    if ($('link[rel~="icon" i]').length === 0) {
      report('info', 'No <link rel="icon">; browsers will request /favicon.ico and show a blank tab icon if it is missing');
    }
  },
});
