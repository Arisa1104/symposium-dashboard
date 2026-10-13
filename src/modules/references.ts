/**
 * Reference Formatter module
 * Parses academic references (APA and general format) and formats into CMS HTML list items
 */

const DOI_REGEX = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function splitReferences(input: string): string[] {
  const text = input
    .replace(/<h[1-6][^>]*>\s*References\s*<\/h[1-6]>/gi, '')
    .replace(/<ol[^>]*>/gi, '')
    .replace(/<\/ol>/gi, '')
    .trim();

  const paragraphs = Array.from(text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi), match => normalizeWhitespace(decodeBasicEntities(match[1])));
  if (paragraphs.length > 0) {
    return paragraphs.filter(Boolean);
  }

  return text
    .split(/\n{2,}/)
    .map(part => decodeBasicEntities(part.replace(/<[^>]+>/g, ' ')))
    .map(normalizeWhitespace)
    .filter(Boolean);
}

export function extractDoiAndUrl(text: string): { cleaned: string; doi?: { href: string; text: string } } {
  const match = text.match(DOI_REGEX);
  if (!match) {
    return { cleaned: text };
  }

  const shortDoi = match[1];
  const fullMatch = match[0];
  const href = `https://doi.org/${shortDoi}`;
  const cleaned = text.replace(fullMatch, '').replace(/\s*[.\s]*$/, '.').replace(/\s+$/, '');
  return { cleaned, doi: { href, text: shortDoi } };
}

export function parseReference(reference: string): string {
  let text = normalizeWhitespace(reference);
  text = text.replace(/^\d+\.\s*/, '');

  const { cleaned, doi } = extractDoiAndUrl(text);
  text = cleaned;

  const yearMatch = text.match(/\((\d{4}[a-z]?)\)/i);
  const year = yearMatch?.[1] ?? '';
  const yearIndex = yearMatch?.index ?? -1;

  const authorPart = yearIndex >= 0 ? text.slice(0, yearIndex).replace(/[.,;\s]+$/, '') : '';
  const afterYear = yearIndex >= 0 ? text.slice(yearIndex + yearMatch![0].length).replace(/^\.?\s*/, '') : text;

  const titleMatch = afterYear.match(/^(.+?)\.\s*(.+)$/);
  const title = titleMatch?.[1] ?? afterYear;
  const remainder = (titleMatch?.[2] ?? '').replace(/\.$/, '');

  let journal = '';
  let volume = '';
  let issue = '';
  let pages = '';

  const volumeIssuePages = remainder.match(/^(.+?),(?:\s*)(\d+)(?:\(([^)]+)\))?,\s*([0-9]+(?:\s*[–-]\s*[0-9]+)?)(?:\.)?$/);
  const journalOnlyPages = remainder.match(/^(.+?),\s*\*?(\d+)\*?,\s*([0-9]+(?:\s*[–-]\s*[0-9]+)?)(?:\.)?$/);

  if (volumeIssuePages) {
    journal = volumeIssuePages[1];
    volume = volumeIssuePages[2];
    issue = volumeIssuePages[3] ?? '';
    pages = volumeIssuePages[4];
  } else if (journalOnlyPages) {
    journal = journalOnlyPages[1];
    volume = journalOnlyPages[2];
    pages = journalOnlyPages[3];
  } else {
    const lastComma = remainder.lastIndexOf(',');
    if (lastComma >= 0) {
      journal = remainder.slice(0, lastComma).trim();
      pages = remainder.slice(lastComma + 1).trim();
    } else {
      journal = remainder.trim();
    }
  }

  const parts: string[] = [];
  if (authorPart) parts.push(`<span class="author">${escapeHtml(authorPart)}</span>`);
  if (year) parts.push(` (<span class="year">${escapeHtml(year)}</span>).`);
  if (title) parts.push(` <span class="title">${escapeHtml(title)}</span>.`);
  if (journal) parts.push(` <span class="journal"><em>${escapeHtml(journal)}</em></span>`);
  if (volume) parts.push(`, <span class="volume"><em>${escapeHtml(volume)}</em></span>`);
  if (issue) parts.push(` (<span class="issue">${escapeHtml(issue)}</span>)`);
  if (pages) parts.push(`, <span class="pages">${escapeHtml(pages.replace(/\.$/, ''))}</span>`);
  if (doi) parts.push(`. <span class="doi"><a href="${escapeHtml(doi.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doi.text)}</a></span>`);

  return `<li class="hangingindent">${parts.join('').replace(/^\s+/, '')}</li>`;
}

export function formatReferences(input: string): string {
  const references = splitReferences(input);
  if (references.length === 0) return '';
  const items = references.map(parseReference).join('\n');
  return `<ol class="references">\n${items}\n</ol>`;
}
