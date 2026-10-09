import type { Rule } from '../types.ts';
import { formLabels, headingOrder, htmlLang, imgAlt, linkText, viewport } from './a11y.ts';
import { anchorTargets, charset, doctype, duplicateIds } from './html.ts';
import { mixedContent } from './security.ts';
import { canonical, h1, metaDescription, robots, title } from './seo.ts';
import { favicon, openGraph, twitterCard } from './social.ts';

/** Rules that only need the HTML, in the order they appear in reports. */
export const staticRules: Rule[] = [
  title,
  metaDescription,
  h1,
  canonical,
  robots,
  openGraph,
  twitterCard,
  favicon,
  htmlLang,
  viewport,
  imgAlt,
  linkText,
  formLabels,
  headingOrder,
  doctype,
  charset,
  duplicateIds,
  anchorTargets,
  mixedContent,
];
