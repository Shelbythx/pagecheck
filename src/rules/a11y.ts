import { defineRule, normalize, openingTag, truncate } from './define.ts';

export const htmlLang = defineRule({
  id: 'html-lang',
  category: 'a11y',
  description: '<html> has a lang attribute (screen readers pick pronunciation from it)',
  check({ $ }, report) {
    const lang = normalize($('html').attr('lang'));
    if (!lang) report('error', 'Missing lang attribute on <html>, e.g. <html lang="uk">');
  },
});

export const viewport = defineRule({
  id: 'viewport',
  category: 'a11y',
  description: 'Responsive viewport meta that does not block zooming',
  check({ $ }, report) {
    const meta = $('meta[name="viewport" i]');
    if (meta.length === 0) {
      return report('error', 'Missing <meta name="viewport"> — the page will render zoomed out on phones');
    }
    const content = normalize(meta.attr('content')).toLowerCase();
    if (/user-scalable\s*=\s*(no|0)\b/.test(content) || /maximum-scale\s*=\s*1(\.0+)?\b/.test(content)) {
      report('warning', 'Viewport disables pinch-zoom, which hurts users with low vision', `content="${content}"`);
    }
  },
});

export const headingOrder = defineRule({
  id: 'heading-order',
  category: 'a11y',
  description: 'Heading levels go down one step at a time (h2 → h3, not h2 → h4)',
  check({ $ }, report) {
    let previous: number | undefined;
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const level = Number(el.tagName[1]);
      if (previous !== undefined && level > previous + 1) {
        report('warning', `Heading level skipped: <h${previous}> → <h${level}>`, truncate(normalize($(el).text()), 60));
      }
      previous = level;
    });
  },
});

export const imgAlt = defineRule({
  id: 'img-alt',
  category: 'a11y',
  description: 'Every <img> has an alt attribute (alt="" for decorative images)',
  check({ $ }, report) {
    $('img:not([alt]), input[type="image" i]:not([alt])').each((_, el) => {
      report('error', 'Image is missing an alt attribute', $(el).attr('src') ?? openingTag($.html(el)));
    });
  },
});

const VAGUE_LINK_TEXT = new Set([
  'click here', 'here', 'more', 'read more', 'learn more', 'link', 'details',
  'тут', 'сюди', 'більше', 'детальніше', 'докладніше', 'читати далі', 'дізнатися більше', 'натисніть тут', 'посилання',
]);

export const linkText = defineRule({
  id: 'link-text',
  category: 'a11y',
  description: 'Links have text that makes sense out of context',
  check({ $ }, report) {
    $('a[href]').each((_, el) => {
      const link = $(el);
      const name = normalize(
        [
          link.attr('aria-label'),
          link.text(),
          link.find('img[alt]').map((_, img) => $(img).attr('alt')).get().join(' '),
          link.attr('title'),
        ].join(' '),
      );

      if (!name && !link.attr('aria-labelledby')) {
        report('warning', 'Link has no accessible text (add text, aria-label or an image with alt)', openingTag($.html(el)));
        return;
      }
      const phrase = name.toLowerCase().replace(/[.…!→»>\s]+$/u, '');
      if (VAGUE_LINK_TEXT.has(phrase)) {
        report('info', `Link text «${name}» does not say where the link goes`, link.attr('href'));
      }
    });
  },
});

export const formLabels = defineRule({
  id: 'form-labels',
  category: 'a11y',
  description: 'Form fields have a label (a placeholder is not a label)',
  check({ $ }, report) {
    const labelled = new Set($('label[for]').map((_, el) => $(el).attr('for')).get());
    const fields = $('input, select, textarea').filter((_, el) => {
      const type = ($(el).attr('type') ?? 'text').toLowerCase();
      return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
    });

    fields.each((_, el) => {
      const field = $(el);
      const id = field.attr('id');
      const hasLabel =
        normalize(field.attr('aria-label')) !== '' ||
        normalize(field.attr('aria-labelledby')) !== '' ||
        normalize(field.attr('title')) !== '' ||
        field.closest('label').length > 0 ||
        (id !== undefined && labelled.has(id));

      if (!hasLabel) {
        const hint = field.attr('placeholder') ? ' (a placeholder disappears while typing and is not a label)' : '';
        report('warning', `Form field has no label${hint}`, openingTag($.html(el)));
      }
    });
  },
});
