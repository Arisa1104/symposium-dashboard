/**
 * Alt Text Generator Module for College Music Symposium
 *
 * Supports batch uploading multiple images at once and generating accessible,
 * WCAG-compliant academic alt text tailored for musicology & publishing:
 * 1. Instant Computer Vision + OCR Analyzer (detects musical notation/staves,
 *    charts/diagrams/spectrograms, portraits/performers, archival monochrome photos,
 *    and reads visible labels/headings).
 * 2. Optional In-Browser Neural Vision Model (@xenova/transformers vit-gpt2)
 *    running 100% client-side via WebAssembly.
 * 3. Optional Gemini Multimodal Vision API (gemini-2.5-flash) if an API key is provided.
 */

export type ImageCategory =
  | 'auto'
  | 'musical-score'
  | 'diagram-chart'
  | 'author-portrait'
  | 'performance-photo'
  | 'archival-document';

export type AltTextStyle = 'concise' | 'descriptive';

export type AltEngineMode = 'smart-local' | 'browser-ai' | 'gemini-api';

export interface VisualAnalysisResult {
  detectedCategory: Exclude<ImageCategory, 'auto'>;
  confidence: number;
  width: number;
  height: number;
  aspectDescription: 'portrait' | 'landscape' | 'square' | 'wide-banner';
  isMonochrome: boolean;
  isHighContrastLineArt: boolean;
  staffLineScore: number;
  diagramGridScore: number;
  skinToneRatio: number;
  dominantToneDescription: string;
  extractedTextSnippet: string;
}

export interface AltTextItem {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  categoryOverride: ImageCategory;
  contextHint: string;
  analysis?: VisualAnalysisResult;
  altText: string;
  status: 'pending' | 'analyzing' | 'done' | 'error';
  errorMessage?: string;
}

export interface AltGenerationOptions {
  style: AltTextStyle;
  engine: AltEngineMode;
  includeOcr: boolean;
  geminiApiKey?: string;
}

/**
 * Cleans a filename into human-readable academic context tokens.
 */
export function parseFilenameContext(fileName: string): {
  cleanTitle: string;
  figureLabel: string | null;
  exampleLabel: string | null;
} {
  const withoutExt = fileName.replace(/\.[^.]+$/, '');

  let figureLabel: string | null = null;
  let exampleLabel: string | null = null;

  // Match singular or plural Figure(s) with optional ranges like "Figures 1a-1c", "Fig. 2b", "Figure 3"
  const figMatch = withoutExt.match(
    /\b(figs?(?:ures?)?)\s*[-_.:]*\s*(\d+[a-z]?(?:\s*[-–—_to]+\s*(?:figs?(?:ures?)?\s*)?\d*[a-z])?)\b/i
  );
  if (figMatch) {
    const isPlural = /s$/i.test(figMatch[1]) || /[-–—_]|to/i.test(figMatch[2]);
    const rangeClean = figMatch[2].replace(/\s*[-_]\s*/g, '–').trim();
    figureLabel = `${isPlural ? 'Figures' : 'Figure'} ${rangeClean}`;
  }

  // Match singular or plural Example(s) / Musical Example(s)
  const exMatch = withoutExt.match(
    /\b((?:mus(?:ical)?\s*)?ex(?:amples?)?)\s*[-_.:]*\s*(\d+[a-z]?(?:\s*[-–—_to]+\s*\d*[a-z])?)\b/i
  );
  if (exMatch) {
    const isPlural = /s$/i.test(exMatch[1]) || /[-–—_]|to/i.test(exMatch[2]);
    const rangeClean = exMatch[2].replace(/\s*[-_]\s*/g, '–').trim();
    exampleLabel = `${isPlural ? 'Musical Examples' : 'Musical Example'} ${rangeClean}`;
  }

  // Strip the matched figure/example number tokens and generic noise words so only true descriptive topic words remain
  const strippedTopic = withoutExt
    .replace(
      /\b(?:figs?(?:ures?)?|(?:mus(?:ical)?\s*)?ex(?:amples?)?|tables?)\s*[-_.:]*\s*\d+[a-z]?(?:\s*[-–—_to]+\s*(?:figs?(?:ures?)?\s*)?\d*[a-z])?\b/gi,
      ' '
    )
    .replace(/[_-]+/g, ' ')
    .replace(/\b(final|rev|revised|copy|cropped|bio|img|image|screenshot|scan|page|p)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanTitle: strippedTopic,
    figureLabel,
    exampleLabel
  };
}

/**
 * Analyzes an image on a 2D canvas to classify whether it is:
 * - A musical score / notation example (periodic horizontal staff lines + high-contrast black ink on white)
 * - A chart / analytical diagram / table figure (structured geometric lines, flat background, color blocks)
 * - An author portrait or performance photograph (natural gradients, skin tones, photographic lighting)
 * - An archival / monochrome historical document or photograph
 */
export function analyzeImageVisualFeatures(img: HTMLImageElement): VisualAnalysisResult {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const ratio = width / Math.max(1, height);

  let aspectDescription: VisualAnalysisResult['aspectDescription'] = 'landscape';
  if (ratio > 2.1) aspectDescription = 'wide-banner';
  else if (ratio > 1.12) aspectDescription = 'landscape';
  else if (ratio < 0.88) aspectDescription = 'portrait';
  else aspectDescription = 'square';

  const aw = 180;
  const ah = Math.max(60, Math.min(260, Math.round((height / Math.max(1, width)) * aw)));

  const canvas = document.createElement('canvas');
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      detectedCategory: 'performance-photo',
      confidence: 0.5,
      width,
      height,
      aspectDescription,
      isMonochrome: false,
      isHighContrastLineArt: false,
      staffLineScore: 0,
      diagramGridScore: 0,
      skinToneRatio: 0,
      dominantToneDescription: 'balanced tones',
      extractedTextSnippet: ''
    };
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, aw, ah);
  ctx.drawImage(img, 0, 0, aw, ah);

  const data = ctx.getImageData(0, 0, aw, ah).data;
  const totalPixels = aw * ah;

  let nearWhiteCount = 0;
  let nearBlackCount = 0;
  let midToneCount = 0;
  let lowSaturationCount = 0;
  let skinPixelCount = 0;
  let vividColorCount = 0;
  let lumSum = 0;

  const rowDarkDensity = new Float32Array(ah);
  const colDarkDensity = new Float32Array(aw);

  for (let y = 0; y < ah; y++) {
    let rowDark = 0;
    for (let x = 0; x < aw; x++) {
      const idx = (y * aw + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumSum += lum;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;

      if (chroma < 14) lowSaturationCount++;
      if (chroma > 65) vividColorCount++;

      if (lum > 230 && chroma < 20) {
        nearWhiteCount++;
      } else if (lum < 65) {
        nearBlackCount++;
        rowDark++;
        colDarkDensity[x]++;
      } else {
        midToneCount++;
      }

      // YCbCr skin-tone check (for portraits / performers)
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cr >= 135 && cr <= 175 && cb >= 80 && cb <= 125 && r > 65 && g > 40 && chroma > 15) {
        skinPixelCount++;
      }
    }
    rowDarkDensity[y] = rowDark / aw;
  }

  for (let x = 0; x < aw; x++) {
    colDarkDensity[x] /= ah;
  }

  const whiteRatio = nearWhiteCount / totalPixels;
  const blackRatio = nearBlackCount / totalPixels;
  const isMonochrome = lowSaturationCount / totalPixels > 0.9;
  const isHighContrastLineArt = whiteRatio + blackRatio > 0.72 && whiteRatio > 0.48;
  const skinToneRatio = skinPixelCount / totalPixels;
  const avgLum = lumSum / totalPixels;

  // Detect horizontal staff-line periodicity (characteristic of musical notation / scores)
  // Staff lines create sharp narrow spikes in rowDarkDensity separated by 2-6 pixels
  let horizontalPeaks = 0;
  let periodicIntervals = 0;
  let lastPeakY = -10;

  for (let y = 2; y < ah - 2; y++) {
    const cur = rowDarkDensity[y];
    const prev = rowDarkDensity[y - 1];
    const next = rowDarkDensity[y + 1];
    if (cur > 0.18 && cur >= prev && cur >= next && (cur - Math.min(rowDarkDensity[y - 2], rowDarkDensity[y + 2])) > 0.08) {
      horizontalPeaks++;
      const dist = y - lastPeakY;
      if (dist >= 2 && dist <= 7) {
        periodicIntervals++;
      }
      lastPeakY = y;
    }
  }

  const staffLineScore = isHighContrastLineArt
    ? Math.min(1, (periodicIntervals / 6) * 0.7 + (horizontalPeaks / 12) * 0.3)
    : Math.min(1, (periodicIntervals / 10) * 0.5);

  // Detect vertical & horizontal axis lines (characteristic of charts, tables, analytical graphs)
  let verticalAxisLines = 0;
  for (let x = 2; x < aw - 2; x++) {
    if (colDarkDensity[x] > 0.28) verticalAxisLines++;
  }
  const diagramGridScore =
    whiteRatio > 0.42
      ? Math.min(1, (horizontalPeaks * 0.04) + (verticalAxisLines * 0.06) + (vividColorCount / totalPixels) * 1.5)
      : 0.15;

  // Determine primary category
  let detectedCategory: Exclude<ImageCategory, 'auto'> = 'performance-photo';
  let confidence = 0.75;

  if (staffLineScore >= 0.42 && whiteRatio > 0.5) {
    detectedCategory = 'musical-score';
    confidence = Math.min(0.96, 0.65 + staffLineScore * 0.3);
  } else if (isHighContrastLineArt || (whiteRatio > 0.52 && diagramGridScore > 0.38)) {
    detectedCategory = 'diagram-chart';
    confidence = 0.84;
  } else if (skinToneRatio > 0.045 && ratio <= 1.05) {
    detectedCategory = 'author-portrait';
    confidence = 0.88;
  } else if (isMonochrome && whiteRatio < 0.5) {
    detectedCategory = 'archival-document';
    confidence = 0.82;
  } else if (skinToneRatio > 0.02) {
    detectedCategory = 'performance-photo';
    confidence = 0.8;
  } else if (whiteRatio > 0.45) {
    detectedCategory = 'diagram-chart';
    confidence = 0.72;
  }

  let dominantToneDescription = 'balanced natural lighting';
  if (isHighContrastLineArt) {
    dominantToneDescription = 'high-contrast black notation/lines on a white ground';
  } else if (isMonochrome) {
    dominantToneDescription = avgLum > 150 ? 'light grayscale monochrome tones' : 'deep monochrome grayscale tones';
  } else if (avgLum < 85) {
    dominantToneDescription = 'warm low-key stage or studio lighting';
  } else if (avgLum > 185) {
    dominantToneDescription = 'bright high-key studio illumination';
  }

  return {
    detectedCategory,
    confidence,
    width,
    height,
    aspectDescription,
    isMonochrome,
    isHighContrastLineArt,
    staffLineScore,
    diagramGridScore,
    skinToneRatio,
    dominantToneDescription,
    extractedTextSnippet: ''
  };
}

/**
 * Optional client-side OCR via Tesseract.js (loaded on demand from CDN)
 * to extract visible titles, measure numbers, chord symbols, or axis labels inside figures.
 */
let tesseractWorkerPromise: Promise<any> | null = null;

async function extractVisibleTextWithOcr(img: HTMLImageElement): Promise<string> {
  try {
    if (!(window as any).Tesseract) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[data-tesseract-cdn]');
        if (existing) {
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('Failed to load Tesseract')));
          return;
        }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.async = true;
        s.setAttribute('data-tesseract-cdn', 'true');
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Tesseract CDN'));
        document.head.appendChild(s);
      });
    }

    const Tesseract = (window as any).Tesseract;
    if (!Tesseract) return '';

    if (!tesseractWorkerPromise) {
      tesseractWorkerPromise = Tesseract.createWorker('eng');
    }
    const worker = await tesseractWorkerPromise;

    // Render scaled canvas for fast OCR
    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(32, Math.round(img.width * scale));
    c.height = Math.max(32, Math.round(img.height * scale));
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, c.width, c.height);

    const ret = await worker.recognize(c);
    const rawText: string = ret?.data?.text || '';

    // Filter out noisy single-character OCR artifacts from musical noteheads
    const cleanedWords = rawText
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter((w) => {
        const clean = w.replace(/[^a-zA-Z0-9.,()-]/g, '');
        return clean.length >= 3 || /^(mm|op|no|fig|ex|\d+)$/i.test(clean);
      });

    return cleanedWords.slice(0, 18).join(' ').trim();
  } catch {
    return '';
  }
}

/**
 * Synthesizes accessible, WCAG-compliant alt text from visual features, OCR text,
 * filename metadata, and user-provided context/caption notes.
 * Follows accessibility best practices:
 * - Never starts with redundant "Image of" or "Picture of"
 * - States the visual medium/function clearly (e.g., "Musical score excerpt...", "Analytical diagram...", "Head-and-shoulders portrait...")
 */
export function buildStructuredAltText(
  fileName: string,
  analysis: VisualAnalysisResult,
  categoryOverride: ImageCategory,
  contextHint: string,
  style: AltTextStyle
): string {
  const category = categoryOverride === 'auto' ? analysis.detectedCategory : categoryOverride;
  const { cleanTitle, figureLabel, exampleLabel } = parseFilenameContext(fileName);
  const userHint = contextHint.trim();
  const ocrText = analysis.extractedTextSnippet.trim();

  // Determine the subject phrase from user context, filename topic (excluding generic figure numbers), or OCR
  const hasMeaningfulFilename =
    cleanTitle.length > 2 &&
    !/^(dsc|img|photo|pic|untitled|screen|figure|figures|example|examples|table|sample|\d+[a-z]?)\s*\d*[a-z]*$/i.test(
      cleanTitle
    );

  const subjectPhrase =
    userHint ||
    (hasMeaningfulFilename ? cleanTitle : '') ||
    (ocrText ? `labeled "${ocrText.slice(0, 75)}"` : '');

  if (category === 'musical-score') {
    const prefix = exampleLabel ? `${exampleLabel}: ` : '';
    if (style === 'concise') {
      if (subjectPhrase) {
        return `${prefix}Musical score excerpt showing ${subjectPhrase}.`;
      }
      return `${prefix}Musical score excerpt with notated staves and performance markings.`;
    } else {
      const detail = ocrText
        ? ` Visible notation text/markings include "${ocrText.slice(0, 80)}".`
        : '';
      if (subjectPhrase) {
        return `${prefix}Musical score excerpt illustrating ${subjectPhrase}, presented in ${analysis.dominantToneDescription} (${analysis.aspectDescription} layout).${detail}`;
      }
      return `${prefix}Musical score excerpt displaying engraved staff notation and analytical markings in a ${analysis.aspectDescription} layout.${detail}`;
    }
  }

  if (category === 'diagram-chart') {
    const prefix = figureLabel ? `${figureLabel}: ` : '';
    if (style === 'concise') {
      if (subjectPhrase) {
        return `${prefix}Analytical diagram or chart illustrating ${subjectPhrase}.`;
      }
      return `${prefix}Analytical figure and diagram illustrating musical structure and data relationships.`;
    } else {
      const detail = ocrText
        ? ` Includes labeled elements: "${ocrText.slice(0, 90)}".`
        : '';
      if (subjectPhrase) {
        return `${prefix}Analytical diagram illustrating ${subjectPhrase}, formatted in a ${analysis.aspectDescription} layout with structured visual labels.${detail}`;
      }
      return `${prefix}Analytical chart and structural diagram formatted in a ${analysis.aspectDescription} layout.${detail}`;
    }
  }

  if (category === 'author-portrait') {
    const personName =
      userHint || (hasMeaningfulFilename ? cleanTitle : 'the author');
    if (style === 'concise') {
      return `Portrait of ${personName}.`;
    } else {
      const monoNote = analysis.isMonochrome ? 'monochrome ' : '';
      return `Head-and-shoulders ${monoNote}portrait of ${personName} with ${analysis.dominantToneDescription}.`;
    }
  }

  if (category === 'archival-document') {
    if (style === 'concise') {
      if (subjectPhrase) {
        return `Archival photograph or document showing ${subjectPhrase}.`;
      }
      return `Historical monochrome photograph or archival document.`;
    } else {
      const detail = ocrText ? ` Legible text reads "${ocrText.slice(0, 80)}".` : '';
      if (subjectPhrase) {
        return `Archival ${analysis.isMonochrome ? 'monochrome ' : ''}document or historical photograph depicting ${subjectPhrase}.${detail}`;
      }
      return `Historical ${analysis.isMonochrome ? 'monochrome ' : ''}archival document or photograph in ${analysis.aspectDescription} orientation.${detail}`;
    }
  }

  // Default: 'performance-photo' / general editorial photograph
  if (style === 'concise') {
    if (subjectPhrase) {
      return `Photograph of ${subjectPhrase}.`;
    }
    return `Editorial photograph showing musical performance or instrument detail.`;
  } else {
    if (subjectPhrase) {
      return `${analysis.isMonochrome ? 'Monochrome photograph' : 'Color photograph'} depicting ${subjectPhrase}, captured with ${analysis.dominantToneDescription}.`;
    }
    return `${analysis.isMonochrome ? 'Monochrome' : 'Color'} editorial photograph in ${analysis.aspectDescription} orientation with ${analysis.dominantToneDescription}.`;
  }
}

/**
 * Optional In-Browser Neural Vision model (@xenova/transformers vit-gpt2-image-captioning)
 */
let browserCaptionerPromise: Promise<any> | null = null;

async function generateCaptionWithBrowserAi(
  dataUrl: string,
  contextHint: string,
  style: AltTextStyle
): Promise<string> {
  if (!browserCaptionerPromise) {
    // Dynamic ESM import from CDN so bundle stays lightweight
    const cdnUrl = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
    const mod: any = await import(/* @vite-ignore */ cdnUrl);
    mod.env.allowLocalModels = false;
    browserCaptionerPromise = mod.pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');
  }

  const captioner = await browserCaptionerPromise;
  const output = await captioner(dataUrl);
  let rawCaption: string =
    (Array.isArray(output) && output[0]?.generated_text) ? output[0].generated_text.trim() : '';

  if (!rawCaption) {
    throw new Error('Empty caption from browser model');
  }

  // Capitalize first letter and strip redundant prefixes
  rawCaption = rawCaption
    .replace(/^(an?\s+)?(image|picture|photo|photograph)\s+of\s+/i, '')
    .trim();
  rawCaption = rawCaption.charAt(0).toUpperCase() + rawCaption.slice(1);
  if (!/[.!?]$/.test(rawCaption)) rawCaption += '.';

  if (contextHint.trim()) {
    return style === 'concise'
      ? `${contextHint.trim()}: ${rawCaption}`
      : `${rawCaption} (${contextHint.trim()}).`;
  }
  return rawCaption;
}

/**
 * Optional Gemini Multimodal Vision API call for detailed musicology alt text.
 */
async function generateCaptionWithGemini(
  file: File,
  contextHint: string,
  category: ImageCategory,
  style: AltTextStyle,
  apiKey: string
): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read file for Gemini API'));
    reader.readAsDataURL(file);
  });

  const lengthRule =
    style === 'concise'
      ? 'Keep the alt text concise (1 sentence, under 125 characters) following WCAG screen-reader best practices.'
      : 'Provide a clear, scholarly 1-2 sentence descriptive alt text (120-240 characters) suitable for an academic musicology journal (College Music Symposium).';

  const prompt = [
    'Write accessible HTML alt text for this image published in the academic journal College Music Symposium.',
    'Do NOT start with "Image of", "Picture of", or "Photo of".',
    lengthRule,
    category !== 'auto' ? `Image category: ${category}.` : '',
    contextHint.trim() ? `Editorial context / caption note: ${contextHint.trim()}.` : '',
    'Return ONLY the plain alt text string with no quotes or markdown.'
  ]
    .filter(Boolean)
    .join(' ');

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: file.type || 'image/jpeg',
                  data: base64
                }
              }
            ]
          }
        ]
      })
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API Error (${resp.status}): ${errText.slice(0, 120)}`);
  }

  const json = await resp.json();
  const candidateText: string =
    json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (!candidateText) {
    throw new Error('No alt text returned from Gemini API');
  }
  return candidateText.replace(/^["']|["']$/g, '').trim();
}

/**
 * Generates alt text for a single AltTextItem using the selected engine and options.
 */
export async function generateAltTextForItem(
  item: AltTextItem,
  imgEl: HTMLImageElement,
  options: AltGenerationOptions
): Promise<{ altText: string; analysis: VisualAnalysisResult }> {
  const analysis = item.analysis || analyzeImageVisualFeatures(imgEl);

  const effectiveCat =
    item.categoryOverride === 'auto' ? analysis.detectedCategory : item.categoryOverride;

  // Run OCR when enabled and the image is likely a diagram, chart, score, or archival document
  if (
    options.includeOcr &&
    !analysis.extractedTextSnippet &&
    (effectiveCat === 'musical-score' ||
      effectiveCat === 'diagram-chart' ||
      effectiveCat === 'archival-document')
  ) {
    analysis.extractedTextSnippet = await extractVisibleTextWithOcr(imgEl);
  }

  if (options.engine === 'gemini-api') {
    if (!options.geminiApiKey?.trim()) {
      throw new Error(
        'Please enter your Gemini API Key in the box above to use Gemini 2.5 Flash Vision.'
      );
    }
    const geminiText = await generateCaptionWithGemini(
      item.file,
      item.contextHint,
      item.categoryOverride,
      options.style,
      options.geminiApiKey.trim()
    );
    return { altText: geminiText, analysis };
  }

  if (options.engine === 'browser-ai') {
    const aiText = await generateCaptionWithBrowserAi(
      item.previewUrl,
      item.contextHint,
      options.style
    );
    return { altText: aiText, analysis };
  }

  const structuredText = buildStructuredAltText(
    item.file.name,
    analysis,
    item.categoryOverride,
    item.contextHint,
    options.style
  );

  return { altText: structuredText, analysis };
}

/**
 * Generates a batch of 3 sample images (Musical Score Excerpt, Analytical Diagram, and Author Portrait)
 * so editors can test multi-image batch alt text generation immediately.
 */
export async function createSampleAltTextBatchFiles(): Promise<
  Array<{ file: File; hint: string }>
> {
  // 1. Musical Score Excerpt (5-line staves + notes + measure numbers)
  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 680;
  scoreCanvas.height = 260;
  const sctx = scoreCanvas.getContext('2d')!;
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, 680, 260);

  sctx.strokeStyle = '#111111';
  sctx.lineWidth = 1.5;
  for (const baseY of [55, 155]) {
    for (let line = 0; line < 5; line++) {
      const y = baseY + line * 10;
      sctx.beginPath();
      sctx.moveTo(40, y);
      sctx.lineTo(640, y);
      sctx.stroke();
    }
    // Barlines
    for (const bx of [40, 240, 440, 640]) {
      sctx.beginPath();
      sctx.moveTo(bx, baseY);
      sctx.lineTo(bx, baseY + 40);
      sctx.stroke();
    }
  }
  // Noteheads & stems
  sctx.fillStyle = '#111111';
  for (let i = 0; i < 10; i++) {
    const nx = 85 + i * 54;
    const ny = 65 + ((i * 15) % 35);
    sctx.beginPath();
    sctx.ellipse(nx, ny, 6, 4.5, -0.3, 0, Math.PI * 2);
    sctx.fill();
    sctx.fillRect(nx + 4.5, ny - 28, 1.8, 28);
  }

  const scoreBlob = await new Promise<Blob>((r) => scoreCanvas.toBlob((b) => r(b!), 'image/png'));
  const scoreFile = new File([scoreBlob], 'Example_1_Debussy_Cello_Sonata_mm1-8.png', {
    type: 'image/png'
  });

  // 2. Analytical Chart / Diagram
  const chartCanvas = document.createElement('canvas');
  chartCanvas.width = 560;
  chartCanvas.height = 360;
  const cctx = chartCanvas.getContext('2d')!;
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, 560, 360);

  // Grid & Axes
  cctx.strokeStyle = '#d4d4d0';
  cctx.lineWidth = 1;
  for (let gy = 60; gy <= 280; gy += 44) {
    cctx.beginPath();
    cctx.moveTo(70, gy);
    cctx.lineTo(510, gy);
    cctx.stroke();
  }
  cctx.strokeStyle = '#222220';
  cctx.lineWidth = 2;
  cctx.beginPath();
  cctx.moveTo(70, 50);
  cctx.lineTo(70, 290);
  cctx.lineTo(515, 290);
  cctx.stroke();

  const barColors = ['#585852', '#7c6a56', '#4a6b82', '#8f5b4a', '#5b7a62'];
  barColors.forEach((col, idx) => {
    const bh = 65 + ((idx * 47) % 150);
    cctx.fillStyle = col;
    cctx.fillRect(105 + idx * 78, 290 - bh, 46, bh);
  });

  const chartBlob = await new Promise<Blob>((r) => chartCanvas.toBlob((b) => r(b!), 'image/png'));
  const chartFile = new File([chartBlob], 'Figure_2_Tempo_Rubato_Distribution.png', {
    type: 'image/png'
  });

  // 3. Author Portrait
  const portCanvas = document.createElement('canvas');
  portCanvas.width = 360;
  portCanvas.height = 480;
  const pctx = portCanvas.getContext('2d')!;
  const grad = pctx.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, '#363b42');
  grad.addColorStop(1, '#22252a');
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 360, 480);

  pctx.fillStyle = '#191b1f';
  pctx.beginPath();
  pctx.ellipse(180, 420, 125, 110, 0, Math.PI, 0, false);
  pctx.fill();

  pctx.fillStyle = '#e0ac86';
  pctx.beginPath();
  pctx.ellipse(180, 195, 58, 74, 0, 0, Math.PI * 2);
  pctx.fill();

  pctx.fillStyle = '#2c1f18';
  pctx.beginPath();
  pctx.ellipse(180, 145, 62, 36, 0, Math.PI, Math.PI * 2);
  pctx.fill();

  const portBlob = await new Promise<Blob>((r) => portCanvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
  const portFile = new File([portBlob], 'Dr_Clara_Schumann_Bio_Portrait.jpg', {
    type: 'image/jpeg'
  });

  return [
    {
      file: scoreFile,
      hint: 'Debussy, Sonata for Cello and Piano, Prologue, mm. 1–8'
    },
    {
      file: chartFile,
      hint: 'Comparison of tempo fluctuation across five recordings'
    },
    {
      file: portFile,
      hint: 'Dr. Clara Vance, Professor of Music Theory'
    }
  ];
}
