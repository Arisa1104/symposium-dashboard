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

// App Launch
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initToolNavigation();
  initTableFormatter();
  initArticleFormatterController();
  initReferenceFormatterController();
  initEditorialBoardController();
  initItalicHighlighterController();
});
