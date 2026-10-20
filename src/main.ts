/**
 * Symposium Dashboard - Main Application Orchestrator
 * Integrates:
 * 1. Table Formatter
 * 2. Article Formatter
 * 3. Reference Formatter
 * 4. Editorial Board Formatter
 * 5. Italic Highlighter
 */

import { initTableFormatter } from './modules/table-formatter-adapter';
import { convertDocxToArticleHtml } from './modules/article-formatter';
import { formatReferences } from './modules/references';
import { parseMembers, formatMembers } from './modules/editorial-board';
import { highlightItalicsInDocx } from './modules/italic-highlighter';
import JSZip from 'jszip';
import {
  loadImageFromFile,
  detectImageBorders,
  analyzeSubjectAndInstruments,
  computeOptimalCropRect,
  renderAuthorBioPhoto,
  createSampleAuthorPhotoFile,
  createSmallSampleAuthorPhotoFile,
  TARGET_ASPECT,
  type TrimBounds,
  type CropRect,
  type SaliencyFocus,
  type ProcessedPhotoResult
} from './modules/author-photo';
import {
  generateAltTextForItem,
  createSampleAltTextBatchFiles,
  type AltTextItem,
  type ImageCategory,
  type AltTextStyle,
  type AltEngineMode
} from './modules/alt-text-generator';

// Global Toast utility
export function showToast(message: string, isError: boolean = false) {
  const toast = document.getElementById("app-toast");
  const msgEl = document.getElementById("toast-message");
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");

  setTimeout(() => {
    toast.classList.remove("visible");
  }, 2800);
}

// Global Theme Engine
function initTheme() {
  const savedTheme = localStorage.getItem("symposium-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  
  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.body.classList.add("dark-theme");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.body.classList.remove("dark-theme");
    document.documentElement.setAttribute("data-theme", "light");
  }

  const toggleBtn = document.getElementById("btn-theme-toggle");
  toggleBtn?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-theme");
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    localStorage.setItem("symposium-theme", isDark ? "dark" : "light");
  });
}

// Tool Switching Navigation
function initToolNavigation() {
  const toolNavButtons = document.querySelectorAll<HTMLButtonElement>(".tool-nav-btn");
  const toolViews = document.querySelectorAll<HTMLElement>(".tool-view");

  toolNavButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const toolId = btn.getAttribute("data-tool");
      if (!toolId) return;

      toolNavButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      toolViews.forEach(v => {
        v.classList.toggle("active", v.id === `view-${toolId}`);
      });
    });
  });
}

// 2. Article Formatter Controller
function initArticleFormatterController() {
  const dropzone = document.getElementById("art-dropzone") as HTMLElement;
  const fileInput = document.getElementById("art-file-input") as HTMLInputElement;
  const fileNameDisplay = document.getElementById("art-file-name") as HTMLElement;
  const btnConvert = document.getElementById("btn-convert-article") as HTMLButtonElement;
  const previewContainer = document.getElementById("art-preview-content") as HTMLElement;
  const codeContainer = document.getElementById("art-code-container") as HTMLTextAreaElement;
  const statusBadge = document.getElementById("art-status-badge") as HTMLElement;

  const btnViewPreview = document.getElementById("btn-art-view-preview") as HTMLButtonElement;
  const btnViewCode = document.getElementById("btn-art-view-code") as HTMLButtonElement;
  const btnCopyHtml = document.getElementById("btn-copy-art-html") as HTMLButtonElement;
  const btnDownloadHtml = document.getElementById("btn-download-art-html") as HTMLButtonElement;

  const optRefs = document.getElementById("art-opt-references") as HTMLInputElement;
  const optFootnotes = document.getElementById("art-opt-footnotes") as HTMLInputElement;
  const optSkip = document.getElementById("art-opt-skip") as HTMLInputElement;
  const optH3 = document.getElementById("art-opt-h3") as HTMLTextAreaElement;

  let currentFile: File | null = null;
  let generatedHtml: string = "";

  dropzone?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      currentFile = target.files[0];
      fileNameDisplay.textContent = currentFile.name;
      statusBadge.textContent = "File Selected";
      statusBadge.classList.add("success");
    }
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone?.addEventListener("drop", (e: DragEvent) => {
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".docx")) {
        currentFile = file;
        fileNameDisplay.textContent = currentFile.name;
        statusBadge.textContent = "File Selected";
        statusBadge.classList.add("success");
      } else {
        showToast("Please provide a Word .docx file", true);
      }
    }
  });

  const previewWrapper = document.getElementById("art-preview-wrapper") as HTMLElement;

  btnViewPreview?.addEventListener("click", () => {
    btnViewPreview.classList.add("active");
    btnViewCode.classList.remove("active");
    if (previewWrapper) previewWrapper.style.display = "block";
    codeContainer.style.display = "none";
  });

  btnViewCode?.addEventListener("click", () => {
    btnViewCode.classList.add("active");
    btnViewPreview.classList.remove("active");
    if (previewWrapper) previewWrapper.style.display = "none";
    codeContainer.style.display = "block";
  });


  btnConvert?.addEventListener("click", async () => {
    if (!currentFile) {
      showToast("Please select a .docx file first!", true);
      return;
    }

    try {
      statusBadge.textContent = "Converting...";
      const h3Set = new Set(
        optH3.value.split("\n").map(s => s.trim()).filter(Boolean)
      );

      generatedHtml = await convertDocxToArticleHtml(currentFile, {
        skipLeading: parseInt(optSkip.value, 10) || 0,
        includeReferences: optRefs.checked,
        includeFootnotes: optFootnotes.checked,
        h3Headings: h3Set
      });

      previewContainer.innerHTML = generatedHtml;
      codeContainer.value = generatedHtml;
      statusBadge.textContent = "Converted!";
      statusBadge.classList.add("success");
      showToast("Article converted to Joomla HTML!");
    } catch (err: any) {
      console.error(err);
      statusBadge.textContent = "Error";
      statusBadge.classList.remove("success");
      showToast(err?.message || "Failed to convert article", true);
    }
  });

  btnCopyHtml?.addEventListener("click", async () => {
    if (!generatedHtml) {
      showToast("No HTML converted yet", true);
      return;
    }
    await navigator.clipboard.writeText(generatedHtml);
    showToast("Joomla HTML copied to clipboard!");
  });

  btnDownloadHtml?.addEventListener("click", () => {
    if (!generatedHtml) {
      showToast("No HTML converted yet", true);
      return;
    }
    const blob = new Blob([generatedHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (currentFile?.name.replace(/\.docx$/i, "") || "symposium_article") + ".html";
    a.click();
    URL.revokeObjectURL(url);
    showToast("HTML file downloaded!");
  });
}

// 3. Reference Formatter Controller
function initReferenceFormatterController() {
  const refInput = document.getElementById("ref-input") as HTMLTextAreaElement;
  const btnFormat = document.getElementById("btn-format-refs") as HTMLButtonElement;
  const btnLoadSample = document.getElementById("btn-load-sample-ref") as HTMLButtonElement;
  const previewContainer = document.getElementById("ref-preview-content") as HTMLElement;
  const codeContainer = document.getElementById("ref-code-container") as HTMLTextAreaElement;
  const btnCopyHtml = document.getElementById("btn-copy-ref-html") as HTMLButtonElement;

  const btnViewPreview = document.getElementById("btn-ref-view-preview") as HTMLButtonElement;
  const btnViewCode = document.getElementById("btn-ref-view-code") as HTMLButtonElement;

  let formattedHtml = "";

  const previewWrapper = document.getElementById("ref-preview-wrapper") as HTMLElement;

  btnViewPreview?.addEventListener("click", () => {
    btnViewPreview.classList.add("active");
    btnViewCode.classList.remove("active");
    if (previewWrapper) previewWrapper.style.display = "block";
    codeContainer.style.display = "none";
  });

  btnViewCode?.addEventListener("click", () => {
    btnViewCode.classList.add("active");
    btnViewPreview.classList.remove("active");
    if (previewWrapper) previewWrapper.style.display = "none";
    codeContainer.style.display = "block";
  });


  btnLoadSample?.addEventListener("click", () => {
    refInput.value = `1. Adams, J. (2020). Performance practice in contemporary brass literature. Journal of Music Research, 45(2), 112–128. https://doi.org/10.1080/01411896.2020.1234567

2. Davis, M. K. (2021). Modal improvisation in early modern jazz pedagogy. Jazz Education Network Journal, 14, 30–48. doi: 10.1111/jenj.12004

3. Miller, R. (2016). Structure and Style in Vocal Pedagogy. New York: Schirmer.`;
    showToast("Sample references loaded!");
  });

  btnFormat?.addEventListener("click", () => {
    const raw = refInput.value.trim();
    if (!raw) {
      showToast("Please enter references to format", true);
      return;
    }

    formattedHtml = formatReferences(raw);
    previewContainer.innerHTML = formattedHtml;
    codeContainer.value = formattedHtml;
    showToast("References formatted!");
  });

  btnCopyHtml?.addEventListener("click", async () => {
    if (!formattedHtml) {
      showToast("Nothing to copy", true);
      return;
    }
    await navigator.clipboard.writeText(formattedHtml);
    showToast("Reference HTML copied!");
  });
}

// 4. Editorial Board Formatter Controller
function initEditorialBoardController() {
  const input = document.getElementById("board-input") as HTMLTextAreaElement;
  const output = document.getElementById("board-output") as HTMLTextAreaElement;
  const btnFormat = document.getElementById("btn-format-board") as HTMLButtonElement;
  const btnSample = document.getElementById("btn-load-sample-board") as HTMLButtonElement;
  const btnCopy = document.getElementById("btn-copy-board") as HTMLButtonElement;
  const countBadge = document.getElementById("board-count-badge") as HTMLElement;

  btnSample?.addEventListener("click", () => {
    input.value = `Scholarship and Research
Sarah Allen (2022-2025)
Southern Methodist University

Clifton Boyd (2022-2025)
New York University

Melissa Brunkan (2022-2025)
University of Oregon

Music Business-Industry
Scott Barton
Worcester Polytechnic Institute

Forums
Andrew Adams, Performance
Western Carolina University`;
    showToast("Loaded sample roster copy!");
  });

  btnFormat?.addEventListener("click", () => {
    const raw = input.value.trim();
    if (!raw) {
      showToast("Please paste raw editorial board text first", true);
      return;
    }

    const members = parseMembers(raw);
    countBadge.textContent = `${members.length} members`;
    countBadge.classList.toggle("success", members.length > 0);

    const formatType = (document.querySelector('input[name="board-format-type"]:checked') as HTMLInputElement)?.value as 'text' | 'html' || 'text';
    const result = formatMembers(members, formatType);
    output.value = result;
    showToast(`Formatted ${members.length} members!`);
  });

  btnCopy?.addEventListener("click", async () => {
    if (!output.value) {
      showToast("No output to copy", true);
      return;
    }
    await navigator.clipboard.writeText(output.value);
    showToast("Editorial board list copied!");
  });
}

// 5. Italic Highlighter Controller
function initItalicHighlighterController() {
  const dropzone = document.getElementById("italic-dropzone") as HTMLElement;
  const fileInput = document.getElementById("italic-file-input") as HTMLInputElement;
  const fileNameDisplay = document.getElementById("italic-file-name") as HTMLElement;
  const btnProcess = document.getElementById("btn-process-italics") as HTMLButtonElement;
  const resultsBox = document.getElementById("italic-results-box") as HTMLElement;
  const btnDownload = document.getElementById("btn-download-highlighted-docx") as HTMLButtonElement;

  let currentFile: File | null = null;
  let resultBlob: Blob | null = null;
  let downloadFileName = "highlighted.docx";

  dropzone?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      currentFile = target.files[0];
      fileNameDisplay.textContent = currentFile.name;
      btnProcess.disabled = false;
    }
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone?.addEventListener("drop", (e: DragEvent) => {
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".docx")) {
        currentFile = file;
        fileNameDisplay.textContent = currentFile.name;
        btnProcess.disabled = false;
      } else {
        showToast("Please provide a Word .docx file", true);
      }
    }
  });

  btnProcess?.addEventListener("click", async () => {
    if (!currentFile) return;

    try {
      btnProcess.disabled = true;
      btnProcess.textContent = "Processing Italics...";
      resultsBox.innerHTML = `<div class="spinner"></div><p>Scanning text runs and applying yellow highlight...</p>`;

      const res = await highlightItalicsInDocx(currentFile, currentFile.name);
      resultBlob = res.blob;
      downloadFileName = res.fileName;

      resultsBox.innerHTML = `
        <div style="text-align: left; width: 100%; max-width: 320px; margin: 0 auto;">
          <h4 style="margin: 0 0 0.5rem; color: var(--text-primary);">Processing Complete!</h4>
          <p style="margin: 0.25rem 0; font-size: 0.85rem;"><strong>File:</strong> ${currentFile.name}</p>
          <p style="margin: 0.25rem 0; font-size: 0.85rem;"><strong>Italic Runs Detected:</strong> ${res.italicRunsFound}</p>
          <p style="margin: 0.25rem 0; font-size: 0.85rem;"><strong>Highlighted Yellow:</strong> ${res.italicRunsHighlighted}</p>
        </div>
      `;

      btnDownload.style.display = "block";
      showToast(`Highlighted ${res.italicRunsHighlighted} italic runs!`);
    } catch (err: any) {
      console.error(err);
      resultsBox.innerHTML = `<p class="empty-state" style="color: var(--error);">Error processing document: ${err?.message}</p>`;
      showToast("Failed to highlight italics", true);
    } finally {
      btnProcess.disabled = false;
      btnProcess.textContent = "Highlight Italics & Generate Download";
    }
  });

  btnDownload?.addEventListener("click", () => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadFileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded highlighted document!");
  });
}

// 6. Author Bio Photo Processor Controller
interface PhotoQueueItem {
  file: File;
  img: HTMLImageElement;
  trim: TrimBounds;
  focus: SaliencyFocus;
  cropRect: CropRect;
  zoomPercent: number;
  lastResult?: ProcessedPhotoResult;
}

function initAuthorPhotoController() {
  const dropzone = document.getElementById("photo-dropzone") as HTMLElement;
  const fileInput = document.getElementById("photo-file-input") as HTMLInputElement;
  const fileNameDisplay = document.getElementById("photo-file-name") as HTMLElement;
  const batchBar = document.getElementById("photo-batch-bar") as HTMLElement;
  const statusBadge = document.getElementById("photo-status-badge") as HTMLElement;

  const btnSampleFramed = document.getElementById("btn-photo-sample-framed") as HTMLButtonElement;
  const btnSampleSmall = document.getElementById("btn-photo-sample-small") as HTMLButtonElement;

  const optAutoTrim = document.getElementById("photo-opt-autotrim") as HTMLInputElement;
  const optShowGuides = document.getElementById("photo-opt-show-guides") as HTMLInputElement;
  const optTrimSens = document.getElementById("photo-opt-trim-sens") as HTMLInputElement;
  const trimSensVal = document.getElementById("photo-trim-sens-val") as HTMLElement;
  const optZoom = document.getElementById("photo-opt-zoom") as HTMLInputElement;
  const zoomVal = document.getElementById("photo-zoom-val") as HTMLElement;
  const optFitMode = document.getElementById("photo-opt-fitmode") as HTMLSelectElement;

  const btnAutoFrame = document.getElementById("btn-photo-auto-frame") as HTMLButtonElement;
  const btnCenter = document.getElementById("btn-photo-center") as HTMLButtonElement;
  const btnHeadroom = document.getElementById("btn-photo-headroom") as HTMLButtonElement;
  const btnInstrument = document.getElementById("btn-photo-instrument") as HTMLButtonElement;

  const interactiveCanvas = document.getElementById("photo-interactive-canvas") as HTMLCanvasElement;
  const stageEmpty = document.getElementById("photo-stage-empty") as HTMLElement;
  const wideWarning = document.getElementById("photo-wide-warning") as HTMLElement;

  const specOutput = document.getElementById("photo-spec-output") as HTMLElement;
  const specSource = document.getElementById("photo-spec-source") as HTMLElement;
  const specBorder = document.getElementById("photo-spec-border") as HTMLElement;
  const specFilesize = document.getElementById("photo-spec-filesize") as HTMLElement;

  const btnTabActual = document.getElementById("btn-photo-tab-actual") as HTMLButtonElement;
  const btnTabBio = document.getElementById("btn-photo-tab-bio") as HTMLButtonElement;
  const paneActual = document.getElementById("photo-pane-actual") as HTMLElement;
  const paneBio = document.getElementById("photo-pane-bio") as HTMLElement;

  const scaleNote = document.getElementById("photo-scale-note") as HTMLElement;
  const outputImg = document.getElementById("photo-output-img") as HTMLImageElement;
  const outputEmpty = document.getElementById("photo-output-empty") as HTMLElement;
  const bioPreviewImg = document.getElementById("photo-bio-preview-img") as HTMLImageElement;

  const outputFilenameInput = document.getElementById("photo-output-filename") as HTMLInputElement;
  const optQuality = document.getElementById("photo-opt-quality") as HTMLInputElement;
  const qualityVal = document.getElementById("photo-quality-val") as HTMLElement;

  const btnDownloadJpg = document.getElementById("btn-download-photo-jpg") as HTMLButtonElement;
  const btnCopyImg = document.getElementById("btn-copy-photo-img") as HTMLButtonElement;
  const btnDownloadZip = document.getElementById("btn-download-photo-zip") as HTMLButtonElement;

  let queue: PhotoQueueItem[] = [];
  let activeIndex = -1;
  let displayScale = 1;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let cropStartX = 0;
  let cropStartY = 0;

  const getActiveItem = (): PhotoQueueItem | null =>
    activeIndex >= 0 && activeIndex < queue.length ? queue[activeIndex] : null;

  const toJpgFilename = (origName: string): string => {
    const base = origName.replace(/\.[^.]+$/, "").trim() || "author-bio";
    return `${base}-bio.jpg`;
  };

  // Clamp a CropRect inside the active item's border-trimmed region
  const clampCropToTrim = (item: PhotoQueueItem, rect: CropRect): CropRect => {
    const availX = item.trim.left;
    const availY = item.trim.top;
    const availW = Math.max(12, item.img.width - item.trim.left - item.trim.right);
    const availH = Math.max(16, item.img.height - item.trim.top - item.trim.bottom);

    const w = Math.min(availW, Math.max(24, Math.round(rect.width)));
    const h = Math.min(availH, Math.max(32, Math.round(w / TARGET_ASPECT)));
    const finalW = Math.round(h * TARGET_ASPECT);

    const x = Math.max(availX, Math.min(availX + availW - finalW, Math.round(rect.x)));
    const y = Math.max(availY, Math.min(availY + availH - h, Math.round(rect.y)));

    return { x, y, width: finalW, height: h };
  };

  // Apply zoom percentage around current crop center
  const applyZoomToCrop = (item: PhotoQueueItem, zoomPct: number) => {
    const availX = item.trim.left;
    const availY = item.trim.top;
    const availW = Math.max(12, item.img.width - item.trim.left - item.trim.right);
    const availH = Math.max(16, item.img.height - item.trim.top - item.trim.bottom);

    let maxCropW: number;
    let maxCropH: number;
    if (availW / availH > TARGET_ASPECT) {
      maxCropH = availH;
      maxCropW = Math.round(maxCropH * TARGET_ASPECT);
    } else {
      maxCropW = availW;
      maxCropH = Math.round(maxCropW / TARGET_ASPECT);
    }

    const scale = Math.max(0.4, Math.min(1, zoomPct / 100));
    const newW = Math.max(24, Math.round(maxCropW * scale));
    const newH = Math.max(32, Math.round(newW / TARGET_ASPECT));

    const centerX = item.cropRect.x + item.cropRect.width / 2;
    const centerY = item.cropRect.y + item.cropRect.height / 2;

    item.zoomPercent = zoomPct;
    item.cropRect = clampCropToTrim(item, {
      x: Math.round(centerX - newW / 2),
      y: Math.round(centerY - newH / 2),
      width: newW,
      height: newH
    });

    // Ensure it stays within available area
    if (item.cropRect.x < availX) item.cropRect.x = availX;
    if (item.cropRect.y < availY) item.cropRect.y = availY;
  };

  // Render the interactive editor canvas with border overlay, subject box, and 3:4 crop frame
  const drawInteractiveStage = () => {
    const item = getActiveItem();
    if (!item) {
      interactiveCanvas.style.display = "none";
      stageEmpty.style.display = "flex";
      return;
    }

    interactiveCanvas.style.display = "block";
    stageEmpty.style.display = "none";

    const maxStageW = 500;
    const maxStageH = 410;
    displayScale = Math.min(1, maxStageW / item.img.width, maxStageH / item.img.height);

    const cw = Math.max(80, Math.round(item.img.width * displayScale));
    const ch = Math.max(80, Math.round(item.img.height * displayScale));

    interactiveCanvas.width = cw;
    interactiveCanvas.height = ch;

    const ctx = interactiveCanvas.getContext("2d");
    if (!ctx) return;

    // 1. Draw full original image
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(item.img, 0, 0, cw, ch);

    // 2. Darken outside area
    ctx.fillStyle = "rgba(15, 15, 14, 0.56)";
    ctx.fillRect(0, 0, cw, ch);

    const trim = item.trim;
    const tx = Math.round(trim.left * displayScale);
    const ty = Math.round(trim.top * displayScale);
    const tw = Math.round((item.img.width - trim.left - trim.right) * displayScale);
    const th = Math.round((item.img.height - trim.top - trim.bottom) * displayScale);

    // 3. Highlight excluded outer border if detected
    const hasBorder = trim.top > 0 || trim.right > 0 || trim.bottom > 0 || trim.left > 0;
    if (hasBorder && optShowGuides.checked) {
      ctx.save();
      ctx.strokeStyle = "rgba(239, 83, 80, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);

      // Label trimmed border
      ctx.fillStyle = "rgba(198, 40, 40, 0.88)";
      ctx.fillRect(6, 6, 134, 19);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 10px Outfit, sans-serif";
      ctx.fillText("Outer Border Excluded", 12, 19);
      ctx.restore();
    }

    const fitMode = optFitMode.value as 'crop' | 'contain-blur' | 'contain-solid';

    // 4. Reveal active crop region in full brightness
    const activeRect =
      fitMode === "crop"
        ? item.cropRect
        : {
            x: trim.left,
            y: trim.top,
            width: item.img.width - trim.left - trim.right,
            height: item.img.height - trim.top - trim.bottom
          };

    const rx = Math.round(activeRect.x * displayScale);
    const ry = Math.round(activeRect.y * displayScale);
    const rw = Math.round(activeRect.width * displayScale);
    const rh = Math.round(activeRect.height * displayScale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    ctx.drawImage(item.img, 0, 0, cw, ch);
    ctx.restore();

    // 5. Optional detected subject & instrument guide box
    if (optShowGuides.checked) {
      const ib = item.focus.importantBox;
      const ix = Math.round(ib.x * displayScale);
      const iy = Math.round(ib.y * displayScale);
      const iw = Math.round(ib.width * displayScale);
      const ih = Math.round(ib.height * displayScale);

      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(ix, iy, iw, ih);
      ctx.restore();
    }

    // 6. Rule-of-thirds grid + 3:4 crop frame border
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const gx = Math.round(rx + (rw * i) / 3) + 0.5;
      const gy = Math.round(ry + (rh * i) / 3) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, ry);
      ctx.lineTo(gx, ry + rh);
      ctx.moveTo(rx, gy);
      ctx.lineTo(rx + rw, gy);
      ctx.stroke();
    }

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);

    // Corner handles
    const handleLen = 12;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.5;
    const corners: Array<[number, number, number, number]> = [
      [rx + 2, ry + 2, 1, 1],
      [rx + rw - 2, ry + 2, -1, 1],
      [rx + 2, ry + rh - 2, 1, -1],
      [rx + rw - 2, ry + rh - 2, -1, -1]
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * handleLen);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * handleLen, cy);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Render the processed JPEG output and update specs
  const updateOutputRender = async () => {
    const item = getActiveItem();
    if (!item) return;

    drawInteractiveStage();

    const fitMode = optFitMode.value as 'crop' | 'contain-blur' | 'contain-solid';
    const quality = (parseInt(optQuality.value, 10) || 92) / 100;

    const res = await renderAuthorBioPhoto(item.img, item.trim, item.cropRect, {
      autoTrimBorder: optAutoTrim.checked,
      borderSensitivity: parseInt(optTrimSens.value, 10) || 50,
      fitMode,
      padColor: "#f4f3ef",
      jpegQuality: quality
    });

    item.lastResult = res;

    // Update diagnostics bar
    specOutput.textContent = `${res.outputWidth} × ${res.outputHeight} px`;
    specSource.textContent = `${res.originalWidth} × ${res.originalHeight} px`;

    if (res.hasBorderRemoved) {
      const { top, right, bottom, left } = res.trimmedBounds;
      specBorder.textContent = `T:${top} R:${right} B:${bottom} L:${left}px`;
    } else {
      specBorder.textContent = "None (0px)";
    }

    const kb = (res.fileSizeBytes / 1024).toFixed(1);
    specFilesize.textContent = `JPEG • ${kb} KB`;

    // Show small-image scale preservation notice if source crop was < 360×480
    if (res.wasKeptOriginalScale) {
      scaleNote.style.display = "block";
      scaleNote.textContent = `Small source photo: kept original scale (${res.outputWidth} × ${res.outputHeight} px) at exact 3:4 aspect ratio without upscaling.`;
    } else {
      scaleNote.style.display = "none";
    }

    wideWarning.style.display =
      item.focus.isWideSubject && fitMode === "crop" ? "block" : "none";

    outputImg.src = res.dataUrl;
    outputImg.width = res.outputWidth;
    outputImg.height = res.outputHeight;
    outputImg.style.display = "block";
    outputEmpty.style.display = "none";

    bioPreviewImg.src = res.dataUrl;

    btnDownloadJpg.disabled = false;
    btnCopyImg.disabled = false;
    statusBadge.textContent = `${res.outputWidth} × ${res.outputHeight} JPEG`;
    statusBadge.classList.add("success");
  };

  // Re-detect border & smart crop for an item
  const recomputeSmartFraming = async (item: PhotoQueueItem) => {
    const sens = parseInt(optTrimSens.value, 10) || 50;
    item.trim = optAutoTrim.checked
      ? detectImageBorders(item.img, sens)
      : { top: 0, right: 0, bottom: 0, left: 0 };

    item.focus = await analyzeSubjectAndInstruments(item.img, item.trim);
    item.zoomPercent = 100;
    optZoom.value = "100";
    zoomVal.textContent = "100%";
    item.cropRect = computeOptimalCropRect(
      item.img.width,
      item.img.height,
      item.trim,
      item.focus
    );
  };

  const renderBatchBar = () => {
    if (queue.length <= 1) {
      batchBar.style.display = "none";
      btnDownloadZip.style.display = "none";
      return;
    }

    batchBar.style.display = "flex";
    btnDownloadZip.style.display = "inline-flex";
    batchBar.innerHTML = "";

    queue.forEach((qItem, idx) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `photo-batch-chip${idx === activeIndex ? " active" : ""}`;
      chip.textContent = `${idx + 1}. ${qItem.file.name}`;
      chip.addEventListener("click", () => {
        activeIndex = idx;
        optZoom.value = String(qItem.zoomPercent);
        zoomVal.textContent = `${qItem.zoomPercent}%`;
        outputFilenameInput.value = toJpgFilename(qItem.file.name);
        renderBatchBar();
        updateOutputRender();
      });
      batchBar.appendChild(chip);
    });
  };

  const handleFilesLoaded = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      showToast("Please select a valid image file (JPG, PNG, WebP)", true);
      return;
    }

    statusBadge.textContent = "Analyzing...";
    const newItems: PhotoQueueItem[] = [];

    for (const file of imageFiles) {
      try {
        const img = await loadImageFromFile(file);
        const sens = parseInt(optTrimSens.value, 10) || 50;
        const trim = optAutoTrim.checked
          ? detectImageBorders(img, sens)
          : { top: 0, right: 0, bottom: 0, left: 0 };
        const focus = await analyzeSubjectAndInstruments(img, trim);
        const cropRect = computeOptimalCropRect(img.width, img.height, trim, focus);

        newItems.push({
          file,
          img,
          trim,
          focus,
          cropRect,
          zoomPercent: 100
        });
      } catch (err) {
        console.error(err);
      }
    }

    if (newItems.length === 0) {
      showToast("Could not decode the selected image(s)", true);
      return;
    }

    queue = newItems;
    activeIndex = 0;

    const first = queue[0];
    fileNameDisplay.textContent =
      queue.length === 1
        ? `${first.file.name} (${first.img.width}×${first.img.height})`
        : `${queue.length} author photos loaded`;

    outputFilenameInput.value = toJpgFilename(first.file.name);
    optZoom.value = "100";
    zoomVal.textContent = "100%";

    renderBatchBar();
    await updateOutputRender();
    showToast(
      first.trim.top || first.trim.left || first.trim.right || first.trim.bottom
        ? "Border removed & smart 3:4 framing applied!"
        : "Smart 3:4 framing applied!"
    );
  };

  // Upload & Drag-and-Drop listeners
  dropzone?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFilesLoaded(target.files);
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone?.addEventListener("drop", (e: DragEvent) => {
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFilesLoaded(e.dataTransfer.files);
    }
  });

  // Paste image from clipboard when Author Photo view is active
  window.addEventListener("paste", (e: ClipboardEvent) => {
    const authorView = document.getElementById("view-author-photo");
    if (!authorView?.classList.contains("active")) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const f = items[i].getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleFilesLoaded(pastedFiles);
    }
  });

  // Sample Demo Loaders
  btnSampleFramed?.addEventListener("click", async () => {
    const sampleFile = await createSampleAuthorPhotoFile();
    await handleFilesLoaded([sampleFile]);
  });

  btnSampleSmall?.addEventListener("click", async () => {
    const smallFile = await createSmallSampleAuthorPhotoFile();
    await handleFilesLoaded([smallFile]);
  });

  // Control Listeners
  optAutoTrim?.addEventListener("change", async () => {
    const item = getActiveItem();
    if (!item) return;
    await recomputeSmartFraming(item);
    await updateOutputRender();
  });

  optShowGuides?.addEventListener("change", () => {
    drawInteractiveStage();
  });

  optTrimSens?.addEventListener("input", async () => {
    trimSensVal.textContent = optTrimSens.value;
    const item = getActiveItem();
    if (!item || !optAutoTrim.checked) return;
    await recomputeSmartFraming(item);
    await updateOutputRender();
  });

  optZoom?.addEventListener("input", () => {
    const item = getActiveItem();
    const z = parseInt(optZoom.value, 10) || 100;
    zoomVal.textContent = `${z}%`;
    if (!item) return;
    applyZoomToCrop(item, z);
    updateOutputRender();
  });

  optFitMode?.addEventListener("change", () => {
    updateOutputRender();
  });

  optQuality?.addEventListener("input", () => {
    qualityVal.textContent = `${optQuality.value}%`;
    updateOutputRender();
  });

  // Quick Framing Buttons
  btnAutoFrame?.addEventListener("click", async () => {
    const item = getActiveItem();
    if (!item) return;
    await recomputeSmartFraming(item);
    await updateOutputRender();
    showToast("Smart face & instrument framing restored!");
  });

  btnCenter?.addEventListener("click", () => {
    const item = getActiveItem();
    if (!item) return;
    const availX = item.trim.left;
    const availY = item.trim.top;
    const availW = item.img.width - item.trim.left - item.trim.right;
    const availH = item.img.height - item.trim.top - item.trim.bottom;

    item.cropRect = clampCropToTrim(item, {
      x: availX + (availW - item.cropRect.width) / 2,
      y: availY + (availH - item.cropRect.height) / 2,
      width: item.cropRect.width,
      height: item.cropRect.height
    });
    updateOutputRender();
  });

  btnHeadroom?.addEventListener("click", () => {
    const item = getActiveItem();
    if (!item) return;
    // Shift crop window toward the top of the trimmed photo so the head has full headroom
    item.cropRect = clampCropToTrim(item, {
      ...item.cropRect,
      y: item.trim.top
    });
    updateOutputRender();
    showToast("Aligned to top to protect headroom!");
  });

  btnInstrument?.addEventListener("click", () => {
    const item = getActiveItem();
    if (!item) return;
    // Shift crop window lower to include instruments held in lower torso/hands
    const availBottom = item.img.height - item.trim.bottom;
    item.cropRect = clampCropToTrim(item, {
      ...item.cropRect,
      y: availBottom - item.cropRect.height
    });
    updateOutputRender();
    showToast("Shifted down to protect lower instrument area!");
  });

  // Interactive Pointer Dragging on Stage Canvas
  interactiveCanvas?.addEventListener("pointerdown", (e: PointerEvent) => {
    const item = getActiveItem();
    if (!item || optFitMode.value !== "crop") return;

    isDragging = true;
    interactiveCanvas.setPointerCapture(e.pointerId);
    const rect = interactiveCanvas.getBoundingClientRect();
    const scaleX = interactiveCanvas.width / rect.width;
    const scaleY = interactiveCanvas.height / rect.height;

    dragStartX = (e.clientX - rect.left) * scaleX;
    dragStartY = (e.clientY - rect.top) * scaleY;
    cropStartX = item.cropRect.x;
    cropStartY = item.cropRect.y;
  });

  interactiveCanvas?.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isDragging) return;
    const item = getActiveItem();
    if (!item) return;

    const rect = interactiveCanvas.getBoundingClientRect();
    const scaleX = interactiveCanvas.width / rect.width;
    const scaleY = interactiveCanvas.height / rect.height;

    const curX = (e.clientX - rect.left) * scaleX;
    const curY = (e.clientY - rect.top) * scaleY;

    const deltaImgX = (curX - dragStartX) / displayScale;
    const deltaImgY = (curY - dragStartY) / displayScale;

    item.cropRect = clampCropToTrim(item, {
      x: cropStartX + deltaImgX,
      y: cropStartY + deltaImgY,
      width: item.cropRect.width,
      height: item.cropRect.height
    });

    drawInteractiveStage();
  });

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    updateOutputRender();
  };

  interactiveCanvas?.addEventListener("pointerup", endDrag);
  interactiveCanvas?.addEventListener("pointercancel", endDrag);

  // Preview Tabs
  btnTabActual?.addEventListener("click", () => {
    btnTabActual.classList.add("active");
    btnTabBio.classList.remove("active");
    paneActual.style.display = "flex";
    paneBio.style.display = "none";
  });

  btnTabBio?.addEventListener("click", () => {
    btnTabBio.classList.add("active");
    btnTabActual.classList.remove("active");
    paneBio.style.display = "block";
    paneActual.style.display = "none";
  });

  // Download Single JPEG
  btnDownloadJpg?.addEventListener("click", () => {
    const item = getActiveItem();
    if (!item?.lastResult) return;

    let fileName = outputFilenameInput.value.trim() || "author-bio.jpg";
    if (!/\.jpe?g$/i.test(fileName)) {
      fileName += ".jpg";
    }

    const url = URL.createObjectURL(item.lastResult.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${fileName}!`);
  });

  // Copy Processed Image to Clipboard
  btnCopyImg?.addEventListener("click", async () => {
    const item = getActiveItem();
    if (!item?.lastResult) return;

    try {
      // Clipboard API requires image/png in many browsers, so convert rendered image or write png blob
      const imgEl = await loadImageFromFile(item.lastResult.blob);
      const c = document.createElement("canvas");
      c.width = imgEl.width;
      c.height = imgEl.height;
      c.getContext("2d")?.drawImage(imgEl, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("Clipboard blob error"))), "image/png")
      );
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      showToast("Processed photo copied to clipboard!");
    } catch {
      showToast("Could not copy image to clipboard in this browser", true);
    }
  });

  // Batch Download All as .zip
  btnDownloadZip?.addEventListener("click", async () => {
    if (queue.length === 0) return;

    try {
      const zip = new JSZip();
      const fitMode = optFitMode.value as 'crop' | 'contain-blur' | 'contain-solid';
      const quality = (parseInt(optQuality.value, 10) || 92) / 100;

      for (const qItem of queue) {
        const res =
          qItem.lastResult ||
          (await renderAuthorBioPhoto(qItem.img, qItem.trim, qItem.cropRect, {
            autoTrimBorder: optAutoTrim.checked,
            borderSensitivity: parseInt(optTrimSens.value, 10) || 50,
            fitMode,
            padColor: "#f4f3ef",
            jpegQuality: quality
          }));
        zip.file(toJpgFilename(qItem.file.name), res.blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "author-bio-photos.zip";
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${queue.length} JPEG photos as ZIP!`);
    } catch (err) {
      console.error(err);
      showToast("Failed to build ZIP archive", true);
    }
  });
}

// 7. Batch Alt Text Generator Controller
function initAltTextGeneratorController() {
  const dropzone = document.getElementById("alt-dropzone") as HTMLElement;
  const fileInput = document.getElementById("alt-file-input") as HTMLInputElement;
  const uploadSummary = document.getElementById("alt-upload-summary") as HTMLElement;
  const countBadge = document.getElementById("alt-count-badge") as HTMLElement;

  const btnLoadSample = document.getElementById("btn-alt-load-sample") as HTMLButtonElement;
  const optStyle = document.getElementById("alt-opt-style") as HTMLSelectElement;
  const optEngine = document.getElementById("alt-opt-engine") as HTMLSelectElement;
  const optOcr = document.getElementById("alt-opt-ocr") as HTMLInputElement;
  const geminiKeyRow = document.getElementById("alt-gemini-key-row") as HTMLElement;
  const geminiKeyInput = document.getElementById("alt-gemini-api-key") as HTMLInputElement;

  const btnGenerateAll = document.getElementById("btn-alt-generate-all") as HTMLButtonElement;
  const btnClearAll = document.getElementById("btn-alt-clear-all") as HTMLButtonElement;
  const itemsListEl = document.getElementById("alt-items-list") as HTMLElement;
  const emptyStateEl = document.getElementById("alt-empty-state") as HTMLElement;

  const btnTabList = document.getElementById("btn-alt-tab-list") as HTMLButtonElement;
  const btnTabHtml = document.getElementById("btn-alt-tab-html") as HTMLButtonElement;
  const btnTabCsv = document.getElementById("btn-alt-tab-csv") as HTMLButtonElement;
  const exportFilenameLabel = document.getElementById("alt-export-filename-label") as HTMLElement;
  const batchOutput = document.getElementById("alt-batch-output") as HTMLTextAreaElement;
  const btnCopyBatch = document.getElementById("btn-alt-copy-batch") as HTMLButtonElement;
  const btnDownloadBatch = document.getElementById("btn-alt-download-batch") as HTMLButtonElement;

  let items: Array<AltTextItem & { imgEl: HTMLImageElement }> = [];
  let activeExportTab: 'list' | 'html' | 'csv' = 'list';

  // Restore saved Gemini API key if present
  const savedKey = localStorage.getItem("symposium-gemini-key");
  if (savedKey && geminiKeyInput) {
    geminiKeyInput.value = savedKey;
  }

  geminiKeyInput?.addEventListener("change", () => {
    localStorage.setItem("symposium-gemini-key", geminiKeyInput.value.trim());
  });

  optEngine?.addEventListener("change", () => {
    geminiKeyRow.style.display = optEngine.value === "gemini-api" ? "flex" : "none";
    if (items.length > 0) {
      runBatchGeneration();
    }
  });

  optStyle?.addEventListener("change", () => {
    if (items.length > 0) {
      runBatchGeneration();
    }
  });

  optOcr?.addEventListener("change", () => {
    if (items.length > 0) {
      runBatchGeneration();
    }
  });

  const escapeAttr = (str: string): string =>
    str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const categoryLabel = (cat: string): string => {
    switch (cat) {
      case "musical-score":
        return "Musical Score / Notation";
      case "diagram-chart":
        return "Figure / Chart / Diagram";
      case "author-portrait":
        return "Author Bio Portrait";
      case "archival-document":
        return "Archival / Monochrome";
      default:
        return "Performance / Photo";
    }
  };

  // Synchronize the right-hand batch output textarea
  const syncBatchExportView = () => {
    countBadge.textContent = `${items.length} image${items.length === 1 ? "" : "s"}`;
    countBadge.classList.toggle("success", items.length > 0);

    const hasItems = items.length > 0;
    btnGenerateAll.disabled = !hasItems;
    btnClearAll.disabled = !hasItems;
    btnCopyBatch.disabled = !hasItems;
    btnDownloadBatch.disabled = !hasItems;

    if (!hasItems) {
      batchOutput.value = "";
      return;
    }

    if (activeExportTab === "list") {
      exportFilenameLabel.textContent = "alt_text_batch.txt";
      batchOutput.value = items
        .map((it, idx) => {
          const cat =
            it.categoryOverride === "auto"
              ? categoryLabel(it.analysis?.detectedCategory || "performance-photo")
              : categoryLabel(it.categoryOverride);
          return `${idx + 1}. ${it.file.name} [${cat}]\nAlt Text: ${it.altText}`;
        })
        .join("\n\n");
    } else if (activeExportTab === "html") {
      exportFilenameLabel.textContent = "joomla_figures_alt.html";
      batchOutput.value = items
        .map(
          (it) =>
            `<img src="images/${escapeAttr(it.file.name)}" alt="${escapeAttr(it.altText)}" width="${it.width}" height="${it.height}" loading="lazy" />`
        )
        .join("\n");
    } else {
      exportFilenameLabel.textContent = "alt_text_batch.csv";
      const header = `"File Name","Category","Dimensions","Character Count","Alt Text","HTML Tag"`;
      const rows = items.map((it) => {
        const cat =
          it.categoryOverride === "auto"
            ? categoryLabel(it.analysis?.detectedCategory || "performance-photo")
            : categoryLabel(it.categoryOverride);
        const htmlTag = `<img src="${it.file.name}" alt="${it.altText.replace(/"/g, '&quot;')}" />`;
        const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return [
          csvEscape(it.file.name),
          csvEscape(cat),
          csvEscape(`${it.width}x${it.height}`),
          String(it.altText.length),
          csvEscape(it.altText),
          csvEscape(htmlTag)
        ].join(",");
      });
      batchOutput.value = [header, ...rows].join("\n");
    }
  };

  // Render the list of image cards on the left column
  const renderItemsList = () => {
    itemsListEl.innerHTML = "";
    if (items.length === 0) {
      itemsListEl.appendChild(emptyStateEl);
      emptyStateEl.style.display = "flex";
      syncBatchExportView();
      return;
    }

    items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "alt-item-card";

      const detectedLabel = item.analysis
        ? `Auto (${categoryLabel(item.analysis.detectedCategory)})`
        : "Auto-Detect";

      const charLen = item.altText.length;
      const isGoodLen = charLen > 10 && charLen <= 140;

      card.innerHTML = `
        <div class="alt-thumb-box">
          <img class="alt-thumb-img" src="${item.previewUrl}" alt="${escapeAttr(item.file.name)}" />
          <span class="alt-thumb-meta">${item.width} × ${item.height}</span>
        </div>
        <div class="alt-item-body">
          <div class="alt-item-header">
            <span class="alt-item-title" title="${escapeAttr(item.file.name)}">${index + 1}. ${escapeAttr(item.file.name)}</span>
            <div class="alt-item-controls">
              <select class="alt-category-select" data-action="category">
                <option value="auto" ${item.categoryOverride === "auto" ? "selected" : ""}>${detectedLabel}</option>
                <option value="musical-score" ${item.categoryOverride === "musical-score" ? "selected" : ""}>Musical Score / Notation</option>
                <option value="diagram-chart" ${item.categoryOverride === "diagram-chart" ? "selected" : ""}>Figure / Chart / Diagram</option>
                <option value="author-portrait" ${item.categoryOverride === "author-portrait" ? "selected" : ""}>Author Bio Portrait</option>
                <option value="performance-photo" ${item.categoryOverride === "performance-photo" ? "selected" : ""}>Performance / Photo</option>
                <option value="archival-document" ${item.categoryOverride === "archival-document" ? "selected" : ""}>Archival / Monochrome</option>
              </select>
              <button type="button" class="btn" data-action="remove" title="Remove image" style="padding: 0.2rem 0.45rem; font-size: 0.72rem;">✕</button>
            </div>
          </div>
          <input
            type="text"
            class="alt-context-input"
            data-action="context"
            placeholder="Optional context / caption hint (e.g., 'Ex. 2: Beethoven Op. 109, mm. 1-4' or author name)..."
            value="${escapeAttr(item.contextHint)}"
          />
          <textarea
            class="alt-textarea"
            data-action="alttext"
            placeholder="Generating accessible alt text..."
          >${item.altText}</textarea>
          <div class="alt-item-footer">
            <span class="alt-char-badge ${isGoodLen ? "good" : "warn"}" data-role="charcount">
              ${charLen} chars ${charLen <= 125 ? "• Concise WCAG" : "• Descriptive"}
            </span>
            <div class="alt-card-actions">
              <button type="button" class="btn" data-action="regenerate">Regenerate</button>
              <button type="button" class="btn" data-action="copy-alt">Copy Alt</button>
              <button type="button" class="btn" data-action="copy-html">Copy &lt;img&gt;</button>
            </div>
          </div>
        </div>
      `;

      const catSelect = card.querySelector('[data-action="category"]') as HTMLSelectElement;
      const contextInput = card.querySelector('[data-action="context"]') as HTMLInputElement;
      const altTextarea = card.querySelector('[data-action="alttext"]') as HTMLTextAreaElement;
      const charBadge = card.querySelector('[data-role="charcount"]') as HTMLElement;
      const btnRegen = card.querySelector('[data-action="regenerate"]') as HTMLButtonElement;
      const btnCopyAlt = card.querySelector('[data-action="copy-alt"]') as HTMLButtonElement;
      const btnCopyHtml = card.querySelector('[data-action="copy-html"]') as HTMLButtonElement;
      const btnRemove = card.querySelector('[data-action="remove"]') as HTMLButtonElement;

      catSelect?.addEventListener("change", async () => {
        item.categoryOverride = catSelect.value as ImageCategory;
        await generateSingleItem(item);
        renderItemsList();
      });

      contextInput?.addEventListener("input", () => {
        item.contextHint = contextInput.value;
      });

      contextInput?.addEventListener("change", async () => {
        item.contextHint = contextInput.value;
        await generateSingleItem(item);
        renderItemsList();
      });

      altTextarea?.addEventListener("input", () => {
        item.altText = altTextarea.value;
        const len = item.altText.length;
        charBadge.textContent = `${len} chars ${len <= 125 ? "• Concise WCAG" : "• Descriptive"}`;
        charBadge.className = `alt-char-badge ${len > 10 && len <= 140 ? "good" : "warn"}`;
        syncBatchExportView();
      });

      btnRegen?.addEventListener("click", async () => {
        btnRegen.textContent = "...";
        await generateSingleItem(item);
        renderItemsList();
        showToast(`Updated alt text for ${item.file.name}`);
      });

      btnCopyAlt?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(item.altText);
        showToast("Alt text copied to clipboard!");
      });

      btnCopyHtml?.addEventListener("click", async () => {
        const tag = `<img src="images/${escapeAttr(item.file.name)}" alt="${escapeAttr(item.altText)}" width="${item.width}" height="${item.height}" loading="lazy" />`;
        await navigator.clipboard.writeText(tag);
        showToast("HTML <img> tag copied!");
      });

      btnRemove?.addEventListener("click", () => {
        URL.revokeObjectURL(item.previewUrl);
        items = items.filter((x) => x.id !== item.id);
        renderItemsList();
      });

      itemsListEl.appendChild(card);
    });

    syncBatchExportView();
  };

  const generateSingleItem = async (item: AltTextItem & { imgEl: HTMLImageElement }) => {
    try {
      item.status = "analyzing";
      const res = await generateAltTextForItem(item, item.imgEl, {
        style: (optStyle.value as AltTextStyle) || "concise",
        engine: (optEngine.value as AltEngineMode) || "smart-local",
        includeOcr: optOcr.checked,
        geminiApiKey: geminiKeyInput?.value?.trim()
      });
      item.altText = res.altText;
      item.analysis = res.analysis;
      item.status = "done";
    } catch (err: any) {
      console.error(err);
      item.status = "error";
      item.errorMessage = err?.message || "Generation failed";
      showToast(item.errorMessage!, true);
    }
  };

  const runBatchGeneration = async () => {
    if (items.length === 0) return;
    btnGenerateAll.disabled = true;
    btnGenerateAll.textContent = "Generating Alt Text...";

    for (const item of items) {
      await generateSingleItem(item);
    }

    btnGenerateAll.disabled = false;
    btnGenerateAll.textContent = "Regenerate All Alt Text";
    renderItemsList();
  };

  // Extract embedded media images if a user uploads a .docx file
  const extractImagesFromDocx = async (docxFile: File): Promise<File[]> => {
    const zip = await JSZip.loadAsync(docxFile);
    const extracted: File[] = [];
    const mediaPaths: string[] = [];

    zip.forEach((relPath) => {
      if (/^word\/media\/.+\.(jpe?g|png|gif|webp|bmp)$/i.test(relPath)) {
        mediaPaths.push(relPath);
      }
    });

    for (const p of mediaPaths) {
      const entry = zip.file(p);
      if (!entry) continue;
      const blob = await entry.async("blob");
      const baseName = p.split("/").pop() || "figure.png";
      const ext = baseName.split(".").pop()?.toLowerCase() || "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      extracted.push(
        new File([blob], `${docxFile.name.replace(/\.docx$/i, "")}_${baseName}`, { type: mime })
      );
    }
    return extracted;
  };

  const addFilesToBatch = async (
    rawFiles: FileList | File[],
    hintsMap?: Map<string, string>
  ) => {
    const incomingFiles: File[] = [];

    for (const f of Array.from(rawFiles)) {
      if (f.name.toLowerCase().endsWith(".docx")) {
        try {
          const docxImgs = await extractImagesFromDocx(f);
          incomingFiles.push(...docxImgs);
        } catch (err) {
          console.error(err);
        }
      } else if (
        f.type.startsWith("image/") ||
        /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(f.name)
      ) {
        incomingFiles.push(f);
      }
    }

    if (incomingFiles.length === 0) {
      showToast("No supported images found in upload", true);
      return;
    }

    for (const file of incomingFiles) {
      try {
        const imgEl = await loadImageFromFile(file);
        const previewUrl = URL.createObjectURL(file);
        const newItem: AltTextItem & { imgEl: HTMLImageElement } = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          imgEl,
          previewUrl,
          width: imgEl.naturalWidth || imgEl.width,
          height: imgEl.naturalHeight || imgEl.height,
          categoryOverride: "auto",
          contextHint: hintsMap?.get(file.name) || "",
          altText: "",
          status: "pending"
        };
        await generateSingleItem(newItem);
        items.push(newItem);
      } catch (err) {
        console.error(err);
      }
    }

    uploadSummary.textContent = `${items.length} image${items.length === 1 ? "" : "s"} in current batch (drop more to append)`;
    renderItemsList();
    showToast(`Generated alt text for ${incomingFiles.length} image${incomingFiles.length === 1 ? "" : "s"}!`);
  };

  // Upload & Drag-and-Drop listeners
  dropzone?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      addFilesToBatch(target.files);
      target.value = "";
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone?.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone?.addEventListener("drop", (e: DragEvent) => {
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFilesToBatch(e.dataTransfer.files);
    }
  });

  // Paste images when Alt Text Generator view is active
  window.addEventListener("paste", (e: ClipboardEvent) => {
    const altView = document.getElementById("view-alt-text-generator");
    if (!altView?.classList.contains("active")) return;
    // Do not intercept paste inside text inputs/textareas
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (activeTag === "input" || activeTag === "textarea") return;

    const clipItems = e.clipboardData?.items;
    if (!clipItems) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < clipItems.length; i++) {
      if (clipItems[i].type.startsWith("image/")) {
        const f = clipItems[i].getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFilesToBatch(pastedFiles);
    }
  });

  // Sample Batch Loader
  btnLoadSample?.addEventListener("click", async () => {
    const sampleBatch = await createSampleAltTextBatchFiles();
    const hints = new Map<string, string>();
    const files: File[] = [];
    for (const entry of sampleBatch) {
      files.push(entry.file);
      hints.set(entry.file.name, entry.hint);
    }
    await addFilesToBatch(files, hints);
  });

  btnGenerateAll?.addEventListener("click", async () => {
    await runBatchGeneration();
    showToast("Regenerated all batch alt text!");
  });

  btnClearAll?.addEventListener("click", () => {
    items.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    items = [];
    uploadSummary.textContent =
      "Drag & drop multiple JPG, PNG, WebP files, a Word .docx file, or paste (Ctrl+V)";
    renderItemsList();
    showToast("Cleared image batch");
  });

  // Export Format Tabs
  const setExportTab = (tab: 'list' | 'html' | 'csv') => {
    activeExportTab = tab;
    btnTabList.classList.toggle("active", tab === "list");
    btnTabHtml.classList.toggle("active", tab === "html");
    btnTabCsv.classList.toggle("active", tab === "csv");
    syncBatchExportView();
  };

  btnTabList?.addEventListener("click", () => setExportTab("list"));
  btnTabHtml?.addEventListener("click", () => setExportTab("html"));
  btnTabCsv?.addEventListener("click", () => setExportTab("csv"));

  btnCopyBatch?.addEventListener("click", async () => {
    if (!batchOutput.value) return;
    await navigator.clipboard.writeText(batchOutput.value);
    showToast("Batch alt text output copied to clipboard!");
  });

  btnDownloadBatch?.addEventListener("click", () => {
    if (!batchOutput.value) return;
    const ext = activeExportTab === "html" ? "html" : activeExportTab === "csv" ? "csv" : "txt";
    const mime =
      activeExportTab === "html"
        ? "text/html;charset=utf-8"
        : activeExportTab === "csv"
        ? "text/csv;charset=utf-8"
        : "text/plain;charset=utf-8";

    const blob = new Blob([batchOutput.value], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `symposium_alt_text_batch.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded symposium_alt_text_batch.${ext}!`);
  });
}

// App Launch
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initToolNavigation();
  initTableFormatter();
  initArticleFormatterController();
  initReferenceFormatterController();
  initEditorialBoardController();
  initItalicHighlighterController();
  initAuthorPhotoController();
  initAltTextGeneratorController();
});
