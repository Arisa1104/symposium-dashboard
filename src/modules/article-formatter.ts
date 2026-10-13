/**
 * Article Formatter Module
 * Browser-based direct OOXML DOCX-to-Joomla article converter for College Music Symposium.
 * Faithfully ports symposium_docx_to_html.py into TypeScript using JSZip and DOMParser.
 */

import JSZip from 'jszip';

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const REFERENCE_HEADINGS = new Set([
  "references",
  "works cited",
  "work cited",
  "bibliography",
  "selected bibliography",
  "sources cited",
]);

const YEAR_RE = /\((?:\d{4}[a-z]?|n\.d\.)\)/i;
const BIB_YEAR_RE = /\b(?:1[5-9]\d{2}|20\d{2}|n\.d\.)\b/i;
const TAG_RE = /<[^>]+>/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"']+/g;
const HTML_TAG_OR_ANCHOR_RE = /<a\b[^>]*>.*?<\/a>|<[^>]+>/gis;

function htmlText(value: string): string {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
  return escaped.replace(/ {2,}/g, (match) => "&nbsp;".repeat(match.length - 1) + " ");
}

function htmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truthyOnOff(value: string | null): boolean {
  if (value === null) return true;
  return !["0", "false", "False", "off", "none"].includes(value);
}

function propEnabled(rPr: Element | null, name: string, defaultValue: boolean = false): boolean {
  if (!rPr) return defaultValue;
  const nodes = rPr.getElementsByTagNameNS(W_NS, name);
  if (nodes.length === 0) return defaultValue;
  const val = nodes[0].getAttributeNS(W_NS, "val") || nodes[0].getAttribute("w:val");
  return truthyOnOff(val);
}

function vertAlign(rPr: Element | null): string | null {
  if (!rPr) return null;
  const nodes = rPr.getElementsByTagNameNS(W_NS, "vertAlign");
  if (nodes.length === 0) return null;
  return nodes[0].getAttributeNS(W_NS, "val") || nodes[0].getAttribute("w:val");
}

function directText(element: Element): string {
  let parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const localName = el.localName || el.nodeName.split(":").pop();
      if (localName === "t") {
        parts.push(el.textContent || "");
      } else if (localName === "tab") {
        parts.push("\t");
      } else if (localName === "br" || localName === "cr") {
        parts.push("\n");
      } else {
        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i]);
        }
      }
    }
  };
  walk(element);
  return parts.join("");
}

function paragraphText(paragraph: Element): string {
  return directText(paragraph).trim();
}

function cleanInline(value: string): string {
  return value.replace(/^(?:\s|&nbsp;)+/, "").replace(/(?:\s|&nbsp;)+$/, "");
}

function normalizeHtmlSpacing(value: string): string {
  let val = value.replace(/\s+/g, " ");
  val = val.replace(/\s+([,.;:)])/g, "$1");
  val = val.replace(/([(])\s+/g, "$1");
  return val.trim();
}

function htmlToPlain(value: string): string {
  const noBr = value.replace(/<br\s*\/?>/gi, " ");
  const stripped = noBr.replace(TAG_RE, "");
  return stripped.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

function stripTerminalPeriod(value: string): string {
  let val = value.trim();
  val = val.replace(/\.+\s*(<\/em>\s*)$/i, "$1");
  return val.replace(/\.+$/, "").trimEnd();
}

function referenceHeadingKey(value: string): string {
  const plain = htmlToPlain(value).toLowerCase().replace(/\s+/g, " ");
  return plain.replace(/^[ .:\t\r\n]+|[ .:\t\r\n]+$/g, "");
}

function isReferenceHeading(value: string): boolean {
  return REFERENCE_HEADINGS.has(referenceHeadingKey(value));
}

function isReferenceStart(value: string): boolean {
  const plain = htmlToPlain(value);
  return YEAR_RE.test(plain.slice(0, 220));
}

function isProbablePublisherLine(value: string): boolean {
  const plain = htmlToPlain(value).trim();
  const start = plain.slice(0, 40);
  const publisherRe = /\b(?:Press|University|Routledge|Dutton|Editions|Records|Vanguard|Associated Press|Baseball America|USA Today|WGBH|website)\b/;
  return publisherRe.test(start) && BIB_YEAR_RE.test(plain);
}

function isBibliographyReferenceStart(value: string): boolean {
  const plain = htmlToPlain(value).trim();
  if (!plain) return false;
  if (value.trimStart().toLowerCase().startsWith("<em>")) return false;
  if (/^[“"']/.test(plain)) return true;
  if (/^[A-Z][^“”]{0,100},\s*[“”]/.test(plain)) return true;
  if (/^[A-Z][A-Za-z &]+\.\s*[“”"]/.test(plain)) return true;
  if (/^[A-Z][A-Za-z .&]+\.\s+(?:\d{4}[a-z]?\.|n\.d\.)\s+[“”"]/.test(plain)) return true;
  if (isProbablePublisherLine(value)) return false;

  const firstClause = plain.split(".")[0];
  if (firstClause.includes(",") && firstClause.length < 180) return true;
  if (/^[A-Z][A-Za-z&’'. -]+,\s*[“"A-Z]/.test(plain)) return true;

  return false;
}

function splitReferenceYear(value: string): [string, string, string] | null {
  const match = YEAR_RE.exec(value);
  if (!match) return null;

  let periodEnd = match.index + match[0].length;
  if (periodEnd < value.length && value[periodEnd] === ".") {
    periodEnd += 1;
  }

  return [
    value.slice(0, match.index).trim(),
    match[0],
    value.slice(periodEnd).trim()
  ];
}

function consumeLeadingEmSequence(value: string): [string, string] {
  const titleParts: string[] = [];
  let remaining = value.trimStart();

  while (true) {
    const match = remaining.match(/^(<em>.*?<\/em>)/i);
    if (!match) break;

    titleParts.push(match[1]);
    remaining = remaining.slice(match[0].length).trimStart();
    if (!remaining.toLowerCase().startsWith("<em>")) break;
  }

  return [normalizeHtmlSpacing(titleParts.join(" ")), remaining.trim()];
}

function doiShortText(url: string, label: string = ""): string | null {
  for (const candidate of [url, htmlToPlain(label)]) {
    const match = candidate.match(/https?:\/\/(?:dx\.)?doi\.org\/(.+)/i);
    if (match) {
      return match[1].replace(/[ .]+$/, "");
    }
  }
  return null;
}

function formatReferenceLink(href: string, label: string): string {
  const shortDoi = doiShortText(href, label);
  if (shortDoi) {
    return `<span class="doi"><a href="${htmlAttr(href)}" target="_blank" rel="noopener noreferrer">${htmlText(shortDoi)}</a></span>`;
  }
  if (!htmlToPlain(label)) return "";
  return `<a href="${htmlAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function linkifyBareUrl(url: string): string {
  const shortDoi = doiShortText(url);
  if (shortDoi) {
    return `<span class="doi"><a href="${htmlAttr(url)}" target="_blank" rel="noopener noreferrer">${htmlText(shortDoi)}</a></span>`;
  }
  return `<a href="${htmlAttr(url)}" target="_blank" rel="noopener noreferrer">${htmlText(url)}</a>`;
}

function linkifyBareUrls(value: string): string {
  const replace = (match: string): string => {
    let url = match;
    let trailing = "";
    while (url && ").,;:]".includes(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }
    return linkifyBareUrl(url) + trailing;
  };

  const parts = value.split(HTML_TAG_OR_ANCHOR_RE);
  const matches = value.match(HTML_TAG_OR_ANCHOR_RE) || [];
  const rebuilt: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    rebuilt.push(parts[i].replace(BARE_URL_RE, replace));
    if (i < matches.length) {
      rebuilt.push(matches[i]);
    }
  }
  return rebuilt.join("");
}

function extractReferenceLinks(value: string): [string, string[]] {
  const links: string[] = [];
  const replaced = value.replace(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_match, href, label) => {
    const formatted = formatReferenceLink(href, label);
    if (formatted) links.push(formatted);
    return "";
  });
  return [normalizeHtmlSpacing(replaced), links];
}

function formatReferenceSource(sourceHtml: string): string {
  const [sourceWithoutLinks, links] = extractReferenceLinks(sourceHtml);
  const plain = htmlToPlain(sourceWithoutLinks);
  const lowerPlain = plain.toLowerCase();

  const isNonJournalSource =
    lowerPlain.startsWith("retrieved ") ||
    lowerPlain.startsWith("in ") ||
    lowerPlain.startsWith("new york:") ||
    lowerPlain.startsWith("los altos,") ||
    lowerPlain.startsWith("mind garden") ||
    lowerPlain.includes(" retrieved ");

  let rendered = sourceWithoutLinks;

  if (!isNonJournalSource) {
    const match = plain.match(/^(.+?),\s*(\d+[A-Za-z]?)\s*(\([^)]*\))?\s*(?:,|:)\s*(.+)$/);
    if (match) {
      const journal = match[1].trim();
      const volume = (match[2] || "").trim();
      const issue = (match[3] || "").trim();
      const pages = (match[4] || "").trim().replace(/^[ ,.]+|[ ,.]+$/g, "");

      const parts = [`<span class="journal"><em>${htmlText(journal)}</em></span>`];
      if (volume) parts.push(`<span class="volume">${htmlText(volume)}</span>`);
      if (issue) parts.push(`<span class="issue">${htmlText(issue)}</span>`);
      if (pages) parts.push(`<span class="pages">${htmlText(pages)}</span>`);

      let r = parts[0] + (volume ? `, ${parts[1]}` : "") + (issue ? ` ${parts[2]}` : "");
      if (pages) r += `, ${parts[parts.length - 1]}`;
      rendered = r + ".";
    } else if (plain && sourceWithoutLinks.toLowerCase().startsWith("<em>")) {
      rendered = `<span class="journal"><em>${htmlText(plain)}</em></span>.`;
    }
  }

  if (links.length > 0) {
    rendered = `${rendered} ${links.join(" ")}`;
  }
  return normalizeHtmlSpacing(rendered);
}

function isApaYearSplit(split: [string, string, string]): boolean {
  const [beforeYear] = split;
  const plain = htmlToPlain(beforeYear);
  return plain.length <= 220 && !/[“"]|<em>|<\/em>/i.test(beforeYear);
}

function replaceLinksForBibliography(value: string): string {
  return value.replace(/<a\s+href="([^"]+)">(.*?)<\/a>/gi, (_match, href, label) => {
    const shortDoi = doiShortText(href, label);
    if (shortDoi) {
      return `<span class="doi"><a href="${htmlAttr(href)}" target="_blank" rel="noopener noreferrer">${htmlText(shortDoi)}</a></span>`;
    }
    return label || htmlText(href);
  });
}

function ensureTerminalPeriod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.?!”"]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function splitBibliographyAuthor(value: string): [string, string] {
  const trimmed = value.trim();
  const plain = htmlToPlain(trimmed);
  if (/^[“"']/.test(plain)) return ["", trimmed];

  const quoteMatch = plain.match(/\s*[,“"]\s*([“”"])/);
  if (quoteMatch && (quoteMatch.index ?? 0) <= 120) {
    const authorPlain = plain.slice(0, quoteMatch.index).replace(/^[ ,]+|[ ,]+$/g, "");
    for (let index = 0; index <= trimmed.length; index++) {
      if (htmlToPlain(trimmed.slice(0, index)).replace(/^[ ,]+|[ ,]+$/g, "") === authorPlain) {
        return [trimmed.slice(0, index).replace(/^[ ,]+|[ ,]+$/g, ""), trimmed.slice(index).replace(/^[ ,]+/, "")];
      }
    }
  }

  // Look for dot boundary
  const dotRe = /\.(?:\s+|(?=<em>|[“”"]))/g;
  let match: RegExpExecArray | null;
  while ((match = dotRe.exec(trimmed)) !== null) {
    const rest = trimmed.slice(match.index + match[0].length).trimStart();
    const restPlain = htmlToPlain(rest);
    const nextWord = restPlain.split(" ")[0].replace(/^[ ,]+|[ ,]+$/g, "");
    const prevWords = htmlToPlain(trimmed.slice(0, match.index)).split(/\s+/);
    const prevWord = prevWords[prevWords.length - 1]?.replace(/^[ ,]+|[ ,]+$/g, "") || "";

    if (rest.startsWith("“") || rest.startsWith('"') || rest.startsWith("<em>")) {
      return [trimmed.slice(0, match.index + 1).trim(), rest.trim()];
    }
    if (["Jr.", "Sr.", "II", "III", "IV", "et"].includes(nextWord)) continue;
    if (prevWord.length === 1 && prevWord === prevWord.toUpperCase()) continue;
    if (/^[A-Z]/.test(restPlain)) {
      return [trimmed.slice(0, match.index + 1).trim(), rest.trim()];
    }
  }

  return ["", trimmed];
}

function extractQuotedTitle(value: string): [string, string, string, string] | null {
  const v = value.trimStart();
  const openQuote = v[0];
  if (openQuote !== '"' && openQuote !== "“") return null;
  const closeQuote = openQuote === "“" ? "”" : '"';
  const closeIndex = v.indexOf(closeQuote, 1);
  if (closeIndex < 0) return null;
  return [openQuote, v.slice(1, closeIndex).trim(), closeQuote, v.slice(closeIndex + 1).trim()];
}

function extractBibliographyTitle(value: string): [string, string, boolean, string, string] {
  const quoted = extractQuotedTitle(value);
  if (quoted) {
    const [openQuote, title, closeQuote, rest] = quoted;
    return [title, rest, true, openQuote, closeQuote];
  }

  if (value.toLowerCase().startsWith("<em>")) {
    const [title, rest] = consumeLeadingEmSequence(value);
    return [title, rest.replace(/^\./, "").trim(), false, "", ""];
  }

  const dotMatch = value.match(/\.\s+/);
  if (dotMatch && dotMatch.index !== undefined) {
    return [value.slice(0, dotMatch.index + 1).trim(), value.slice(dotMatch.index + dotMatch[0].length).trim(), false, "", ""];
  }

  return [value.trim(), "", false, "", ""];
}

function spanYearsInText(value: string): string {
  const parts = value.split(/(https?:\/\/\S+|<[^>]+>)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("<") || parts[i].startsWith("http")) continue;
    parts[i] = parts[i].replace(new RegExp(BIB_YEAR_RE.source, "gi"), (m) => `<span class="year">${m}</span>`);
  }
  return parts.join("");
}

function spanBibliographyJournalSource(value: string): string {
  let val = value.replace(/<em>(.*?)<\/em>/i, (_match, inner) => `<span class="journal"><em>${inner.trim()}</em></span>`);

  val = val.replace(
    /(<span class="journal"><em>.*?<\/em><\/span>)\s*,?\s*(\d+[A-Za-z]?)\s*,?\s*no\.\s*(\([^)]+\))\s*(\([^)]*\))\s*:\s*([^.]+)\.?/i,
    (_m, j, vol, iss, date, pgs) =>
      `${j} <span class="volume">${vol}</span>, no. <span class="issue">${iss}</span> ${spanYearsInText(date)}: <span class="pages">${pgs.trim()}</span>.`
  );

  val = val.replace(
    /(<span class="journal"><em>.*?<\/em><\/span>)\s+(\d+[A-Za-z]?)\s*(\([^)]*\))\s*:\s*([^.]+)\.?/i,
    (_m, j, vol, date, pgs) =>
      `${j} <span class="volume">${vol}</span> ${spanYearsInText(date)}: <span class="pages">${pgs.trim()}</span>.`
  );

  val = val.replace(
    /(<span class="journal"><em>.*?<\/em><\/span>)\s*,\s*(\d+\s*[-–]\s*\d+)\.?/i,
    (_m, j, pgs) => `${j}, <span class="pages">${pgs.trim()}</span>.`
  );

  return val;
}

function formatBibliographyCitation(citationHtml: string): string {
  const cleaned = replaceLinksForBibliography(normalizeHtmlSpacing(citationHtml));
  const [authorHtml, remainder] = splitBibliographyAuthor(cleaned);
  const [titleHtml, sourceHtml, quoted, openQuote, closeQuote] = extractBibliographyTitle(remainder);

  const parts: string[] = [];
  if (authorHtml) {
    if (quoted && !authorHtml.trimEnd().endsWith(".")) {
      parts.push(`<span class="author">${authorHtml.trim()}</span>,`);
    } else {
      parts.push(`<span class="author">${ensureTerminalPeriod(authorHtml)}</span>`);
    }
  }

  let title = normalizeHtmlSpacing(titleHtml);
  if (title) {
    if (quoted) {
      let quoteSuffix = "";
      if (title.endsWith(",")) {
        title = title.slice(0, -1).trimEnd();
        quoteSuffix = ",";
      }
      parts.push(`${openQuote}<span class="title">${title}</span>${quoteSuffix}${closeQuote}`);
    } else {
      title = ensureTerminalPeriod(stripTerminalPeriod(title));
      parts.push(`<span class="title">${title}</span>`);
    }
  }

  let source = normalizeHtmlSpacing(sourceHtml);
  if (source) {
    source = spanBibliographyJournalSource(source);
    if (!source.includes('<span class="year">')) {
      source = spanYearsInText(source);
    }
    parts.push(source);
  }

  let rendered = normalizeHtmlSpacing(parts.join(" "));
  rendered = rendered.replace(/\s+([,.;:])/g, "$1");
  rendered = rendered.replace(/(<\/span>)\s*\.\s*(<\/span>)/g, "$1$2");
  rendered = rendered.replace(/(?<!\.)\.\.(?!\.)/g, ".");
  return rendered;
}

function formatReferenceCitation(citationHtml: string): string {
  const norm = normalizeHtmlSpacing(citationHtml);
  const split = splitReferenceYear(norm);
  if (!split || !isApaYearSplit(split)) {
    return formatBibliographyCitation(norm);
  }

  const [authorHtml, year, remainder] = split;
  const cleanedRem = cleanInline(remainder);
  let titleHtml = "";
  let sourceHtml = "";

  if (cleanedRem.toLowerCase().startsWith("<em>")) {
    [titleHtml, sourceHtml] = consumeLeadingEmSequence(cleanedRem);
  } else {
    const firstEm = cleanedRem.toLowerCase().indexOf("<em>");
    if (firstEm >= 0) {
      const prefix = cleanedRem.slice(0, firstEm).trim();
      const inMatch = prefix.match(/\.\s+(In\b.*)$/);
      if (inMatch && inMatch.index !== undefined) {
        titleHtml = prefix.slice(0, inMatch.index).trim();
        sourceHtml = `${prefix.slice(inMatch.index + 2).trim()} ${cleanedRem.slice(firstEm).trim()}`;
      } else {
        titleHtml = prefix;
        sourceHtml = cleanedRem.slice(firstEm).trim();
      }
    } else {
      titleHtml = cleanedRem.trim();
    }
  }

  titleHtml = stripTerminalPeriod(normalizeHtmlSpacing(titleHtml));
  sourceHtml = normalizeHtmlSpacing(sourceHtml);

  const parts = [
    `<span class="author">${normalizeHtmlSpacing(authorHtml)}</span>`,
    `<span class="year">${htmlText(year)}</span>.`
  ];

  if (titleHtml) {
    parts.push(`<span class="title">${titleHtml}</span>.`);
  }

  if (sourceHtml) {
    parts.push(formatReferenceSource(sourceHtml));
  }

  let rendered = normalizeHtmlSpacing(parts.join(" "));
  rendered = rendered.replace(/(<\/(?:span|em)>)\s*\.\./g, "$1.");
  rendered = rendered.replace(/from(?:&nbsp;|\s)*\.\s*(<a\b)/gi, "from $1");
  rendered = rendered.replace(/(?<!\.)\.\.(?!\.)/g, ".");
  return rendered;
}

interface NumberingLevel {
  fmt: string;
  start: string;
}

interface Footnote {
  sourceId: string;
  paragraphs: string[];
}

export interface ConvertArticleOptions {
  skipLeading?: number;
  includeReferences?: boolean;
  includeFootnotes?: boolean;
  h3Headings?: Set<string>;
}

export async function convertDocxToArticleHtml(file: File | Blob, options: ConvertArticleOptions = {}): Promise<string> {
  const {
    skipLeading = 0,
    includeReferences = true,
    includeFootnotes = true,
    h3Headings = new Set<string>()
  } = options;

  const zip = await JSZip.loadAsync(file);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Invalid .docx file: word/document.xml not found");
  }

  const parser = new DOMParser();

  // 1. Read relationships
  const relationships: Record<string, string> = {};
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (relsFile) {
    const relsXml = await relsFile.async("text");
    const relsDoc = parser.parseFromString(relsXml, "application/xml");
    const relNodes = relsDoc.getElementsByTagNameNS(REL_NS, "Relationship");
    for (let i = 0; i < relNodes.length; i++) {
      const rel = relNodes[i];
      const id = rel.getAttribute("Id") || rel.getAttributeNS(REL_NS, "Id");
      const target = rel.getAttribute("Target");
      if (id && target) relationships[id] = target;
    }
  }

  // 2. Read footnote relationships
  const footnoteRels: Record<string, string> = {};
  const fnRelsFile = zip.file("word/_rels/footnotes.xml.rels");
  if (fnRelsFile) {
    const fnRelsXml = await fnRelsFile.async("text");
    const fnRelsDoc = parser.parseFromString(fnRelsXml, "application/xml");
    const relNodes = fnRelsDoc.getElementsByTagNameNS(REL_NS, "Relationship");
    for (let i = 0; i < relNodes.length; i++) {
      const rel = relNodes[i];
      const id = rel.getAttribute("Id") || rel.getAttributeNS(REL_NS, "Id");
      const target = rel.getAttribute("Target");
      if (id && target) footnoteRels[id] = target;
    }
  }

  // 3. Read styles
  const styles: Record<string, string> = {};
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    const stylesXml = await stylesFile.async("text");
    const stylesDoc = parser.parseFromString(stylesXml, "application/xml");
    const styleNodes = stylesDoc.getElementsByTagNameNS(W_NS, "style");
    for (let i = 0; i < styleNodes.length; i++) {
      const s = styleNodes[i];
      const sId = s.getAttributeNS(W_NS, "styleId") || s.getAttribute("w:styleId");
      const nameNodes = s.getElementsByTagNameNS(W_NS, "name");
      if (sId && nameNodes.length > 0) {
        styles[sId] = nameNodes[0].getAttributeNS(W_NS, "val") || nameNodes[0].getAttribute("w:val") || "";
      }
    }
  }

  // 4. Read numbering
  const numbering: Record<string, NumberingLevel> = {};
  const numberingFile = zip.file("word/numbering.xml");
  if (numberingFile) {
    const numXml = await numberingFile.async("text");
    const numDoc = parser.parseFromString(numXml, "application/xml");
    const abstractLevels: Record<string, NumberingLevel> = {};

    const abstracts = numDoc.getElementsByTagNameNS(W_NS, "abstractNum");
    for (let i = 0; i < abstracts.length; i++) {
      const a = abstracts[i];
      const aId = a.getAttributeNS(W_NS, "abstractNumId") || a.getAttribute("w:abstractNumId") || "";
      const lvls = a.getElementsByTagNameNS(W_NS, "lvl");
      for (let j = 0; j < lvls.length; j++) {
        const lvl = lvls[j];
        const lvlId = lvl.getAttributeNS(W_NS, "ilvl") || lvl.getAttribute("w:ilvl") || "0";
        const fmtNodes = lvl.getElementsByTagNameNS(W_NS, "numFmt");
        const startNodes = lvl.getElementsByTagNameNS(W_NS, "start");
        const fmt = fmtNodes.length > 0 ? (fmtNodes[0].getAttributeNS(W_NS, "val") || fmtNodes[0].getAttribute("w:val") || "decimal") : "decimal";
        const start = startNodes.length > 0 ? (startNodes[0].getAttributeNS(W_NS, "val") || startNodes[0].getAttribute("w:val") || "1") : "1";
        abstractLevels[`${aId}:${lvlId}`] = { fmt, start };
      }
    }

    const nums = numDoc.getElementsByTagNameNS(W_NS, "num");
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const numId = n.getAttributeNS(W_NS, "numId") || n.getAttribute("w:numId") || "";
      const absNodes = n.getElementsByTagNameNS(W_NS, "abstractNumId");
      const absId = absNodes.length > 0 ? (absNodes[0].getAttributeNS(W_NS, "val") || absNodes[0].getAttribute("w:val") || "") : "";
      for (const [key, level] of Object.entries(abstractLevels)) {
        const [currAbs, lvlId] = key.split(":");
        if (currAbs === absId) {
          numbering[`${numId}:${lvlId}`] = level;
        }
      }
    }
  }

  // 5. Read footnotes
  const footnotes: Record<string, Footnote> = {};
  const fnFile = zip.file("word/footnotes.xml");

  const renderInlineContext = {
    usedFootnotes: [] as string[],
    footnoteNumbers: {} as Record<string, number>
  };

  const renderRun = (
    run: Element,
    defaults: { bold: boolean; italic: boolean },
    footnoteMode: boolean,
    suppressFormatting: boolean
  ): string => {
    const rPrNodes = run.getElementsByTagNameNS(W_NS, "rPr");
    const rPr = rPrNodes.length > 0 ? rPrNodes[0] : null;
    const bold = propEnabled(rPr, "b", defaults.bold);
    const italic = propEnabled(rPr, "i", defaults.italic);
    const vertical = vertAlign(rPr);
    const parts: string[] = [];
    let hasFootnoteRef = false;
    let hasNonFootnoteContent = false;

    for (let i = 0; i < run.childNodes.length; i++) {
      const child = run.childNodes[i] as Element;
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const localName = child.localName || child.nodeName.split(":").pop();

      if (localName === "rPr") continue;
      if (localName === "t") {
        parts.push(htmlText(child.textContent || ""));
        if (child.textContent) hasNonFootnoteContent = true;
      } else if (localName === "tab") {
        parts.push(" ");
        hasNonFootnoteContent = true;
      } else if (localName === "br" || localName === "cr") {
        parts.push("<br>");
        hasNonFootnoteContent = true;
      } else if (localName === "noBreakHyphen") {
        parts.push("&#8209;");
        hasNonFootnoteContent = true;
      } else if (localName === "softHyphen") {
        parts.push("&shy;");
        hasNonFootnoteContent = true;
      } else if (localName === "footnoteReference") {
        hasFootnoteRef = true;
        if (!footnoteMode) {
          const sId = child.getAttributeNS(W_NS, "id") || child.getAttribute("w:id") || "";
          if (sId) {
            if (!(sId in renderInlineContext.footnoteNumbers)) {
              renderInlineContext.footnoteNumbers[sId] = renderInlineContext.usedFootnotes.length + 1;
              renderInlineContext.usedFootnotes.push(sId);
            }
            const num = renderInlineContext.footnoteNumbers[sId];
            const fn = footnotes[sId];
            let tooltipHtml = fn ? fn.paragraphs.join(" ").trim() : "";
            tooltipHtml = tooltipHtml.replace(/<a\s+href="https?:\/\/[^"]*">\s*<\/a>/gi, "");
            tooltipHtml = tooltipHtml.replace(/<a\s+href="https?:\/\/[^"]*">([^<]*)<\/a>/gi, "$1");
            const tip = tooltipHtml ? ` ${tooltipHtml}` : "";
            parts.push(
              `<a href="#_ftn${num}" id="_ftnref${num}">` +
              `<span class="tooltip-cms"><sup>[${num}]</sup>` +
              `<span class="tooltiptext-cms">${tip}</span></span></a>`
            );
          }
        }
      }
    }

    let rendered = parts.join("");
    if (!rendered) return "";

    const hasMeaningfulText = Boolean(rendered.replace(/(?:\s|&nbsp;)+/g, ""));
    if (suppressFormatting) return rendered;
    if (hasFootnoteRef && !hasNonFootnoteContent) return rendered;

    if (vertical === "superscript") rendered = `<sup>${rendered}</sup>`;
    else if (vertical === "subscript") rendered = `<sub>${rendered}</sub>`;

    if (!hasMeaningfulText) return rendered;

    if (italic) rendered = `<em>${rendered}</em>`;
    if (bold) rendered = `<strong>${rendered}</strong>`;

    return rendered;
  };

  const renderInline = (
    element: Element,
    footnoteMode: boolean = false,
    inherited?: { bold: boolean; italic: boolean },
    suppressFormatting: boolean = false,
    rels: Record<string, string> = relationships
  ): string => {
    const defaults = inherited || { bold: false, italic: false };
    const parts: string[] = [];

    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i] as Element;
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const localName = child.localName || child.nodeName.split(":").pop();

      if (localName === "r") {
        parts.push(renderRun(child, defaults, footnoteMode, suppressFormatting));
      } else if (localName === "hyperlink") {
        const inner = renderInline(child, footnoteMode, defaults, suppressFormatting, rels);
        const relId = child.getAttributeNS(R_NS, "id") || child.getAttribute("r:id") || child.getAttribute("id");
        const anchor = child.getAttributeNS(W_NS, "anchor") || child.getAttribute("w:anchor");
        let href = relId ? (rels[relId] || "") : "";
        if (!href && anchor) href = `#${anchor}`;
        if (cleanInline(inner)) {
          parts.push(href ? `<a href="${htmlAttr(href)}">${inner}</a>` : inner);
        }
      } else if (["proofErr", "bookmarkStart", "bookmarkEnd"].includes(localName || "")) {
        continue;
      } else {
        parts.push(renderInline(child, footnoteMode, defaults, suppressFormatting, rels));
      }
    }
    return parts.join("");
  };

  if (fnFile) {
    const fnXml = await fnFile.async("text");
    const fnDoc = parser.parseFromString(fnXml, "application/xml");
    const fnNodes = fnDoc.getElementsByTagNameNS(W_NS, "footnote");
    for (let i = 0; i < fnNodes.length; i++) {
      const fnNode = fnNodes[i];
      const sId = fnNode.getAttributeNS(W_NS, "id") || fnNode.getAttribute("w:id");
      if (!sId) continue;

      const pNodes = fnNode.getElementsByTagNameNS(W_NS, "p");
      const paragraphs: string[] = [];
      for (let j = 0; j < pNodes.length; j++) {
        let r = renderInline(pNodes[j], true, undefined, false, footnoteRels);
        r = cleanInline(r);
        if (r) paragraphs.push(r);
      }
      footnotes[sId] = { sourceId: sId, paragraphs };
    }
  }

  // 6. Process Main Document
  const docXml = await docFile.async("text");
  const doc = parser.parseFromString(docXml, "application/xml");
  const bodyNodes = doc.getElementsByTagNameNS(W_NS, "body");
  if (bodyNodes.length === 0) return "";
  const body = bodyNodes[0];

  const paragraphs: Element[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const child = body.childNodes[i] as Element;
    if (child.nodeType === Node.ELEMENT_NODE && (child.localName || child.nodeName.split(":").pop()) === "p") {
      paragraphs.push(child);
    }
  }

  const getHeadingLevel = (p: Element): number | null => {
    const text = paragraphText(p);
    if (text.length > 120) return null;

    const pPr = p.getElementsByTagNameNS(W_NS, "pPr")[0];
    const pStyle = pPr?.getElementsByTagNameNS(W_NS, "pStyle")[0];
    const styleId = pStyle ? (pStyle.getAttributeNS(W_NS, "val") || pStyle.getAttribute("w:val") || "") : "";
    const styleName = styles[styleId] || "";
    const styleKey = `${styleId} ${styleName}`.toLowerCase().replace(/\s+/g, "");

    if (styleKey.includes("heading1")) return 2;
    if (styleKey.includes("heading2")) return 3;

    // Check numbering
    const numPr = pPr?.getElementsByTagNameNS(W_NS, "numPr")[0];
    if (numPr) return null;

    // Check if all runs are bold
    const rNodes = p.getElementsByTagNameNS(W_NS, "r");
    const meaningfulRuns: Element[] = [];
    for (let i = 0; i < rNodes.length; i++) {
      if (directText(rNodes[i]).trim()) meaningfulRuns.push(rNodes[i]);
    }

    if (meaningfulRuns.length > 0) {
      const allBold = meaningfulRuns.every(r => {
        const rPrNode = r.getElementsByTagNameNS(W_NS, "rPr")[0];
        return propEnabled(rPrNode, "b", false);
      });
      if (allBold) {
        const anyItalic = meaningfulRuns.some(r => {
          const rPrNode = r.getElementsByTagNameNS(W_NS, "rPr")[0];
          return propEnabled(rPrNode, "i", false);
        });
        return anyItalic ? 3 : 2;
      }
    }

    return null;
  };

  const getNumbering = (p: Element): [string, string] | null => {
    const pPr = p.getElementsByTagNameNS(W_NS, "pPr")[0];
    if (!pPr) return null;
    const numPr = pPr.getElementsByTagNameNS(W_NS, "numPr")[0];
    if (!numPr) return null;
    const numIdNode = numPr.getElementsByTagNameNS(W_NS, "numId")[0];
    const ilvlNode = numPr.getElementsByTagNameNS(W_NS, "ilvl")[0];
    if (!numIdNode) return null;
    const numId = numIdNode.getAttributeNS(W_NS, "val") || numIdNode.getAttribute("w:val") || "0";
    const ilvl = ilvlNode ? (ilvlNode.getAttributeNS(W_NS, "val") || ilvlNode.getAttribute("w:val") || "0") : "0";
    return [numId, ilvl];
  };

  const lines: string[] = [];
  const referenceParagraphs: string[] = [];
  let skipped = 0;
  let openList: { tag: string; attrs: string } | null = null;
  let inReferences = false;

  const closeList = () => {
    if (openList) {
      lines.push(`</${openList.tag}>`);
      openList = null;
    }
  };

  const htmlListType = (fmt: string): string => {
    return {
      decimal: "1",
      lowerLetter: "a",
      upperLetter: "A",
      lowerRoman: "i",
      upperRoman: "I",
    }[fmt] || "1";
  };

  for (const p of paragraphs) {
    const text = paragraphText(p);
    if (!text) continue;

    if (skipped < skipLeading) {
      skipped++;
      continue;
    }

    if (inReferences) {
      referenceParagraphs.push(cleanInline(renderInline(p)));
      continue;
    }

    if (isReferenceHeading(text)) {
      if (includeReferences) {
        inReferences = true;
        closeList();
        continue;
      }
      break;
    }

    const numInfo = getNumbering(p);
    if (numInfo) {
      const [numId, level] = numInfo;
      const numLevel = numbering[`${numId}:${level}`] || { fmt: "decimal", start: "1" };
      const listTag = numLevel.fmt === "bullet" ? "ul" : "ol";
      const listAttrs = listTag === "ol" ? ` start="${htmlAttr(numLevel.start)}" type="${htmlListType(numLevel.fmt)}"` : "";

      if (!openList || openList.tag !== listTag || openList.attrs !== listAttrs) {
        closeList();
        lines.push(`<${listTag}${listAttrs}>`);
        openList = { tag: listTag, attrs: listAttrs };
      }

      lines.push(`<li>${cleanInline(renderInline(p))}</li>`);
      continue;
    }

    closeList();
    let level = getHeadingLevel(p);
    if (h3Headings.has(text)) {
      level = 3;
    }

    const rendered = cleanInline(renderInline(p, false, undefined, level === 2 || level === 3));
    if (level === 2) {
      lines.push(`<h2 class="h4">${rendered}</h2>`);
    } else if (level === 3) {
      lines.push(`<h3 class="h5">${rendered}</h3>`);
    } else {
      lines.push(`<p>${rendered}</p>`);
    }
  }

  closeList();

  // Footnotes
  if (includeFootnotes && renderInlineContext.usedFootnotes.length > 0) {
    lines.push("<p>&nbsp;</p>");
    for (const sourceId of renderInlineContext.usedFootnotes) {
      const number = renderInlineContext.footnoteNumbers[sourceId];
      const fn = footnotes[sourceId] || { sourceId, paragraphs: [""] };
      const bodyText = (fn.paragraphs || [""]).filter(Boolean).join(" ").trim();
      lines.push(
        `<p><a href="#_ftnref${number}" id="_ftn${number}"><sup>[${number}]</sup></a> ${bodyText}</p>`
      );
    }
  }

  // References
  if (includeReferences && referenceParagraphs.length > 0) {
    const citations: string[] = [];
    let current: string[] = [];

    // Detect style
    const candidates = referenceParagraphs.filter(cleanInline).slice(0, 12);
    const apaCount = candidates.filter(isReferenceStart).length;
    const bibCount = candidates.filter(isBibliographyReferenceStart).length;
    const style = apaCount >= bibCount ? "apa" : "bibliography";

    for (const p of referenceParagraphs) {
      const pClean = cleanInline(p);
      if (!pClean) continue;

      const startsNew = style === "apa" ? isReferenceStart(pClean) : isBibliographyReferenceStart(pClean);
      if (current.length > 0 && startsNew) {
        citations.push(normalizeHtmlSpacing(current.join(" ")));
        current = [pClean];
      } else {
        current.push(pClean);
      }
    }
    if (current.length > 0) {
      citations.push(normalizeHtmlSpacing(current.join(" ")));
    }

    lines.push('<h2 class="h4">References</h2>', '<ol class="references">');
    for (const citation of citations) {
      lines.push(
        `<li class="hangingindent">${linkifyBareUrls(formatReferenceCitation(citation))}</li>`
      );
    }
    lines.push("</ol>");
  }

  return lines.join("\n") + "\n";
}
