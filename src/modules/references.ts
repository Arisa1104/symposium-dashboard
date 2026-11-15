/**
 * Reference Formatter module
 * Parses academic references from Word (.docx), rich Word/Docs clipboard HTML, or plain/markdown text
 * and formats them into CMS Joomla HTML (<ol class="references">) using the shared Article Formatter engine.
 */

import {
  detectReferenceListStyle,
  formatReferenceCitation,
  isReferenceHeading,
  mergeAdjacentInlineTags,
  segmentReferenceEntries,
  type DetectedStyleSummary,
  type RawReferenceLine,
  type ReferenceStyle,
} from './article-formatter';

const DOI_REGEX = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)(10\.\d{4,9}\/(?:(?!https?:\/\/|doi:\s*10\.)[^\s<>"'])+)/i;

export interface FormatReferencesOptions {
  includeHeading?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#8209;|&#x2011;/gi, '-')
    .replace(/&#8211;|&#x2013;|&ndash;/gi, '–')
    .replace(/&#8212;|&#x2014;|&mdash;/gi, '—')
    .replace(/&#8216;|&#x2018;|&lsquo;/gi, '‘')
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, '’')
    .replace(/&#8220;|&#x201c;|&ldquo;/gi, '“')
    .replace(/&#8221;|&#x201d;|&rdquo;/gi, '”')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function sanitizeInlineReferenceHtml(raw: string): string {
  // Normalize <i> / <em> / <cite> tags first
  let cleaned = raw
    .replace(/<\s*(?:i|em|cite)\b[^>]*>([\s\S]*?)<\s*\/\s*(?:i|em|cite)\s*>/gi, '<em>$1</em>');

  // Protect <a href="...">...</a> and bare URLs BEFORE converting *italic* markers
  const urlTokens: string[] = [];
  cleaned = cleaned.replace(
    /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>|https?:\/\/[^\s<>"']+/gi,
    (match, dqHref, sqHref, inner) => {
      const id = `\u0000URL${urlTokens.length}\u0000`;
      if (dqHref || sqHref) {
        const cleanHref = (dqHref || sqHref).replace(/[\r\n\s]+/g, '');
        const innerSanitized = inner
          .replace(/<\s*(?:i|em|cite)\b[^>]*>([\s\S]*?)<\s*\/\s*(?:i|em|cite)\s*>/gi, '<em>$1</em>')
          .replace(/<(?!\/?em\b)[^>]+>/gi, '');
        urlTokens.push(`<a href="${escapeHtml(decodeBasicEntities(cleanHref))}">${innerSanitized}</a>`);
      } else {
        urlTokens.push(escapeHtml(decodeBasicEntities(match)));
      }
      return id;
    }
  );

  // Convert *italic* markdown syntax to <em>...</em>
  cleaned = cleaned.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '<em>$1</em>');

  // Tokenize <em>...</em>, <sup>...</sup>, <sub>...</sub>, and URL tokens while escaping stray tags/entities
  const tokens: string[] = [];
  cleaned = cleaned.replace(/<(em|sup|sub)>([\s\S]*?)<\/\1>|\u0000URL\d+\u0000/gi, (m, tagName, innerContent) => {
    const id = `\u0000TOK${tokens.length}\u0000`;
    if (m.startsWith('\u0000URL')) {
      const urlIdx = Number(m.slice(4, -1));
      tokens.push(urlTokens[urlIdx] || '');
    } else {
      const tag = String(tagName).toLowerCase();
      const innerText = escapeHtml(decodeBasicEntities(String(innerContent).replace(/<[^>]+>/g, '')));
      tokens.push(innerText.trim() ? `<${tag}>${innerText}</${tag}>` : innerText);
    }
    return id;
  });

  cleaned = escapeHtml(decodeBasicEntities(cleaned.replace(/<[^>]+>/g, ' ')));
  cleaned = cleaned.replace(/\u0000TOK(\d+)\u0000/g, (_m, idx) => tokens[Number(idx)] || '');
  return normalizeWhitespace(mergeAdjacentInlineTags(cleaned, true));
}

/**
 * Converts a formatted or inline-HTML citation into clean, human-editable text for the textarea
 * while preserving italics as *italic* markers and keeping normalized DOI/web URLs intact.
 */
export function citationHtmlToEditableText(citationHtml: string): string {
  let text = citationHtml;

  // Unwrap <span class="doi"><a href="...">...</a></span> to clean href
  text = text.replace(
    /<span\s+class="doi">\s*<a\s+href="([^"]+)"[^>]*>[\s\S]*?<\/a>\s*<\/span>/gi,
    '$1'
  );

  // Convert remaining <a href="...">inner</a>
  text = text.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const plainInner = decodeBasicEntities(inner.replace(/<[^>]+>/g, '')).trim();
    const cleanHref = decodeBasicEntities(href).trim();
    if (
      !plainInner ||
      plainInner === cleanHref ||
      /^(?:https?:\/\/|www\.|doi:|10\.\d{4,9}\/)/i.test(plainInner)
    ) {
      return cleanHref;
    }
    return `${inner} (${cleanHref})`;
  });

  // Convert <em> / <i> to *italic* while keeping surrounding whitespace outside the asterisks
  text = text.replace(/<\s*(?:em|i)\b[^>]*>([\s\S]*?)<\s*\/\s*(?:em|i)\s*>/gi, (_m, inner) => {
    const plain = decodeBasicEntities(inner.replace(/<[^>]+>/g, ''));
    const lead = plain.match(/^\s*/)?.[0] || '';
    const trail = plain.match(/\s*$/)?.[0] || '';
    const core = plain.trim();
    return core ? `${lead}*${core}*${trail}` : plain;
  });

  // Strip any remaining tags and decode HTML entities
  text = decodeBasicEntities(text.replace(/<[^>]+>/g, ''));
  return normalizeWhitespace(text);
}

function parseCssLengthToTwips(rawVal: string | undefined): number {
  if (!rawVal) return 0;
  const match = rawVal.trim().match(/^(-?\d+(?:\.\d+)?)\s*(in|pt|px|cm|mm|pc|em|rem)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (match[2] || 'px').toLowerCase();
  switch (unit) {
    case 'in':
      return Math.round(num * 1440);
    case 'pt':
      return Math.round(num * 20);
    case 'pc':
      return Math.round(num * 240);
    case 'cm':
      return Math.round((num / 2.54) * 1440);
    case 'mm':
      return Math.round((num / 25.4) * 1440);
    case 'em':
    case 'rem':
      return Math.round(num * 240);
    case 'px':
    default:
      return Math.round(num * 15);
  }
}

function extractCssIndentInfo(el: Element): { leftIndent: number; hangingIndent: number } {
  let leftIndent = 0;
  let hangingIndent = 0;
  let curr: Element | null = el;

  while (curr && curr.tagName.toLowerCase() !== 'body' && curr.tagName.toLowerCase() !== 'html') {
    const style = curr.getAttribute('style') || '';
    if (style) {
      const marginLeftMatch = style.match(/(?:^|[;\s])(?:margin-left|mso-para-margin-left|padding-left)\s*:\s*([^;]+)/i);
      if (marginLeftMatch && leftIndent === 0) {
        const val = parseCssLengthToTwips(marginLeftMatch[1]);
        if (val > 0) leftIndent = val;
      }
      const textIndentMatch = style.match(/(?:^|[;\s])text-indent\s*:\s*([^;]+)/i);
      if (textIndentMatch && hangingIndent === 0) {
        const val = parseCssLengthToTwips(textIndentMatch[1]);
        if (val < 0) hangingIndent = Math.abs(val);
      }
    }
    curr = curr.parentElement;
  }

  return { leftIndent, hangingIndent };
}

function resolveElementItalicState(el: Element, inheritedItalic: boolean): boolean {
  let italic = inheritedItalic;
  const tag = el.tagName.toLowerCase();
  if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn') {
    italic = true;
  }

  const className = el.getAttribute('class') || '';
  if (/\b(?:MsoIntenseEmphasis|MsoBookTitle|Emphasis)\b/i.test(className)) {
    italic = true;
  }

  const style = el.getAttribute('style') || '';
  if (style) {
    // Match standard CSS font-style (avoiding Word's mso-bidi-font-style:normal!)
    const fontStyleMatches = Array.from(
      style.matchAll(/(?:^|[;\s])font-style\s*:\s*(normal|italic|oblique)\b/gi)
    );
    if (fontStyleMatches.length > 0) {
      const lastVal = fontStyleMatches[fontStyleMatches.length - 1][1].toLowerCase();
      italic = lastVal === 'italic' || lastVal === 'oblique';
    }
  }

  return italic;
}

function serializeClipboardInlineNode(node: Node, inheritedItalic: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Word wraps HTML source at ~72 columns with \r\n inside paragraphs; collapse control newlines/tabs to spaces
    const rawText = (node.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\u00a0/g, ' ');
    if (!rawText) return '';
    const escaped = escapeHtml(rawText);
    if (inheritedItalic && rawText.trim()) {
      return `<em>${escaped}</em>`;
    }
    return escaped;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (
    tag === 'style' ||
    tag === 'script' ||
    tag === 'meta' ||
    tag === 'link' ||
    tag === 'title' ||
    tag === 'xml' ||
    tag === 'svg' ||
    tag === 'noscript'
  ) {
    return '';
  }

  if (tag === 'o:p' || el.nodeName.toLowerCase() === 'o:p') {
    const opText = (el.textContent || '').replace(/[\r\n\t\u00a0]+/g, ' ');
    return opText.trim() ? escapeHtml(opText) : opText ? ' ' : '';
  }

  if (tag === 'br') {
    return '<br>';
  }

  const italic = resolveElementItalicState(el, inheritedItalic);

  if (tag === 'a') {
    const rawHref = el.getAttribute('href') || '';
    const cleanHref = rawHref.replace(/[\r\n\s]+/g, '');
    const inner = Array.from(el.childNodes)
      .map((child) => serializeClipboardInlineNode(child, italic))
      .join('');
    if (!inner.replace(/<[^>]+>/g, '').trim()) {
      return inner ? ' ' : '';
    }
    if (/^(?:https?:\/\/|doi:)/i.test(cleanHref)) {
      return `<a href="${escapeHtml(cleanHref)}">${inner}</a>`;
    }
    // Word bookmark anchors like <a name="_Hlk12345">...</a> have no external href; unwrap while preserving inner italics
    return inner;
  }

  const childrenHtml = Array.from(el.childNodes)
    .map((child) => serializeClipboardInlineNode(child, italic))
    .join('');

  if (!childrenHtml) return '';

  if (tag === 'sup' && childrenHtml.replace(/<[^>]+>/g, '').trim()) {
    return `<sup>${childrenHtml}</sup>`;
  }
  if (tag === 'sub' && childrenHtml.replace(/<[^>]+>/g, '').trim()) {
    return `<sub>${childrenHtml}</sub>`;
  }

  return childrenHtml;
}

const BLOCK_TAGS = new Set([
  'p',
  'li',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'tr',
]);

/**
 * Parses rich HTML copied from Microsoft Word, Google Docs, Apple Pages, or a browser
 * into segmented citation HTML strings (preserving italics, hyperlinks, hanging indents, and paragraph boundaries).
 */
export function parseWordClipboardHtmlToCitations(clipboardHtml: string): string[] {
  if (!clipboardHtml || !clipboardHtml.trim()) return [];

  // Strip Word conditional comments (<!--[if ...]>...<![endif]-->) before DOM parsing
  const cleanedSource = clipboardHtml
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanedSource, 'text/html');
  const body = doc.body;
  if (!body) return [];

  // Remove non-content elements, Word comment blocks, and track mso-list:Ignore numbering pseudo-spans
  const REMOVE_TAGS = new Set(['style', 'script', 'meta', 'link', 'title', 'xml', 'svg', 'noscript']);
  const numberedBlocks = new WeakSet<Element>();
  Array.from(body.querySelectorAll('*')).forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const style = el.getAttribute('style') || '';
    const className = el.getAttribute('class') || '';

    if (REMOVE_TAGS.has(tag) || /mso-element\s*:\s*comment/i.test(style) || /\bMsoCommentReference\b/i.test(className)) {
      el.remove();
      return;
    }

    if (/mso-list\s*:\s*Ignore/i.test(style)) {
      const parentBlock = el.closest('p, li, div');
      if (parentBlock) numberedBlocks.add(parentBlock);
      el.remove();
    }
  });

  // Collect leaf block elements in document order
  const blocks: Element[] = [];
  const collectBlocks = (root: Element) => {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      const tag = child.tagName.toLowerCase();
      let hasNestedBlock = false;
      for (let j = 0; j < child.children.length; j++) {
        if (BLOCK_TAGS.has(child.children[j].tagName.toLowerCase()) || child.children[j].tagName.toLowerCase() === 'ul' || child.children[j].tagName.toLowerCase() === 'ol' || child.children[j].tagName.toLowerCase() === 'table') {
          hasNestedBlock = true;
          break;
        }
      }

      if (BLOCK_TAGS.has(tag) && !hasNestedBlock) {
        blocks.push(child);
      } else if (child.children.length > 0) {
        collectBlocks(child);
      } else if (BLOCK_TAGS.has(tag)) {
        blocks.push(child);
      }
    }
  };
  collectBlocks(body);

  const targetBlocks = blocks.length > 0 ? blocks : [body];

  // Check if clipboard includes a full article with a References heading; if so, extract after that heading
  let startIdx = 0;
  for (let i = 0; i < targetBlocks.length; i++) {
    const plain = normalizeWhitespace(targetBlocks[i].textContent || '');
    if (plain && isReferenceHeading(plain) && i < targetBlocks.length - 1) {
      // Only treat as section divider if there are non-empty blocks after it
      const hasAfter = targetBlocks.slice(i + 1).some((b) => normalizeWhitespace(b.textContent || '').length > 0);
      if (hasAfter) {
        startIdx = i + 1;
        break;
      }
    }
  }

  const rawReferenceLines: RawReferenceLine[] = [];
  let sawBlankLine = false;

  for (let i = startIdx; i < targetBlocks.length; i++) {
    const block = targetBlocks[i];
    const blockItalic = resolveElementItalicState(block, false);
    const serialized = mergeAdjacentInlineTags(
      Array.from(block.childNodes)
        .map((n) => serializeClipboardInlineNode(n, blockItalic))
        .join(''),
      true
    );

    const plainBlock = normalizeWhitespace(decodeBasicEntities(serialized.replace(/<[^>]+>/g, ' ')));
    if (!plainBlock) {
      sawBlankLine = true;
      continue;
    }

    if (isReferenceHeading(plainBlock)) {
      sawBlankLine = true;
      continue;
    }

    const className = block.getAttribute('class') || '';
    const styleAttr = block.getAttribute('style') || '';
    const hasNumbering =
      block.tagName.toLowerCase() === 'li' ||
      numberedBlocks.has(block) ||
      /\bMsoListParagraph/i.test(className) ||
      /mso-list\s*:/i.test(styleAttr);

    const { leftIndent, hangingIndent } = extractCssIndentInfo(block);
    const startsWithTab = /^(?:\t|(?:\s|&nbsp;){3,})/.test(block.textContent || '');

    const subParts = serialized.split(/<br\s*\/?>/gi);
    let blankBeforeSub = sawBlankLine;
    sawBlankLine = false;

    subParts.forEach((sub, idx) => {
      const cleanedSub = normalizeWhitespace(mergeAdjacentInlineTags(sub, true));
      const subPlain = normalizeWhitespace(decodeBasicEntities(cleanedSub.replace(/<[^>]+>/g, ' ')));
      if (!subPlain) {
        blankBeforeSub = true;
        return;
      }
      if (isReferenceHeading(subPlain)) {
        blankBeforeSub = true;
        return;
      }
      rawReferenceLines.push({
        html: cleanedSub,
        hasNumbering: idx === 0 ? hasNumbering : false,
        leftIndent: idx === 0 ? leftIndent : 0,
        hangingIndent: idx === 0 ? hangingIndent : 0,
        startsWithTab: idx === 0 ? startsWithTab : /^(?:\s|&nbsp;){2,}/.test(sub),
        afterBlankLine: blankBeforeSub,
        isSoftBreak: idx > 0,
      });
      blankBeforeSub = false;
    });
  }

  return segmentReferenceEntries(rawReferenceLines);
}

export function splitReferences(input: string): string[] {
  const text = input
    .replace(/<h[1-6][^>]*>\s*(?:References|Works Cited|Bibliography|Selected Bibliography|Sources Cited|Literature Cited)\s*<\/h[1-6]>/gi, '')
    .replace(/<\/?(?:ol|ul)[^>]*>/gi, '')
    .trim();

  if (!text) return [];

  const listItems = Array.from(text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi), (m) => sanitizeInlineReferenceHtml(m[1])).filter(Boolean);
  if (listItems.length > 0) return listItems;

  const paragraphMatches = Array.from(text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  if (paragraphMatches.length > 0) {
    const pLines: RawReferenceLine[] = [];
    let sawBlank = false;
    for (const m of paragraphMatches) {
      const sanitized = sanitizeInlineReferenceHtml(m[1]);
      const plain = normalizeWhitespace(decodeBasicEntities(sanitized.replace(/<[^>]+>/g, ' ')));
      if (!plain) {
        sawBlank = true;
        continue;
      }
      if (isReferenceHeading(plain)) {
        sawBlank = true;
        continue;
      }
      pLines.push({
        html: sanitized,
        hasNumbering: /^(?:\[\d+\]|\d+\.)\s+/.test(plain),
        leftIndent: 0,
        hangingIndent: 0,
        startsWithTab: false,
        afterBlankLine: sawBlank,
        isSoftBreak: false,
      });
      sawBlank = false;
    }
    return segmentReferenceEntries(pLines);
  }

  // Plain / markdown text lines: preserve blank-line boundaries, indentation, and numbering for segmentReferenceEntries
  const lines = text.split(/\r?\n/);
  const rawLines: RawReferenceLine[] = [];
  let sawBlankLine = false;

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      sawBlankLine = true;
      continue;
    }

    const startsWithIndent = /^(?:\t|\s{3,})/.test(rawLine);
    const sanitized = sanitizeInlineReferenceHtml(rawLine);
    const plain = normalizeWhitespace(decodeBasicEntities(sanitized.replace(/<[^>]+>/g, ' ')));
    if (!plain) {
      sawBlankLine = true;
      continue;
    }
    if (isReferenceHeading(plain)) {
      sawBlankLine = true;
      continue;
    }

    rawLines.push({
      html: sanitized,
      hasNumbering: /^(?:\[\d+\]|\d+\.)\s+/.test(plain),
      leftIndent: startsWithIndent ? 720 : 0,
      hangingIndent: 0,
      startsWithTab: startsWithIndent,
      afterBlankLine: sawBlankLine,
      isSoftBreak: false,
    });
    sawBlankLine = false;
  }

  return segmentReferenceEntries(rawLines);
}

export function extractDoiAndUrl(text: string): { cleaned: string; doi?: { href: string; text: string } } {
  const match = text.match(DOI_REGEX);
  if (!match) {
    return { cleaned: text };
  }

  const shortDoi = match[1].replace(/[.,;:)\]]+$/, '');
  const fullMatch = match[0];
  const href = `https://doi.org/${shortDoi}`;
  const cleaned = text.replace(fullMatch, '').replace(/\s*[.\s]*$/, '.').replace(/\s+$/, '');
  return { cleaned, doi: { href, text: shortDoi } };
}

export function parseReference(reference: string, styleHint?: ReferenceStyle): string {
  const strippedNum = normalizeWhitespace(reference).replace(/^(?:\[\d+\]|\d+\.)\s*/, '');
  return `<li class="hangingindent">${formatReferenceCitation(strippedNum, styleHint)}</li>`;
}

export function formatCitationHtmlArrayWithMeta(
  citations: string[],
  options: FormatReferencesOptions = {}
): { html: string; count: number; detectedStyle?: DetectedStyleSummary } {
  if (citations.length === 0) return { html: '', count: 0 };
  const detected = detectReferenceListStyle(citations);
  const items = citations.map((c) => parseReference(c, detected.dominantStyle)).join('\n');
  const headingPrefix = options.includeHeading ? '<h2 class="h4">References</h2>\n' : '';
  return {
    html: `${headingPrefix}<ol class="references">\n${items}\n</ol>`,
    count: citations.length,
    detectedStyle: detected.summary,
  };
}

export function formatCitationHtmlArray(citations: string[], options: FormatReferencesOptions = {}): string {
  return formatCitationHtmlArrayWithMeta(citations, options).html;
}

export function formatReferencesWithMeta(
  input: string,
  options: FormatReferencesOptions = {}
): { html: string; count: number; detectedStyle?: DetectedStyleSummary } {
  const references = splitReferences(input);
  return formatCitationHtmlArrayWithMeta(references, options);
}

export function formatReferences(input: string, options: FormatReferencesOptions = {}): string {
  return formatReferencesWithMeta(input, options).html;
}
