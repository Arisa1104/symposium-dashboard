/**
 * Author Bio Photo Processor Module
 *
 * Features:
 * 1. Automatic border / frame detection and removal (solid, multi-line, or noisy frames).
 * 2. Smart subject & instrument saliency detection (protects faces, headroom, and musical instruments).
 * 3. 3:4 aspect ratio enforcement:
 *    - Resizes to 360px × 480px when the cropped region is >= 360×480.
 *    - Preserves original pixel scale (matching 3:4 aspect ratio without upscaling) when smaller than 360×480.
 * 4. High-quality multi-step lanczos-like step-down resampling and JPEG export.
 */

export interface TrimBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SaliencyFocus {
  /** Normalized center X (0..1) within trimmed area */
  centerX: number;
  /** Normalized center Y (0..1) within trimmed area */
  centerY: number;
  /** Bounding box of important regions (face + instrument) in image pixel coords */
  importantBox: CropRect;
  /** Whether a wide subject (e.g. landscape with instrument) might be tight in 3:4 */
  isWideSubject: boolean;
}

export interface PhotoProcessOptions {
  autoTrimBorder: boolean;
  borderSensitivity: number; // 0..100, default 50
  fitMode: 'crop' | 'contain-blur' | 'contain-solid';
  padColor: string;
  jpegQuality: number; // 0.5..1.0, default 0.92
  customCrop?: CropRect | null;
}

export interface ProcessedPhotoResult {
  blob: Blob;
  dataUrl: string;
  outputWidth: number;
  outputHeight: number;
  originalWidth: number;
  originalHeight: number;
  trimmedBounds: TrimBounds;
  hasBorderRemoved: boolean;
  cropRect: CropRect;
  wasKeptOriginalScale: boolean;
  fileSizeBytes: number;
}

export const TARGET_WIDTH = 360;
export const TARGET_HEIGHT = 480;
export const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT; // 0.75 (3:4)

/**
 * Loads an image File or Blob into an HTMLImageElement.
 */
export function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image: ${err}`));
    };
    img.src = url;
  });
}

/**
 * Automatically detects uniform or decorative borders/frames around the image edges.
 * Handles solid margins (white, black, colored), letterbox bars, and multi-layer thin frames
 * (e.g. outer margin -> thin border line -> inner margin).
 */
export function detectImageBorders(
  img: HTMLImageElement | HTMLCanvasElement,
  sensitivity: number = 50
): TrimBounds {
  const w = img.width;
  const h = img.height;

  // Work on a scaled-down analysis canvas for speed & noise smoothing
  const maxDim = 360;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.max(16, Math.round(w * scale));
  const sh = Math.max(16, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  // Fill white first in case of transparency
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, 0, 0, sw, sh);

  const imgData = ctx.getImageData(0, 0, sw, sh).data;

  // Sensitivity maps 0..100 to variance / color tolerance
  // At sensitivity = 50: stdDevThreshold ~ 11, colorDiffThreshold ~ 24
  const factor = Math.max(0.2, sensitivity / 50);
  const stdDevThreshold = 10.5 * factor;
  const colorDiffThreshold = 22 * factor;
  const maxScanRatio = 0.22; // Never trim more than 22% from a single edge

  const getPixel = (x: number, y: number): [number, number, number] => {
    const idx = (y * sw + x) * 4;
    return [imgData[idx], imgData[idx + 1], imgData[idx + 2]];
  };

  // Analyzes a sequence of pixels along a row or column
  const analyzeLine = (coords: Array<[number, number]>) => {
    // Ignore outer 8% corners so rounded corners or corner badges don't skew line uniformity
    const margin = Math.max(1, Math.floor(coords.length * 0.08));
    const slice = coords.slice(margin, coords.length - margin);
    if (slice.length === 0) return { mean: [255, 255, 255] as [number, number, number], stdDev: 0, activeEdgeRatio: 0 };

    let sumR = 0, sumG = 0, sumB = 0;
    for (const [x, y] of slice) {
      const [r, g, b] = getPixel(x, y);
      sumR += r;
      sumG += g;
      sumB += b;
    }
    const n = slice.length;
    const meanR = sumR / n;
    const meanG = sumG / n;
    const meanB = sumB / n;

    let varSum = 0;
    let highDiffCount = 0;
    for (let i = 0; i < slice.length; i++) {
      const [x, y] = slice[i];
      const [r, g, b] = getPixel(x, y);
      const dr = r - meanR;
      const dg = g - meanG;
      const db = b - meanB;
      const distSq = (dr * dr + dg * dg + db * db) / 3;
      varSum += distSq;
      if (Math.sqrt(distSq) > stdDevThreshold * 1.8) {
        highDiffCount++;
      }
    }

    const stdDev = Math.sqrt(varSum / n);
    const activeEdgeRatio = highDiffCount / n;
    return {
      mean: [meanR, meanG, meanB] as [number, number, number],
      stdDev,
      activeEdgeRatio
    };
  };

  const colorDist = (a: [number, number, number], b: [number, number, number]) => {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  };

  /**
   * Scans inward from an edge. Allows passing through a thin decorative line (1-4px)
   * if the line itself is uniform along its length and is followed by more uniform margin.
   */
  const scanEdge = (
    maxSteps: number,
    getLineCoords: (step: number) => Array<[number, number]>
  ): number => {
    const firstLine = analyzeLine(getLineCoords(0));
    // If the very outer edge is already full of varied photographic detail, there is no border on this side
    if (firstLine.stdDev > stdDevThreshold * 1.35 && firstLine.activeEdgeRatio > 0.12) {
      return 0;
    }

    const baseColor = firstLine.mean;
    let lastBorderStep = -1;
    let nonBorderStreak = 0;

    for (let step = 0; step < maxSteps; step++) {
      const stats = analyzeLine(getLineCoords(step));
      const distFromBase = colorDist(stats.mean, baseColor);

      // A line is considered part of a border/frame if:
      // 1. It is very uniform along its length (low stdDev and few outlier pixels), AND
      // 2. Either it matches the outer border color OR it is a uniform frame rule line (very low stdDev)
      const isUniformSameColor =
        stats.stdDev <= stdDevThreshold &&
        stats.activeEdgeRatio <= 0.08 &&
        distFromBase <= colorDiffThreshold;

      const isUniformFrameLine =
        stats.stdDev <= stdDevThreshold * 0.75 &&
        stats.activeEdgeRatio <= 0.05;

      if (isUniformSameColor || isUniformFrameLine) {
        lastBorderStep = step;
        nonBorderStreak = 0;
      } else {
        nonBorderStreak++;
        // Allow bridging a 1-2px anti-aliased transition between outer margin and inner frame line
        if (nonBorderStreak >= 2) {
          break;
        }
      }
    }

    if (lastBorderStep < 0) return 0;
    // Add 1 step safety inset if a border was found so anti-aliased border fringe is cleanly removed
    return Math.min(maxSteps, lastBorderStep + 1);
  };

  const maxTopBottom = Math.floor(sh * maxScanRatio);
  const maxLeftRight = Math.floor(sw * maxScanRatio);

  const topSteps = scanEdge(maxTopBottom, (y) =>
    Array.from({ length: sw }, (_, x) => [x, y] as [number, number])
  );
  const bottomSteps = scanEdge(maxTopBottom, (step) =>
    Array.from({ length: sw }, (_, x) => [x, sh - 1 - step] as [number, number])
  );
  const leftSteps = scanEdge(maxLeftRight, (x) =>
    Array.from({ length: sh }, (_, y) => [x, y] as [number, number])
  );
  const rightSteps = scanEdge(maxLeftRight, (step) =>
    Array.from({ length: sh }, (_, y) => [sw - 1 - step, y] as [number, number])
  );

  // Convert scaled steps back to original image pixels, adding a 1px clean-up margin when > 0
  const toOrigX = (steps: number) =>
    steps > 0 ? Math.min(Math.floor(w * maxScanRatio), Math.ceil(steps / scale) + 1) : 0;
  const toOrigY = (steps: number) =>
    steps > 0 ? Math.min(Math.floor(h * maxScanRatio), Math.ceil(steps / scale) + 1) : 0;

  return {
    top: toOrigY(topSteps),
    right: toOrigX(rightSteps),
    bottom: toOrigY(bottomSteps),
    left: toOrigX(leftSteps)
  };
}

/**
 * Analyzes the trimmed image to locate important regions:
 * - Faces / skin tones / upper-torso portraits
 * - High-detail foreground objects such as musical instruments (strings, brass, woodwinds, piano, etc.)
 * - Foreground regions contrasting against the studio/environmental background
 */
export async function analyzeSubjectAndInstruments(
  img: HTMLImageElement | HTMLCanvasElement,
  trim: TrimBounds
): Promise<SaliencyFocus> {
  const trimX = trim.left;
  const trimY = trim.top;
  const trimW = Math.max(16, img.width - trim.left - trim.right);
  const trimH = Math.max(16, img.height - trim.top - trim.bottom);

  // Analysis grid size
  const aw = 120;
  const ah = Math.max(60, Math.round((trimH / trimW) * aw));

  const canvas = document.createElement('canvas');
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      centerX: 0.5,
      centerY: 0.42,
      importantBox: { x: trimX, y: trimY, width: trimW, height: trimH },
      isWideSubject: false
    };
  }

  ctx.drawImage(img, trimX, trimY, trimW, trimH, 0, 0, aw, ah);
  const data = ctx.getImageData(0, 0, aw, ah).data;

  // 1. Estimate background color from outer perimeter of the trimmed image (top, left, right edges)
  const bgSamples: Array<[number, number, number]> = [];
  for (let x = 0; x < aw; x += 2) {
    const iTop = x * 4;
    bgSamples.push([data[iTop], data[iTop + 1], data[iTop + 2]]);
  }
  for (let y = 0; y < Math.floor(ah * 0.7); y += 2) {
    const iLeft = (y * aw) * 4;
    const iRight = (y * aw + (aw - 1)) * 4;
    bgSamples.push([data[iLeft], data[iLeft + 1], data[iLeft + 2]]);
    bgSamples.push([data[iRight], data[iRight + 1], data[iRight + 2]]);
  }

  let bgR = 0, bgG = 0, bgB = 0;
  for (const [r, g, b] of bgSamples) {
    bgR += r;
    bgG += g;
    bgB += b;
  }
  bgR /= Math.max(1, bgSamples.length);
  bgG /= Math.max(1, bgSamples.length);
  bgB /= Math.max(1, bgSamples.length);

  // 2. Compute luminance map for Sobel edge detection (instruments & facial features have crisp edges)
  const lum = new Float32Array(aw * ah);
  for (let i = 0; i < aw * ah; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // 3. Optional native FaceDetector boost if supported by the browser
  const faceBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  try {
    const FaceDetectorCtor = (window as unknown as { FaceDetector?: new () => { detect: (src: HTMLCanvasElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }).FaceDetector;
    if (FaceDetectorCtor) {
      const detector = new FaceDetectorCtor();
      const detected = await detector.detect(canvas);
      for (const f of detected) {
        faceBoxes.push({
          x: f.boundingBox.x / aw,
          y: f.boundingBox.y / ah,
          w: f.boundingBox.width / aw,
          h: f.boundingBox.height / ah
        });
      }
    }
  } catch {
    // Fallback to heuristic skin + feature + instrument saliency
  }

  // 4. Build combined saliency map (Face/Skin + Instrument Edge Detail + Background Contrast)
  const saliency = new Float32Array(aw * ah);

  for (let y = 1; y < ah - 1; y++) {
    const ny = y / ah;
    for (let x = 1; x < aw - 1; x++) {
      const nx = x / aw;
      const i = y * aw + x;
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Sobel gradient (strong on eyes, hair, glasses, violin strings, brass tubing, piano keys, guitar frets)
      const gx =
        -lum[(y - 1) * aw + (x - 1)] + lum[(y - 1) * aw + (x + 1)] +
        -2 * lum[y * aw + (x - 1)] + 2 * lum[y * aw + (x + 1)] +
        -lum[(y + 1) * aw + (x - 1)] + lum[(y + 1) * aw + (x + 1)];
      const gy =
        -lum[(y - 1) * aw + (x - 1)] - 2 * lum[(y - 1) * aw + x] - lum[(y - 1) * aw + (x + 1)] +
        lum[(y + 1) * aw + (x - 1)] + 2 * lum[(y + 1) * aw + x] + lum[(y + 1) * aw + (x + 1)];
      const edgeMag = Math.min(255, Math.sqrt(gx * gx + gy * gy)) / 255;

      // Foreground separation from background perimeter color
      const bgDist = Math.min(
        255,
        Math.sqrt(((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2) / 3)
      ) / 255;

      // Skin-tone & warm wood/brass instrument hue likelihood (YCbCr skin/warmth model)
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const isSkinOrWarmInstrument =
        cr >= 132 && cr <= 178 && cb >= 75 && cb <= 130 && r > 55 && g > 35;

      // Portrait spatial prior: upper-middle for head, middle-lower for held instruments
      const centerBiasX = 1 - 0.35 * Math.pow((nx - 0.5) * 2, 2);
      const portraitBiasY = ny < 0.12 ? 0.75 : ny < 0.88 ? 1.0 : 0.7;

      let score =
        (edgeMag * 0.52 + bgDist * 0.33 + (isSkinOrWarmInstrument ? 0.28 : 0)) *
        centerBiasX *
        portraitBiasY;

      // Extra boost if paired skin + detail in typical head region (ny 0.10..0.55)
      if (isSkinOrWarmInstrument && edgeMag > 0.18 && ny >= 0.08 && ny <= 0.58) {
        score *= 1.45;
      }

      // Boost native detected faces if present
      for (const fb of faceBoxes) {
        if (nx >= fb.x && nx <= fb.x + fb.w && ny >= fb.y && ny <= fb.y + fb.h) {
          score += 1.2;
        }
      }

      saliency[i] = score;
    }
  }

  // 5. Find threshold for important subject + instrument pixels
  const sortedScores = Array.from(saliency).sort((a, b) => a - b);
  const p82 = sortedScores[Math.floor(sortedScores.length * 0.82)] || 0.15;
  const threshold = Math.max(0.12, p82);

  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = aw, maxX = 0, minY = ah, maxY = 0;

  for (let y = 1; y < ah - 1; y++) {
    for (let x = 1; x < aw - 1; x++) {
      const s = saliency[y * aw + x];
      if (s >= threshold) {
        const w = s * s;
        sumW += w;
        sumX += (x / aw) * w;
        sumY += (y / ah) * w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (sumW <= 0) {
    return {
      centerX: 0.5,
      centerY: 0.42,
      importantBox: { x: trimX, y: trimY, width: trimW, height: trimH },
      isWideSubject: false
    };
  }

  const centerX = Math.max(0.1, Math.min(0.9, sumX / sumW));
  const centerY = Math.max(0.1, Math.min(0.9, sumY / sumW));

  // Add headroom above top of detected head/subject so hair/head is never clipped
  const normMinX = Math.max(0, (minX / aw) - 0.05);
  const normMaxX = Math.min(1, (maxX / aw) + 0.05);
  const normMinY = Math.max(0, (minY / ah) - 0.08);
  const normMaxY = Math.min(1, (maxY / ah) + 0.06);

  const importantBox: CropRect = {
    x: Math.round(trimX + normMinX * trimW),
    y: Math.round(trimY + normMinY * trimH),
    width: Math.max(16, Math.round((normMaxX - normMinX) * trimW)),
    height: Math.max(16, Math.round((normMaxY - normMinY) * trimH))
  };

  // Check if the important subject span is significantly wider than 3:4
  const subjectAspect = importantBox.width / importantBox.height;
  const isWideSubject = subjectAspect > TARGET_ASPECT * 1.22 && (trimW / trimH) > TARGET_ASPECT * 1.15;

  return {
    centerX,
    centerY,
    importantBox,
    isWideSubject
  };
}

/**
 * Computes the optimal 3:4 crop rectangle inside the border-trimmed image,
 * maximizing coverage so neither the face/head nor the musical instrument is cut off.
 */
export function computeOptimalCropRect(
  origWidth: number,
  origHeight: number,
  trim: TrimBounds,
  focus: SaliencyFocus
): CropRect {
  const availX = trim.left;
  const availY = trim.top;
  const availW = Math.max(12, origWidth - trim.left - trim.right);
  const availH = Math.max(16, origHeight - trim.top - trim.bottom);
  const availAspect = availW / availH;

  // Use the largest 3:4 box that fits inside the border-trimmed area so we don't cut off instruments/hands
  let cropW: number;
  let cropH: number;

  if (availAspect > TARGET_ASPECT) {
    // Image is wider than 3:4 -> full height is preserved, position X smartly over face + instrument
    cropH = availH;
    cropW = Math.round(cropH * TARGET_ASPECT);
  } else {
    // Image is taller than 3:4 -> full width is preserved, position Y to protect headroom + instrument
    cropW = availW;
    cropH = Math.round(cropW / TARGET_ASPECT);
  }

  // Desired center based on subject + instrument importance box & weighted centroid
  const impCenterX = focus.importantBox.x + focus.importantBox.width / 2;
  const impCenterY = focus.importantBox.y + focus.importantBox.height / 2;
  const focusPixelX = availX + focus.centerX * availW;
  const focusPixelY = availY + focus.centerY * availH;

  const targetCenterX = 0.55 * focusPixelX + 0.45 * impCenterX;
  // Slightly favor upper-middle headroom while respecting instrument bottom
  const targetCenterY = 0.5 * focusPixelY + 0.5 * impCenterY;

  let cropX = Math.round(targetCenterX - cropW / 2);
  let cropY = Math.round(targetCenterY - cropH / 2);

  // Ensure the top of the importantBox (headroom) is not cut off if the image is taller than 3:4
  if (cropY > focus.importantBox.y) {
    cropY = focus.importantBox.y;
  }

  // Clamp inside available (border-trimmed) bounds
  cropX = Math.max(availX, Math.min(availX + availW - cropW, cropX));
  cropY = Math.max(availY, Math.min(availY + availH - cropH, cropY));

  return {
    x: cropX,
    y: cropY,
    width: cropW,
    height: cropH
  };
}

/**
 * High-quality multi-step canvas downscaling to avoid aliasing when resizing high-res photos to 360×480.
 */
function drawHighQualityResized(
  source: HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  destCtx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  // Extract source region at full resolution first
  let curCanvas = document.createElement('canvas');
  curCanvas.width = Math.max(1, Math.round(sw));
  curCanvas.height = Math.max(1, Math.round(sh));
  let curCtx = curCanvas.getContext('2d');
  if (!curCtx) return;

  curCtx.imageSmoothingEnabled = true;
  curCtx.imageSmoothingQuality = 'high';
  curCtx.drawImage(source, sx, sy, sw, sh, 0, 0, curCanvas.width, curCanvas.height);

  // Step down by 50% increments until within 2x of target size
  while (curCanvas.width * 0.5 > dw && curCanvas.height * 0.5 > dh) {
    const nextW = Math.max(dw, Math.round(curCanvas.width * 0.5));
    const nextH = Math.max(dh, Math.round(curCanvas.height * 0.5));
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = nextW;
    nextCanvas.height = nextH;
    const nextCtx = nextCanvas.getContext('2d');
    if (!nextCtx) break;
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(curCanvas, 0, 0, curCanvas.width, curCanvas.height, 0, 0, nextW, nextH);
    curCanvas = nextCanvas;
    curCtx = nextCtx;
  }

  destCtx.imageSmoothingEnabled = true;
  destCtx.imageSmoothingQuality = 'high';
  destCtx.drawImage(curCanvas, 0, 0, curCanvas.width, curCanvas.height, dx, dy, dw, dh);
}

/**
 * Determines output dimensions according to the rule:
 * - Standard target: 360px × 480px (3:4)
 * - If the source cropped region is smaller than 360×480, keep its original scale and only match the 3:4 aspect ratio.
 */
export function computeOutputDimensions(sourceWidth: number, sourceHeight: number): {
  outputWidth: number;
  outputHeight: number;
  wasKeptOriginalScale: boolean;
} {
  if (sourceWidth >= TARGET_WIDTH && sourceHeight >= TARGET_HEIGHT) {
    return {
      outputWidth: TARGET_WIDTH,
      outputHeight: TARGET_HEIGHT,
      wasKeptOriginalScale: false
    };
  }

  // Smaller than 360×480: do not upscale; keep largest integer 3:4 dimensions <= source
  const baseUnit = Math.max(1, Math.floor(Math.min(sourceWidth / 3, sourceHeight / 4)));
  return {
    outputWidth: baseUnit * 3,
    outputHeight: baseUnit * 4,
    wasKeptOriginalScale: true
  };
}

/**
 * Renders the final processed Author Bio JPEG photo.
 */
export async function renderAuthorBioPhoto(
  img: HTMLImageElement,
  trim: TrimBounds,
  cropRect: CropRect,
  options: PhotoProcessOptions
): Promise<ProcessedPhotoResult> {
  const availX = trim.left;
  const availY = trim.top;
  const availW = Math.max(12, img.width - trim.left - trim.right);
  const availH = Math.max(16, img.height - trim.top - trim.bottom);

  let outputWidth: number;
  let outputHeight: number;
  let wasKeptOriginalScale: boolean;

  if (options.fitMode === 'crop') {
    const dims = computeOutputDimensions(cropRect.width, cropRect.height);
    outputWidth = dims.outputWidth;
    outputHeight = dims.outputHeight;
    wasKeptOriginalScale = dims.wasKeptOriginalScale;
  } else {
    // In contain mode (no crop, full trimmed image fitted into 3:4 canvas):
    // The 3:4 bounding canvas around the trimmed image has effective size:
    const containW = Math.max(availW, Math.round(availH * TARGET_ASPECT));
    const containH = Math.round(containW / TARGET_ASPECT);
    const dims = computeOutputDimensions(containW, containH);
    outputWidth = dims.outputWidth;
    outputHeight = dims.outputHeight;
    wasKeptOriginalScale = dims.wasKeptOriginalScale;
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outputWidth;
  outCanvas.height = outputHeight;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }

  // Fill base background for JPEG
  ctx.fillStyle = options.padColor || '#f4f3ef';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (options.fitMode === 'crop') {
    drawHighQualityResized(
      img,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      ctx,
      0,
      0,
      outputWidth,
      outputHeight
    );
  } else {
    // Contain mode: preserve the entire border-trimmed image inside the 3:4 frame
    if (options.fitMode === 'contain-blur') {
      ctx.save();
      ctx.filter = 'blur(18px) brightness(0.92)';
      // Cover background with blurred ambient fill from trimmed area
      const coverScale = Math.max(outputWidth / availW, outputHeight / availH) * 1.1;
      const bw = availW * coverScale;
      const bh = availH * coverScale;
      ctx.drawImage(
        img,
        availX,
        availY,
        availW,
        availH,
        (outputWidth - bw) / 2,
        (outputHeight - bh) / 2,
        bw,
        bh
      );
      ctx.restore();
    }

    const scale = Math.min(outputWidth / availW, outputHeight / availH);
    const drawW = Math.round(availW * scale);
    const drawH = Math.round(availH * scale);
    const drawX = Math.round((outputWidth - drawW) / 2);
    const drawY = Math.round((outputHeight - drawH) / 2);

    drawHighQualityResized(
      img,
      availX,
      availY,
      availW,
      availH,
      ctx,
      drawX,
      drawY,
      drawW,
      drawH
    );
  }

  const quality = Math.max(0.5, Math.min(1, options.jpegQuality || 0.92));
  const dataUrl = outCanvas.toDataURL('image/jpeg', quality);
  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode JPEG blob'))),
      'image/jpeg',
      quality
    );
  });

  const hasBorderRemoved =
    trim.top > 0 || trim.right > 0 || trim.bottom > 0 || trim.left > 0;

  return {
    blob,
    dataUrl,
    outputWidth,
    outputHeight,
    originalWidth: img.width,
    originalHeight: img.height,
    trimmedBounds: trim,
    hasBorderRemoved,
    cropRect,
    wasKeptOriginalScale,
    fileSizeBytes: blob.size
  };
}

/**
 * Generates a realistic synthetic sample Author Bio photo (with a white & dark frame,
 * portrait of an author holding a cello/violin bow) so editors can test border removal
 * and smart 3:4 framing immediately.
 */
export async function createSampleAuthorPhotoFile(): Promise<File> {
  const w = 920;
  const h = 1040;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 1. Outer white border + thin dark frame line (to demonstrate automatic border removal!)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#262624';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, w - 72, h - 72);

  // Inner photo area: (44, 44) to (w-44, h-44)
  const ix = 44;
  const iy = 44;
  const iw = w - 88;
  const ih = h - 88;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();

  // Warm concert hall / studio gradient background
  const bgGrad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  bgGrad.addColorStop(0, '#2c3038');
  bgGrad.addColorStop(0.5, '#393d46');
  bgGrad.addColorStop(1, '#23262d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(ix, iy, iw, ih);

  // Subtle ambient stage glow
  const glow = ctx.createRadialGradient(w * 0.48, h * 0.36, 30, w * 0.48, h * 0.36, 360);
  glow.addColorStop(0, 'rgba(235, 200, 155, 0.22)');
  glow.addColorStop(1, 'rgba(235, 200, 155, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(ix, iy, iw, ih);

  // Shoulders / Concert Attire
  ctx.fillStyle = '#181a1f';
  ctx.beginPath();
  ctx.ellipse(w * 0.46, h * 0.78, 220, 195, 0, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  // Collar / Shirt V
  ctx.fillStyle = '#f2efe9';
  ctx.beginPath();
  ctx.moveTo(w * 0.41, h * 0.58);
  ctx.lineTo(w * 0.51, h * 0.58);
  ctx.lineTo(w * 0.46, h * 0.72);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = '#d9a17c';
  ctx.fillRect(w * 0.425, h * 0.47, 64, 110);

  // Head (warm skin tone)
  ctx.fillStyle = '#e4ad88';
  ctx.beginPath();
  ctx.ellipse(w * 0.46, h * 0.36, 92, 118, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = '#2a1e17';
  ctx.beginPath();
  ctx.ellipse(w * 0.46, h * 0.28, 98, 58, -0.08, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fill();

  // Eyes, Eyebrows, Smile (creates realistic facial edge energy)
  ctx.fillStyle = '#2a1e17';
  ctx.beginPath();
  ctx.arc(w * 0.425, h * 0.345, 7, 0, Math.PI * 2);
  ctx.arc(w * 0.495, h * 0.345, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#8b573c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w * 0.46, h * 0.395, 26, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Musical Instrument (Violin / Cello scroll, neck, fingerboard, strings, and body on right-lower side)
  ctx.save();
  ctx.translate(w * 0.62, h * 0.64);
  ctx.rotate(0.24);

  // Instrument wooden body
  const woodGrad = ctx.createLinearGradient(-90, -40, 90, 180);
  woodGrad.addColorStop(0, '#b55424');
  woodGrad.addColorStop(0.5, '#cd6b32');
  woodGrad.addColorStop(1, '#7e3312');
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.ellipse(0, 45, 95, 125, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3b1606';
  ctx.lineWidth = 4;
  ctx.stroke();

  // F-holes
  ctx.strokeStyle = '#240c02';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-36, 15);
  ctx.bezierCurveTo(-48, 45, -24, 65, -38, 92);
  ctx.moveTo(36, 15);
  ctx.bezierCurveTo(48, 45, 24, 65, 38, 92);
  ctx.stroke();

  // Fingerboard & Neck extending up
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(-16, -240, 32, 260);

  // Scroll & Pegs at top of instrument
  ctx.fillStyle = '#9c4318';
  ctx.beginPath();
  ctx.arc(0, -255, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b1206';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Strings (high frequency metallic lines)
  ctx.strokeStyle = '#e8e4d8';
  ctx.lineWidth = 1.6;
  for (const sx of [-9, -3, 3, 9]) {
    ctx.beginPath();
    ctx.moveTo(sx, -240);
    ctx.lineTo(sx * 1.3, 120);
    ctx.stroke();
  }

  // Bridge
  ctx.fillStyle = '#e0b589';
  ctx.fillRect(-26, 52, 52, 10);

  ctx.restore();
  ctx.restore();

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  );
  return new File([blob], 'sample_author_musician_framed.png', { type: 'image/png' });
}

/**
 * Generates a small (< 360x480) sample author photo (e.g. 260x310 with a thin white border)
 * to demonstrate preserving original pixel scale while matching the 3:4 aspect ratio.
 */
export async function createSmallSampleAuthorPhotoFile(): Promise<File> {
  const w = 260;
  const h = 310;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 10px white border around small photo
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const ix = 10;
  const iy = 10;
  const iw = w - 20; // 240
  const ih = h - 20; // 290

  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();

  // Soft warm backdrop
  const grad = ctx.createLinearGradient(ix, iy, ix, iy + ih);
  grad.addColorStop(0, '#44525d');
  grad.addColorStop(1, '#2b353d');
  ctx.fillStyle = grad;
  ctx.fillRect(ix, iy, iw, ih);

  // Shoulders
  ctx.fillStyle = '#1d2226';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.84, 78, 65, 0, Math.PI, 0, false);
  ctx.fill();

  // Head
  ctx.fillStyle = '#e2af8a';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.42, 34, 43, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = '#38271d';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.32, 36, 22, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Brass Trumpet / Flute held horizontally near lower third
  ctx.strokeStyle = '#e5c158';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(w * 0.25, h * 0.68);
  ctx.lineTo(w * 0.78, h * 0.65);
  ctx.stroke();

  // Trumpet bell
  ctx.fillStyle = '#e5c158';
  ctx.beginPath();
  ctx.moveTo(w * 0.72, h * 0.65);
  ctx.lineTo(w * 0.85, h * 0.58);
  ctx.lineTo(w * 0.85, h * 0.72);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  );
  return new File([blob], 'small_author_photo_260x310.png', { type: 'image/png' });
}

