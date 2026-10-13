/**
 * Italic Highlighter Module
 * Unzips a Word (.docx) file, scans all text runs (<w:r>) inside document.xml,
 * footnotes.xml, headers, and footers for italics (<w:i/> or <w:i w:val="1"/> or <w:i w:val="true"/>),
 * and ensures a yellow highlight (<w:highlight w:val="yellow"/>) is added to <w:rPr>.
 * Returns the modified docx Blob and statistics on changed runs.
 */

import JSZip from 'jszip';

export interface HighlightResult {
  blob: Blob;
  fileName: string;
  italicRunsFound: number;
  italicRunsHighlighted: number;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export async function highlightItalicsInDocx(file: File | Blob, fileName: string = "highlighted.docx"): Promise<HighlightResult> {
  const zip = await JSZip.loadAsync(file);
  let totalFound = 0;
  let totalHighlighted = 0;

  // XML files that can contain text runs
  const targetXmlPaths: string[] = [];
  zip.forEach((relativePath) => {
    if (
      relativePath === 'word/document.xml' ||
      relativePath === 'word/footnotes.xml' ||
      relativePath === 'word/endnotes.xml' ||
      /^word\/(header|footer)\d+\.xml$/.test(relativePath)
    ) {
      targetXmlPaths.push(relativePath);
    }
  });

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const xmlPath of targetXmlPaths) {
    const fileEntry = zip.file(xmlPath);
    if (!fileEntry) continue;

    const xmlText = await fileEntry.async('text');
    const doc = parser.parseFromString(xmlText, 'application/xml');

    // Check for parse error
    if (doc.getElementsByTagName('parsererror').length > 0) {
      console.warn(`Could not parse ${xmlPath} as XML`);
      continue;
    }

    // Find all <w:r> elements
    const runs = doc.getElementsByTagNameNS(W_NS, 'r');
    let xmlChanged = false;

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const rPrElements = run.getElementsByTagNameNS(W_NS, 'rPr');
      if (rPrElements.length === 0) continue;

      const rPr = rPrElements[0];
      const iElements = rPr.getElementsByTagNameNS(W_NS, 'i');
      if (iElements.length === 0) continue;

      // Check if italic is active (w:val is omitted, or "1", or "true", not "0" or "false" or "none")
      const iNode = iElements[0];
      const val = iNode.getAttributeNS(W_NS, 'val') || iNode.getAttribute('w:val');
      const isItalic = val === null || (val !== '0' && val !== 'false' && val !== 'none');

      if (!isItalic) continue;

      totalFound++;

      // Check highlight
      const hlElements = rPr.getElementsByTagNameNS(W_NS, 'highlight');
      if (hlElements.length > 0) {
        const hlNode = hlElements[0];
        const hlVal = hlNode.getAttributeNS(W_NS, 'val') || hlNode.getAttribute('w:val');
        if (hlVal === 'yellow') {
          // Already yellow highlight
          continue;
        }
        // Change to yellow
        hlNode.setAttributeNS(W_NS, 'w:val', 'yellow');
        xmlChanged = true;
        totalHighlighted++;
      } else {
        // Create <w:highlight w:val="yellow"/>
        const hlNode = doc.createElementNS(W_NS, 'w:highlight');
        hlNode.setAttributeNS(W_NS, 'w:val', 'yellow');
        rPr.appendChild(hlNode);
        xmlChanged = true;
        totalHighlighted++;
      }
    }

    if (xmlChanged) {
      const updatedXml = serializer.serializeToString(doc);
      zip.file(xmlPath, updatedXml);
    }
  }

  const outputBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return {
    blob: outputBlob,
    fileName: fileName.replace(/\.docx$/i, '') + '-highlighted.docx',
    italicRunsFound: totalFound,
    italicRunsHighlighted: totalHighlighted
  };
}
