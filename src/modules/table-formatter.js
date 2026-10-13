/**
 * Symposium Table Formatter — College Music Symposium
 * Core Application Script (Vanilla ES Module)
 */

// --- GLOBAL STATE ---
// The table is stored as a single rectangular grid of cell objects.
//   cell = { content: string, rowspan: number, colspan: number, covered: boolean }
// "covered: true" marks a slot absorbed by a merged cell to its top/left.
// Whether row 0 / column 0 render as <th> is governed by headerRow / headerCol —
// so a table can have a header row, a header column, both, or neither.
let tableState = {
  grid: [],          // 2D array of cell objects (rows × colCount)
  colCount: 0,
  headerRow: true,   // render first row as header cells
  headerCol: false,  // render first column as header cells
  selection: null,   // { r1, c1, r2, c2 } anchor→focus rectangle (un-normalized)
  originalHTML: ""   // Stored for diagnostic comparisons
};

// Transient pointer state for drag-to-select in the grid.
const dragSelect = { pointerDown: false, moved: false, anchor: null };

// --- DOM ELEMENTS ---
const elements = {
  // Inputs & Zones
  docxDropzone: document.getElementById("docx-dropzone"),
  docxFileInput: document.getElementById("docx-file-input"),
  pasteDropzone: document.getElementById("paste-dropzone"),
  inputRawHtml: document.getElementById("input-raw-html"),
  btnLoadSample: document.getElementById("btn-load-sample"),
  
  // Options
  optFirstRowHeader: document.getElementById("opt-first-row-header"),
  optFirstColHeader: document.getElementById("opt-first-col-header"),
  optKeepStyles: document.getElementById("opt-keep-styles"),
  optKeepLinks: document.getElementById("opt-keep-links"),
  optStripAttributes: document.getElementById("opt-strip-attributes"),
  optRemoveEmpty: document.getElementById("opt-remove-empty"),
  optSmartParagraphs: document.getElementById("opt-smart-paragraphs"),
  
  // Editor Grid
  gridWrapper: document.getElementById("grid-wrapper"),
  gridAddRow: document.getElementById("grid-add-row"),
  gridAddCol: document.getElementById("grid-add-column"),
  gridMerge: document.getElementById("grid-merge"),
  gridSplit: document.getElementById("grid-split"),
  gridClear: document.getElementById("grid-clear"),
  editorLoading: document.getElementById("editor-loading"),
  
  // Outputs & Previews
  tabBtns: document.querySelectorAll(".tab-btn"),
  tabPanes: document.querySelectorAll(".tab-pane"),
  symposiumPreview: document.getElementById("symposium-preview-content"),
  cleanedHtmlOutput: document.getElementById("cleaned-html-output"),
  originalHtmlDiagnostic: document.getElementById("original-html-diagnostic"),
  
  // Action Buttons
  btnCopyStyled: document.getElementById("btn-copy-styled"),
  btnCopyCss: document.getElementById("btn-copy-css"),
  btnCopyHtml: document.getElementById("btn-copy-html"),
  btnDownloadHtml: document.getElementById("btn-download-html"),
  btnThemeToggle: document.getElementById("btn-theme-toggle"),
  
  // Toast
  toast: document.getElementById("app-toast"),
  toastMessage: document.getElementById("toast-message")
};

// --- INITIALIZATION ---
export function initTableFormatter() {
  initTableEventListeners();
  // theme handled globally
}

// --- EVENT LISTENERS ---
function initTableEventListeners() {
  // File Upload Handlers
  elements.docxDropzone.addEventListener("click", () => elements.docxFileInput.click());
  elements.docxFileInput.addEventListener("change", handleFileSelect);
  
  // Drag & Drop
  ["dragenter", "dragover"].forEach(eventName => {
    elements.docxDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      elements.docxDropzone.classList.add("dragover");
    }, false);
  });
  
  ["dragleave", "drop"].forEach(eventName => {
    elements.docxDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      elements.docxDropzone.classList.remove("dragover");
    }, false);
  });
  
  elements.docxDropzone.addEventListener("drop", handleDocxDrop);
  
  // Paste Dropzone Handlers
  elements.pasteDropzone.addEventListener("click", () => {
    // Focus invisible or raw textarea to capture normal paste easily
    elements.inputRawHtml.focus();
    showToast("Paste table directly (Ctrl+V or Cmd+V) now!");
  });
  
  // Global Clipboard Capture (when user pastes inside app)
  document.addEventListener("paste", handleClipboardPaste);
  
  // Raw Input Textarea Change Handlers
  elements.inputRawHtml.addEventListener("input", handleRawTextInput);
  
  // Pre-load local table2.docx
  elements.btnLoadSample.addEventListener("click", loadWorkspaceSampleDocx);
  
  // Header toggles only change how existing cells are rendered/exported —
  // they must NOT re-parse (that would discard manual edits and merges).
  elements.optFirstRowHeader.addEventListener("change", () => {
    tableState.headerRow = elements.optFirstRowHeader.checked;
    renderInteractiveEditor();
    updatePreviewsAndCode();
  });
  elements.optFirstColHeader.addEventListener("change", () => {
    tableState.headerCol = elements.optFirstColHeader.checked;
    renderInteractiveEditor();
    updatePreviewsAndCode();
  });

  // Cleaning settings re-run the cleaner on the original input.
  [
    elements.optKeepStyles,
    elements.optKeepLinks,
    elements.optStripAttributes,
    elements.optRemoveEmpty,
    elements.optSmartParagraphs
  ].forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      if (tableState.originalHTML) {
        processRawInputHTML(tableState.originalHTML, false);
      }
    });
  });

  // Interactive Editor Grid Buttons
  elements.gridAddRow.addEventListener("click", appendEditorRow);
  elements.gridAddCol.addEventListener("click", appendEditorColumn);
  elements.gridMerge.addEventListener("click", mergeSelection);
  elements.gridSplit.addEventListener("click", splitSelection);
  elements.gridClear.addEventListener("click", clearTableGrid);

  // Drag-to-select support (finalised at the document level).
  document.addEventListener("mouseup", () => { dragSelect.pointerDown = false; });
  document.addEventListener("selectstart", (e) => {
    if (dragSelect.pointerDown && dragSelect.moved) e.preventDefault();
  });
  
  // Tabs Navigation
  elements.tabBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId);
    });
  });
  
  // Export Actions
  elements.btnCopyCss.addEventListener("click", copyJoomlaCSS);
  elements.btnCopyHtml.addEventListener("click", copyCleanedHTML);
  elements.btnCopyStyled.addEventListener("click", copyStyledRichText);
  elements.btnDownloadHtml.addEventListener("click", downloadHTMLFile);
  
  // Theme Toggle
  elements.btnThemeToggle.addEventListener("click", toggleTheme);
}

// --- THEME ENGINE ---
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
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark-theme");
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  localStorage.setItem("symposium-theme", isDark ? "dark" : "light");
}

// --- TAB SWITCHER ---
function switchTab(tabId) {
  elements.tabBtns.forEach(btn => {
    const active = btn.getAttribute("data-tab") === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  
  elements.tabPanes.forEach(pane => {
    pane.classList.toggle("active", pane.id === tabId);
  });
}

// --- FILE PARSERS (MAMMOTH.JS) ---
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    parseDocxFile(file);
  }
}

function handleDocxDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith(".docx")) {
    parseDocxFile(file);
  } else {
    showToast("Invalid file format! Please upload a .docx Word document.", true);
  }
}

function parseDocxFile(file) {
  showLoading(true);
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const arrayBuffer = e.target.result;
    
    // Call Mammoth parser client-side
    window.mammoth.convertToHtml({ arrayBuffer: arrayBuffer })
      .then(result => {
        const html = result.value;
        if (!html || !html.includes("<table")) {
          showToast("Word document has no recognizable tables!", true);
          showLoading(false);
          return;
        }
        
        // Update inputs & parse
        elements.inputRawHtml.value = html;
        processRawInputHTML(html);
        showToast("Word Document parsed successfully!");
      })
      .catch(err => {
        console.error("Mammoth Parse Error:", err);
        showToast("Failed to parse .docx file. Ensure it is not corrupted.", true);
      })
      .finally(() => {
        showLoading(false);
      });
  };
  
  reader.readAsArrayBuffer(file);
}

// Fetch and load sample table2.docx directly from local workspace
function loadWorkspaceSampleDocx() {
  showLoading(true);
  fetch("./table2.docx")
    .then(res => {
      if (!res.ok) throw new Error("Could not find table2.docx in workspace directory");
      return res.arrayBuffer();
    })
    .then(buffer => {
      window.mammoth.convertToHtml({ arrayBuffer: buffer })
        .then(result => {
          const html = result.value;
          elements.inputRawHtml.value = html;
          processRawInputHTML(html);
          showToast("Loaded sample table2.docx successfully!");
        })
        .catch(err => {
          console.error(err);
          showToast("Mammoth conversion of table2.docx failed.", true);
        })
        .finally(() => {
          showLoading(false);
        });
    })
    .catch(err => {
      console.error(err);
      showToast("Workspace sample table2.docx not found. Please upload it manually.", true);
      showLoading(false);
    });
}

// --- CLIPBOARD & RAW TEXT INPUTS ---
function handleClipboardPaste(e) {
  // Capture HTML clipboard data
  const htmlData = e.clipboardData.getData("text/html");
  const textData = e.clipboardData.getData("text/plain");
  
  // If it's standard rich text or has HTML (Word pastes always do!)
  if (htmlData && htmlData.includes("<table")) {
    e.preventDefault();
    elements.inputRawHtml.value = htmlData;
    processRawInputHTML(htmlData);
    showToast("Captured table from Clipboard!");
    return;
  }
  
  // Fallback: If focused on paste dropzone or clicked, parse plain TSV (Excel/Word copy)
  if (document.activeElement === elements.inputRawHtml || document.activeElement === document.body) {
    if (textData && textData.includes("\t")) {
      e.preventDefault();
      const generatedHTML = convertTSVToHTML(textData);
      elements.inputRawHtml.value = generatedHTML;
      processRawInputHTML(generatedHTML);
      showToast("Captured Tab-Separated spreadsheet layout!");
    }
  }
}

function handleRawTextInput() {
  const value = elements.inputRawHtml.value.trim();
  if (value.startsWith("<table") || value.includes("<table")) {
    processRawInputHTML(value);
  } else if (value.includes("\t")) {
    const generatedHTML = convertTSVToHTML(value);
    processRawInputHTML(generatedHTML);
  }
}

// Quick helper to convert Excel/TSV clipboard strings to standard raw HTML tables
function convertTSVToHTML(tsvText) {
  const lines = tsvText.trim().split(/\r?\n/);
  let html = '<table>\n<tbody>\n';
  
  lines.forEach(line => {
    html += '  <tr>\n';
    const cells = line.split('\t');
    cells.forEach(cell => {
      html += `    <td><p>${escapeHTML(cell.trim())}</p></td>\n`;
    });
    html += '  </tr>\n';
  });
  
  html += '</tbody>\n</table>';
  return html;
}

// --- CORE SEMANTIC CLEANER & NORMALIZER ---
function processRawInputHTML(rawHTML, resetOriginal = true) {
  if (resetOriginal) {
    tableState.originalHTML = rawHTML;
    elements.originalHtmlDiagnostic.value = rawHTML;
  }
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, "text/html");
  const parsedTable = doc.querySelector("table");
  
  if (!parsedTable) {
    renderEmptyState();
    return;
  }
  
  // Extract Clean State Data
  const cleanData = cleanDOMTable(parsedTable);

  // Update State
  tableState.grid = cleanData.grid;
  tableState.colCount = cleanData.colCount;
  tableState.headerRow = elements.optFirstRowHeader.checked;
  tableState.headerCol = elements.optFirstColHeader.checked;
  tableState.selection = null;

  // Render views
  renderInteractiveEditor();
  updatePreviewsAndCode();
}

// Cell data format used in tableState.grid:
//   { content: string, rowspan: number, colspan: number, covered: boolean }
// "covered: true" means this slot is spanned by a cell from a previous row/column.
function makeCell(content, rowspan = 1, colspan = 1) {
  return { content, rowspan, colspan, covered: false };
}

function cleanDOMTable(tableEl) {
  const trElements = Array.from(tableEl.querySelectorAll("tr"));

  const keepStyles = elements.optKeepStyles.checked;
  const keepLinks = elements.optKeepLinks.checked;
  const smartParagraphs = elements.optSmartParagraphs.checked;
  const removeEmptyRows = elements.optRemoveEmpty.checked;

  // Build a virtual grid that respects rowspan/colspan.
  // grid[r][c] is a cell object, or { covered: true } for spanned slots.
  const grid = [];

  trElements.forEach((tr, rowIdx) => {
    while (grid.length <= rowIdx) grid.push([]);

    const domCells = Array.from(tr.querySelectorAll("td, th"));
    let domIdx = 0;
    let colIdx = 0;

    while (domIdx < domCells.length) {
      // Advance past columns already occupied by a rowspan from a previous row.
      while (grid[rowIdx][colIdx] !== undefined) colIdx++;

      const cell = domCells[domIdx];
      const rowspan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10));
      const colspan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10));
      const content = sanitizeTableCell(cell, keepStyles, keepLinks, smartParagraphs);

      grid[rowIdx][colIdx] = makeCell(content, rowspan, colspan);

      // Mark all spanned slots as covered.
      for (let r = 0; r < rowspan; r++) {
        while (grid.length <= rowIdx + r) grid.push([]);
        for (let c = 0; c < colspan; c++) {
          if (r === 0 && c === 0) continue;
          grid[rowIdx + r][colIdx + c] = { content: "", rowspan: 1, colspan: 1, covered: true };
        }
      }

      colIdx += colspan;
      domIdx++;
    }
  });

  // Optionally drop rows where every non-covered cell is empty.
  let processedGrid = removeEmptyRows
    ? grid.filter(row => row.some(cell => cell && !cell.covered && cell.content.trim() !== ""))
    : grid;

  let maxCols = 0;
  processedGrid.forEach(row => { maxCols = Math.max(maxCols, row.length); });

  // Ensure every row is a full rectangle with no undefined holes.
  processedGrid.forEach(row => {
    for (let c = 0; c < maxCols; c++) {
      if (!row[c]) row[c] = makeCell("");
    }
  });

  return { grid: processedGrid, colCount: maxCols };
}

// Sanitizes individual <td>/<th> nodes to retain clean contents
function sanitizeTableCell(cellNode, keepStyles, keepLinks, smartParagraphs) {
  // If cell is empty, return simple string
  if (!cellNode.hasChildNodes()) {
    return cellNode.textContent.trim();
  }
  
  // Capture nested paragraph constructs
  if (smartParagraphs) {
    const paragraphs = cellNode.querySelectorAll("p");
    if (paragraphs.length === 1) {
      // Single redundancy paragraph: swap node
      return cleanNodeContent(paragraphs[0], keepStyles, keepLinks).trim();
    } else if (paragraphs.length > 1) {
      // Multiple paragraphs: join with break tags
      return Array.from(paragraphs)
        .map(p => cleanNodeContent(p, keepStyles, keepLinks).trim())
        .filter(text => text !== "")
        .join("<br>");
    }
  }
  
  return cleanNodeContent(cellNode, keepStyles, keepLinks).trim();
}

function cleanNodeContent(node, keepStyles, keepLinks) {
  let output = "";
  
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      // Replace non-breaking spaces & clean whitespace
      output += child.textContent.replace(/\u00A0/g, " ");
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tagName = child.tagName.toLowerCase();
      
      // Preserve links — but only real destinations. Pasted HTML often carries
      // junk anchors (empty, "#", in-page "#fragment", or "javascript:") that
      // would otherwise resolve to the app's own URL; emit just their text.
      if (tagName === "a" && keepLinks) {
        const href = (child.getAttribute("href") || "").trim();
        const innerText = cleanNodeContent(child, keepStyles, keepLinks);
        const isRealLink = href && !href.startsWith("#") && !/^javascript:/i.test(href);
        output += isRealLink ? `<a href="${href}">${innerText}</a>` : innerText;
      }
      // Preserve styles
      else if ((tagName === "em" || tagName === "i") && keepStyles) {
        output += `<em>${cleanNodeContent(child, keepStyles, keepLinks)}</em>`;
      } 
      else if ((tagName === "strong" || tagName === "b") && keepStyles) {
        output += `<strong>${cleanNodeContent(child, keepStyles, keepLinks)}</strong>`;
      }
      else if ((tagName === "sup") && keepStyles) {
        output += `<sup>${cleanNodeContent(child, keepStyles, keepLinks)}</sup>`;
      }
      else if ((tagName === "sub") && keepStyles) {
        output += `<sub>${cleanNodeContent(child, keepStyles, keepLinks)}</sub>`;
      }
      else if (tagName === "br") {
        output += "<br>";
      }
      // Recursive unpack for span/div/paragraphs
      else {
        output += cleanNodeContent(child, keepStyles, keepLinks);
      }
    }
  });
  
  return output;
}

// --- INTERACTIVE SPREADSHEET EDITOR ---
function renderInteractiveEditor() {
  const wrapper = elements.gridWrapper;
  wrapper.innerHTML = "";

  const grid = tableState.grid;
  if (!grid.length) {
    renderEmptyState();
    return;
  }

  const colCount = tableState.colCount;
  const table = document.createElement("table");
  table.className = "spreadsheet-table";

  // Top gutter row: corner + one clickable header per column (with delete control).
  const gutterTr = document.createElement("tr");
  gutterTr.appendChild(makeGutterCell("th", "grid-corner", "", null));
  for (let c = 0; c < colCount; c++) {
    const th = makeGutterCell("th", "col-gutter", colLabel(c), () => removeColumn(c), "Delete column");
    th.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("gutter-del")) return;
      selectColumn(c);
    });
    gutterTr.appendChild(th);
  }
  table.appendChild(gutterTr);

  // Body rows.
  for (let r = 0; r < grid.length; r++) {
    const tr = document.createElement("tr");

    const rowGutter = makeGutterCell("td", "row-gutter", r + 1, () => removeRow(r), "Delete row");
    rowGutter.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("gutter-del")) return;
      selectRow(r);
    });
    tr.appendChild(rowGutter);

    for (let c = 0; c < colCount; c++) {
      const cell = grid[r][c];
      if (cell.covered) continue; // absorbed by a merged cell — emit nothing

      const td = document.createElement("td");
      td.className = "grid-cell";
      td.dataset.r = r;
      td.dataset.c = c;
      if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
      if (cell.colspan > 1) td.colSpan = cell.colspan;
      if ((tableState.headerRow && r === 0) || (tableState.headerCol && c === 0)) {
        td.classList.add("is-header");
      }
      td.contentEditable = "true";
      td.innerHTML = cell.content;
      td.addEventListener("blur", () => handleCellEdit(td));
      td.addEventListener("keydown", handleCellKeydown);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  table.addEventListener("mousedown", onGridMouseDown);
  table.addEventListener("mousemove", onGridMouseMove);
  wrapper.appendChild(table);
  applySelectionHighlight();
}

// Builds a gutter cell (row number / column label) with an optional delete button.
function makeGutterCell(tag, className, label, onDelete, delTitle) {
  const el = document.createElement(tag);
  el.className = className;
  if (label !== "" && label !== null) {
    const span = document.createElement("span");
    span.textContent = label;
    el.appendChild(span);
  }
  if (onDelete) {
    const del = document.createElement("button");
    del.className = "gutter-del";
    del.innerHTML = "×";
    del.title = delTitle || "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete();
    });
    el.appendChild(del);
  }
  return el;
}

// Spreadsheet-style column labels: A, B, … Z, AA, AB, …
function colLabel(index) {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function renderEmptyState() {
  elements.gridWrapper.innerHTML = `
    <div class="editor-empty">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 256 256">
        <path d="M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM32,64H80v48H32ZM32,128H80v48H32Zm192,64H96V128H224Zm0-80H96V64H224v48Z"></path>
      </svg>
      <p>Table editor is currently empty.</p>
      <p style="font-size: 0.75rem;">Paste a Word table above, load table2.docx, or click Row/Col to start building a table manually. Drag across cells to select, then Merge or Split.</p>
    </div>
  `;
  elements.symposiumPreview.innerHTML = `
    <div style="color: var(--text-tertiary); font-style: italic; text-align: center; margin-top: 5rem;">
      Pristine layout preview will render here automatically.
    </div>
  `;
  elements.cleanedHtmlOutput.value = "";
}

// Capture direct cell keyboard input (e.g. enter key behavior)
function handleCellKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.target.blur(); // Triggers edit saves via blur handler
  }
}

function handleCellEdit(cellEl) {
  // Read modified cell contents
  let html = cellEl.innerHTML.trim();

  // Clean up any browser-injected spans or styling from contenteditable
  html = html.replace(/ style="[^"]*"/g, "")
             .replace(/ class="[^"]*"/g, "")
             .replace(/<span[^>]*>/g, "")
             .replace(/<\/span>/g, "");

  const r = parseInt(cellEl.dataset.r, 10);
  const c = parseInt(cellEl.dataset.c, 10);
  const cell = tableState.grid[r] && tableState.grid[r][c];
  if (cell && !cell.covered) {
    cell.content = html;
  }

  // Keep live preview and code blocks synchronized instantly
  updatePreviewsAndCode();
}

// --- CELL SELECTION (drag, row, column) ---
function setSelection(r1, c1, r2, c2) {
  tableState.selection = { r1, c1, r2, c2 };
}

function normalizedSelection() {
  const s = tableState.selection;
  if (!s) return null;
  return {
    r1: Math.min(s.r1, s.r2),
    c1: Math.min(s.c1, s.c2),
    r2: Math.max(s.r1, s.r2),
    c2: Math.max(s.c1, s.c2)
  };
}

function selectColumn(c) {
  setSelection(0, c, tableState.grid.length - 1, c);
  applySelectionHighlight();
}

function selectRow(r) {
  setSelection(r, 0, r, tableState.colCount - 1);
  applySelectionHighlight();
}

function onGridMouseDown(e) {
  const td = e.target.closest("td.grid-cell");
  if (!td || e.button !== 0) return;
  dragSelect.pointerDown = true;
  dragSelect.moved = false;
  const r = parseInt(td.dataset.r, 10);
  const c = parseInt(td.dataset.c, 10);
  dragSelect.anchor = { r, c };
  setSelection(r, c, r, c);
  applySelectionHighlight();
}

// Uses mousemove + elementFromPoint rather than mouseover: while dragging over
// contentEditable cells the browser runs a native text selection that suppresses
// mouseover, but mousemove still fires.
function onGridMouseMove(e) {
  if (!dragSelect.pointerDown) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const td = el && el.closest ? el.closest("td.grid-cell") : null;
  if (!td) return;
  const r = parseInt(td.dataset.r, 10);
  const c = parseInt(td.dataset.c, 10);
  if (r === dragSelect.anchor.r && c === dragSelect.anchor.c && !dragSelect.moved) return;
  dragSelect.moved = true;
  setSelection(dragSelect.anchor.r, dragSelect.anchor.c, r, c);
  window.getSelection().removeAllRanges(); // suppress text selection while dragging
  applySelectionHighlight();
}

// Paints the .cell-selected class. A lone, un-merged cell shows no highlight
// (it's just being edited); multi-cell selections and merged cells do.
function applySelectionHighlight() {
  const cells = elements.gridWrapper.querySelectorAll("td.grid-cell");
  cells.forEach(td => td.classList.remove("cell-selected"));

  const sel = normalizedSelection();
  if (!sel) return;
  const area = (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1);

  cells.forEach(td => {
    const r = parseInt(td.dataset.r, 10);
    const c = parseInt(td.dataset.c, 10);
    const cell = tableState.grid[r][c];
    const fr2 = r + cell.rowspan - 1;
    const fc2 = c + cell.colspan - 1;
    const intersects = !(fr2 < sel.r1 || r > sel.r2 || fc2 < sel.c1 || c > sel.c2);
    const isMerged = cell.rowspan > 1 || cell.colspan > 1;
    if (intersects && (area > 1 || isMerged)) {
      td.classList.add("cell-selected");
    }
  });
}

// --- MERGE / SPLIT ---
// Maps every grid slot to the {or, oc} origin cell that owns it.
function buildOwnerMap(grid) {
  const map = grid.map(row => row.map(() => null));
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell.covered) continue;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          if (map[r + dr] && map[r + dr][c + dc] !== undefined) {
            map[r + dr][c + dc] = { or: r, oc: c };
          }
        }
      }
    }
  }
  return map;
}

// Resets a merged cell back to a 1×1 cell, freeing its covered slots.
function splitCellAt(or, oc) {
  const grid = tableState.grid;
  const cell = grid[or][oc];
  for (let dr = 0; dr < cell.rowspan; dr++) {
    for (let dc = 0; dc < cell.colspan; dc++) {
      if (dr === 0 && dc === 0) continue;
      grid[or + dr][oc + dc] = makeCell("");
    }
  }
  cell.rowspan = 1;
  cell.colspan = 1;
}

function mergeSelection() {
  const grid = tableState.grid;
  let sel = normalizedSelection();
  if (!sel) {
    showToast("Select cells to merge first.", true);
    return;
  }

  // Grow the rectangle until it fully contains any merged cell it touches,
  // so we never leave a span straddling the boundary.
  let { r1, c1, r2, c2 } = sel;
  let changed = true;
  while (changed) {
    changed = false;
    const map = buildOwnerMap(grid);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const o = map[r][c];
        if (!o) continue;
        const cell = grid[o.or][o.oc];
        const er = o.or + cell.rowspan - 1;
        const ec = o.oc + cell.colspan - 1;
        if (o.or < r1) { r1 = o.or; changed = true; }
        if (o.oc < c1) { c1 = o.oc; changed = true; }
        if (er > r2) { r2 = er; changed = true; }
        if (ec > c2) { c2 = ec; changed = true; }
      }
    }
  }

  if (r1 === r2 && c1 === c2) {
    showToast("Select at least two cells to merge.", true);
    return;
  }

  // Gather surviving content, then flatten the whole rectangle into one cell.
  const contents = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = grid[r][c];
      if (!cell.covered && cell.content.trim() !== "") contents.push(cell.content.trim());
    }
  }
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      grid[r][c] = makeCell("");
      if (!(r === r1 && c === c1)) grid[r][c].covered = true;
    }
  }
  grid[r1][c1].content = contents.join("<br>");
  grid[r1][c1].rowspan = r2 - r1 + 1;
  grid[r1][c1].colspan = c2 - c1 + 1;

  setSelection(r1, c1, r1, c1);
  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Cells merged.");
}

function splitSelection() {
  const grid = tableState.grid;
  const sel = normalizedSelection();
  if (!sel) {
    showToast("Select a merged cell to split.", true);
    return;
  }

  const map = buildOwnerMap(grid);
  const owners = new Set();
  for (let r = sel.r1; r <= sel.r2; r++) {
    for (let c = sel.c1; c <= sel.c2; c++) {
      const o = map[r][c];
      if (o) owners.add(o.or + ":" + o.oc);
    }
  }

  let didSplit = false;
  owners.forEach(key => {
    const [or, oc] = key.split(":").map(Number);
    const cell = grid[or][oc];
    if (cell.rowspan > 1 || cell.colspan > 1) {
      splitCellAt(or, oc);
      didSplit = true;
    }
  });

  if (!didSplit) {
    showToast("No merged cells in the selection to split.", true);
    return;
  }

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Cells split.");
}

// Splits any merged cell overlapping a row/column before it is removed,
// keeping the grid rectangular and consistent.
function splitColumnOverlaps(colIdx) {
  const grid = tableState.grid;
  const map = buildOwnerMap(grid);
  const owners = new Set();
  for (let r = 0; r < grid.length; r++) {
    const o = map[r][colIdx];
    if (o) owners.add(o.or + ":" + o.oc);
  }
  owners.forEach(key => {
    const [or, oc] = key.split(":").map(Number);
    const cell = grid[or][oc];
    if (cell.rowspan > 1 || cell.colspan > 1) splitCellAt(or, oc);
  });
}

function splitRowOverlaps(rowIdx) {
  const grid = tableState.grid;
  const map = buildOwnerMap(grid);
  const owners = new Set();
  for (let c = 0; c < tableState.colCount; c++) {
    const o = map[rowIdx][c];
    if (o) owners.add(o.or + ":" + o.oc);
  }
  owners.forEach(key => {
    const [or, oc] = key.split(":").map(Number);
    const cell = grid[or][oc];
    if (cell.rowspan > 1 || cell.colspan > 1) splitCellAt(or, oc);
  });
}

// --- COLUMN & ROW MODIFICATIONS ---
function appendEditorRow() {
  if (tableState.colCount === 0) {
    tableState.colCount = 3; // sensible starting width for a fresh table
  }
  const newRow = Array.from({ length: tableState.colCount }, () => makeCell(""));
  tableState.grid.push(newRow);

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Added new row");
}

function appendEditorColumn() {
  if (tableState.colCount === 0) {
    tableState.colCount = 1;
    tableState.grid.push([makeCell("")]);
  } else {
    tableState.colCount += 1;
    tableState.grid.forEach(row => row.push(makeCell("")));
  }

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Added new column");
}

function removeRow(rowIdx) {
  if (tableState.grid.length <= 1) {
    clearTableGrid();
    return;
  }
  splitRowOverlaps(rowIdx);
  tableState.grid.splice(rowIdx, 1);
  tableState.selection = null;

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Row deleted");
}

function removeColumn(colIdx) {
  if (tableState.colCount <= 1) {
    clearTableGrid();
    return;
  }
  splitColumnOverlaps(colIdx);
  tableState.grid.forEach(row => row.splice(colIdx, 1));
  tableState.colCount -= 1;
  tableState.selection = null;

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Column deleted");
}

function clearTableGrid() {
  tableState.grid = [];
  tableState.colCount = 0;
  tableState.selection = null;
  tableState.originalHTML = "";

  elements.inputRawHtml.value = "";
  elements.originalHtmlDiagnostic.value = "";

  renderInteractiveEditor();
  updatePreviewsAndCode();
  showToast("Table cleared successfully");
}

// --- LIVE COMPILER & INDENTER ---
function updatePreviewsAndCode() {
  const tableHTML = generateCleanHTMLCode();
  
  // Update Code output tab
  elements.cleanedHtmlOutput.value = tableHTML;
  
  // Update Live visual display tab
  if (tableHTML) {
    elements.symposiumPreview.innerHTML = tableHTML;
  } else {
    elements.symposiumPreview.innerHTML = `
      <div style="color: var(--text-tertiary); font-style: italic; text-align: center; margin-top: 5rem;">
        Pristine layout preview will render here automatically.
      </div>
    `;
  }
}

// Generates HTML in the College Music Symposium journal format
function generateCleanHTMLCode() {
  const grid = tableState.grid;
  if (!grid.length) return "";

  let html = '<table border="1" cellspacing="0" cellpadding="0">\n';
  html += '<tbody>\n';

  for (let r = 0; r < grid.length; r++) {
    html += '<tr>\n';
    for (let c = 0; c < tableState.colCount; c++) {
      const cell = grid[r][c];
      if (cell.covered) continue; // spanned by another cell — don't emit a tag

      const isHeader = (tableState.headerRow && r === 0) || (tableState.headerCol && c === 0);
      const tag = isHeader ? 'th' : 'td';
      const rowspanAttr = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
      const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
      const clean = cell.content.trim();

      html += `<${tag} style="vertical-align: top;"${rowspanAttr}${colspanAttr}>\n`;
      html += `<p>${clean}</p>\n`;
      html += `</${tag}>\n`;
    }
    html += '</tr>\n';
  }

  html += '</tbody>\n';
  html += '</table>';
  return html;
}

const JOOMLA_TABLE_CSS = `<style>
    table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
    }

    th,
    td {
        border: 1px solid #ddd;
        padding: 8px;
        vertical-align: middle;
    }

    th {
        background-color: #585852;
        font-weight: bold;
        color: #fff;
    }

    td {
        background-color: #ffffff;
    }

    table tr:nth-child(even) {
        background-color: #f9f9f9;
    }

    table tr:hover {
        background-color: #f1f1f1;
    }
</style>`;

// --- EXPORT SUITE ACTION UTILITIES ---
function copyJoomlaCSS() {
  navigator.clipboard.writeText(JOOMLA_TABLE_CSS)
    .then(() => {
      showToast("Joomla CSS copied! Paste it at the top of your article.");
    })
    .catch(err => {
      console.error(err);
      showToast("Clipboard copy failed.", true);
    });
}

function copyCleanedHTML() {
  const code = elements.cleanedHtmlOutput.value;
  if (!code) {
    showToast("Nothing to copy!", true);
    return;
  }
  
  navigator.clipboard.writeText(code)
    .then(() => {
      showToast("HTML table code copied to Clipboard!");
    })
    .catch(err => {
      console.error(err);
      showToast("Clipboard copy failed.", true);
    });
}

// Copies the preview table as styled Rich Text (enabling gorgeous pasted Word representations)
function copyStyledRichText() {
  const previewContainer = document.getElementById("symposium-preview-content");
  const tableEl = previewContainer.querySelector("table");
  
  if (!tableEl) {
    showToast("Nothing to copy!", true);
    return;
  }
  
  // Inject exact Symposium styles inline so that it works perfectly inside Word / Email
  const styledTableHTML = getInlineStyledTableHTML(tableEl);
  
  // Construct multi-mime clipboard data
  const blobHTML = new Blob([styledTableHTML], { type: "text/html" });
  const blobText = new Blob([tableEl.innerText], { type: "text/plain" });
  
  const clipboardItem = new ClipboardItem({
    "text/html": blobHTML,
    "text/plain": blobText
  });
  
  navigator.clipboard.write([clipboardItem])
    .then(() => {
      showToast("Styled table copied as Rich Text! You can paste into Word.");
    })
    .catch(err => {
      console.error(err);
      showToast("Clipboard rich-text copy failed.", true);
    });
}

// Combines the table HTML with inline styles identical to their CSS specs
function getInlineStyledTableHTML(tableEl) {
  // Generate exact copy of DOM node
  const clone = tableEl.cloneNode(true);
  
  // Inline styles to match College Music Symposium exactly
  clone.style.width = "100%";
  clone.style.borderCollapse = "collapse";
  clone.style.marginTop = "20px";
  clone.style.fontFamily = "Georgia, serif";
  
  const headers = clone.querySelectorAll("th");
  headers.forEach(th => {
    th.style.border = "1px solid #ddd";
    th.style.padding = "8px";
    th.style.verticalAlign = "middle";
    th.style.backgroundColor = "#585852";
    th.style.fontWeight = "bold";
    th.style.color = "#fff";
    th.style.textAlign = "left";
  });
  
  const rows = clone.querySelectorAll("tbody tr");
  rows.forEach((tr, rowIdx) => {
    const cells = tr.querySelectorAll("td");
    const isEven = (rowIdx % 2 === 1); // Striped styling
    
    cells.forEach(td => {
      td.style.border = "1px solid #ddd";
      td.style.padding = "8px";
      td.style.verticalAlign = "middle";
      td.style.backgroundColor = isEven ? "#f9f9f9" : "#ffffff";
      td.style.textAlign = "left";
    });
  });
  
  return clone.outerHTML;
}

function downloadHTMLFile() {
  const code = elements.cleanedHtmlOutput.value;
  if (!code) {
    showToast("Nothing to download!", true);
    return;
  }
  
  const blob = new Blob([code], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = "symposium-clean-table.html";
  document.body.appendChild(a);
  a.click();
  
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Download started successfully!");
}

// --- UTILITIES ---
function showToast(message, isError = false) {
  elements.toastMessage.textContent = message;
  elements.toast.style.backgroundColor = isError ? "var(--error)" : "var(--text-primary)";
  elements.toast.style.color = isError ? "#ffffff" : "var(--bg-app)";
  
  elements.toast.classList.add("show");
  
  setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3500);
}

function showLoading(active) {
  elements.editorLoading.classList.toggle("active", active);
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
