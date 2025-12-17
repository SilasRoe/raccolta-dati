import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import Handsontable from "handsontable";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { chunk } from "lodash";
import { Store } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";

import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";

/** Interface für einen Datensatz der Handsontable */
interface PdfDataRow {
  id: number;
  pdfName: string;
  fullPath: string;
  docType: "auftrag" | "rechnung";
  confirmed: boolean;

  kunde?: string | null;
  lieferant?: string | null;
  datumAuftrag?: string | null;
  nummerAuftrag?: string | null;

  produkt?: string | null;
  menge?: number | null;
  einheit?: string | null;
  preis?: number | null;
  waehrung?: string | null;

  datumRechnung?: string | null;
  nummerRechnung?: string | null;
  gelieferteMenge?: number | null;

  anmerkungen?: string | null;
}
interface AiProduct {
  produkt?: string | null;
  menge?: number | null;
  waehrung?: string | null;
  preis?: number | null;
  gelieferteMenge?: number | null;
}
interface AiResponse {
  nummerRechnung?: string | null;
  produkte?: AiProduct[];
}

/**
 * Array storing paths of selected PDF files
 */
let selectedPdfPaths: string[] = [];

let controller: AbortController | null = null;

let store: Store | null = null;

let isProcessing = false;
/**
 * Initialize event listeners when DOM content is loaded
 */
document.addEventListener("DOMContentLoaded", async () => {
  store = await Store.load("settings.json");
  setupProgressBar();

  const startProcessBtn = document.querySelector(
    "#start-process-btn"
  ) as HTMLButtonElement;
  if (startProcessBtn) {
    startProcessBtn.addEventListener("click", handleStartProcess);
  }

  function handleStartProcess() {}

  function updateStartProcessButtonState() {
    const startProcessBtn = document.querySelector(
      "#start-process-btn"
    ) as HTMLButtonElement;
    if (startProcessBtn) {
      const isTableFilled =
        document.querySelector("#data-grid table tbody tr td:first-child") !==
        null;
      startProcessBtn.disabled = !isTableFilled;
    }
  }

  // Call the function to set the initial state of the button
  updateStartProcessButtonState();

  // Add event listener to update the button state when the table content changes
  const dataGrid = document.querySelector("#data-grid") as HTMLElement;
  const observer = new MutationObserver(() => {
    updateStartProcessButtonState();
  });
  observer.observe(dataGrid, { childList: true, subtree: true });

  const selectFilesBtn = document.querySelector(
    "#select-files-btn"
  ) as HTMLButtonElement;
  const selectFolderBtn = document.querySelector(
    "#select-folder-btn"
  ) as HTMLButtonElement;
  const startResearchBtn = document.querySelector(
    "#start-process-btn"
  ) as HTMLButtonElement;
  const themeToggle = document.querySelector(
    "#theme-toggle-input"
  ) as HTMLInputElement;
  const exportBtn = document.querySelector(
    "#export-excel-btn"
  ) as HTMLButtonElement;

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener("click", handleSelectFiles);
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener("click", handleSelectFolder);
  }
  if (startResearchBtn) {
    controller = new AbortController();
    const signal = controller.signal;
    startResearchBtn.addEventListener(
      "click",
      () => {
        handleReseachStart();
      },
      { signal: signal }
    );
  }

  if (themeToggle) {
    themeToggle.setAttribute("role", "switch");
    themeToggle.setAttribute("aria-checked", String(themeToggle.checked));
    themeToggle.addEventListener("change", toggleTheme);
    toggleTheme();
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", handleExportExcel);
  }

  const settingsModal = document.getElementById("settings-modal");
  const settingsBtn = document.getElementById("settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");

  const apiKeyInput = document.getElementById(
    "setting-api-key"
  ) as HTMLInputElement;
  const pdfPathInput = document.getElementById(
    "setting-pdf-path"
  ) as HTMLInputElement;
  const excelPathInput = document.getElementById(
    "setting-excel-path"
  ) as HTMLInputElement;
  const themeSelect = document.getElementById(
    "setting-theme"
  ) as HTMLSelectElement;

  document
    .getElementById("setting-select-pdf")
    ?.addEventListener("click", async () => {
      const selected = await open({ directory: true });
      if (typeof selected === "string") pdfPathInput.value = selected;
    });

  document
    .getElementById("setting-select-excel")
    ?.addEventListener("click", async () => {
      const selected = await open({
        filters: [{ name: "Excel", extensions: ["xlsx", "xlsm"] }],
      });
      if (typeof selected === "string") excelPathInput.value = selected;
    });

  settingsBtn?.addEventListener("click", async () => {
    const [apiKey, pdfPath, excelPath, theme] = await Promise.all([
      invoke<string>("get_api_key"),
      store?.get<string>("defaultPdfPath"),
      store?.get<string>("defaultExcelPath"),
      store?.get<string>("defaultTheme"),
    ]);

    if (apiKey) apiKeyInput.value = apiKey;
    if (pdfPath) pdfPathInput.value = pdfPath;
    if (excelPath) excelPathInput.value = excelPath;
    if (theme) themeSelect.value = theme;

    settingsModal!.style.display = "flex";
  });

  closeSettingsBtn?.addEventListener("click", () => {
    settingsModal!.style.display = "none";
  });

  saveSettingsBtn?.addEventListener("click", async () => {
    try {
      await invoke("save_api_key", { key: apiKeyInput.value });

      await store?.set("defaultPdfPath", pdfPathInput.value);
      await store?.set("defaultExcelPath", excelPathInput.value);
      await store?.set("defaultTheme", themeSelect.value);

      await store?.save();

      if (themeSelect.value === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        (
          document.getElementById("theme-toggle-input") as HTMLInputElement
        ).checked = false;
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        (
          document.getElementById("theme-toggle-input") as HTMLInputElement
        ).checked = true;
      }

      settingsModal!.style.display = "none";
      showToast("Einstellungen gespeichert", "success");
    } catch (err) {
      console.error("Fehler beim Speichern:", err);
      showToast(`Fehler beim Speichern: ${err}`, "error");
    }
  });

  store.get<string>("defaultTheme").then((theme) => {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
      const toggle = document.getElementById(
        "theme-toggle-input"
      ) as HTMLInputElement;
      if (toggle) toggle.checked = theme === "light";
    }
  });

  store.get<string>("defaultPdfPath").then((path) => {
    if (path) {
      loadPdfsFromDirectory(path);
    }
  });
});

const selectFilesBtn = document.querySelector("#select-files-btn");
const selectFolderBtn = document.querySelector("#select-folder-btn");
const themeToggle = document.querySelector(
  "#theme-toggle-input"
) as HTMLInputElement;

if (selectFilesBtn) {
  selectFilesBtn.addEventListener("click", handleSelectFiles);
}
if (selectFolderBtn) {
  selectFolderBtn.addEventListener("click", handleSelectFolder);
}

if (themeToggle) {
  themeToggle.setAttribute("role", "switch");
  themeToggle.setAttribute("aria-checked", String(themeToggle.checked));
  themeToggle.addEventListener("change", toggleTheme);
  toggleTheme();
}

async function loadPdfsFromDirectory(path: string) {
  try {
    const entries = await readDir(path);

    const pdfEntries = entries.filter(
      (entry) =>
        entry.name?.toLowerCase().endsWith(".pdf") && !entry.isDirectory
    );

    selectedPdfPaths = await Promise.all(
      pdfEntries.map((entry) => join(path, entry.name!))
    );

    updateFileUI();
  } catch (e) {
    console.error("Fehler beim Laden des Standardordners:", e);
    showToast(`Fehler beim Laden des Ordners: ${path}`, "error");
  }
}

/**
 * Handle PDF file selection via file dialog
 */
async function handleSelectFiles() {
  if (isProcessing) return;
  const result = await open({
    title: "Selezionare i file PDF",
    multiple: true,
    filters: [
      {
        name: "PDF",
        extensions: ["pdf"],
      },
    ],
  });

  if (Array.isArray(result)) {
    selectedPdfPaths = result;
  } else if (result) {
    selectedPdfPaths = [result];
  } else {
    selectedPdfPaths = [];
  }

  updateFileUI();
}

/**
 * Handle folder selection and filter PDF files
 */
async function handleSelectFolder() {
  if (isProcessing) return;
  const result = await open({
    title: "Selezionare la cartella PDF",
    directory: true,
    multiple: false,
  });

  if (typeof result === "string") {
    await loadPdfsFromDirectory(result);
  }
}

/**
 * Erstellt Balken UND Text-Anzeige im DOM
 */
function setupProgressBar() {
  if (!document.getElementById("progress-container")) {
    const container = document.createElement("div");
    container.id = "progress-container";
    const bar = document.createElement("div");
    bar.id = "progress-bar";
    container.appendChild(bar);
    document.body.appendChild(container);

    const text = document.createElement("div");
    text.id = "progress-text";
    document.body.appendChild(text);
  }
}

/**
 * Aktualisiert Balken und Text.
 * @param current Anzahl der ERLEDIGTEN Dateien
 * @param total Gesamtanzahl
 */
function setProgress(current: number, total: number) {
  const container = document.getElementById("progress-container");
  const bar = document.getElementById("progress-bar");
  const text = document.getElementById("progress-text");

  if (!container || !bar || !text) return;

  if (total <= 0) {
    container.style.display = "none";
    text.style.display = "none";
    return;
  }

  container.style.display = "block";
  text.style.display = "block";
  let percent = (current / total) * 100;
  if (current === 0 && total > 0) {
    percent = 1;
  } else if (current > 0) {
    percent = 1 + (current / total) * 99;
  }

  bar.style.width = `${percent}%`;
  text.textContent = `${current} / ${total}`;

  if (current >= total) {
    setTimeout(() => {
      container.style.display = "none";
      text.style.display = "none";
      bar.style.width = "0%";
    }, 1500);
  }
}

async function handleReseachStart() {
  if (!hot || isProcessing) return;

  const startBtn = document.querySelector(
    "#start-process-btn"
  ) as HTMLButtonElement;
  isProcessing = true;
  if (startBtn) startBtn.disabled = true;
  document.body.style.cursor = "wait";

  try {
    const data = hot.getSourceData() as PdfDataRow[];

    const validRows = data.filter((r) => r.fullPath);
    const totalTasks = validRows.length;
    let completedCount = 0;
    setProgress(0, totalTasks);

    const chunkedData = chunk(data, 5);
    const aiResults: {
      index: number;
      row: PdfDataRow;
      docType: "auftrag" | "rechnung";
      result: AiResponse;
    }[] = [];

    for (const dataChunk of chunkedData) {
      const chunkResults = await Promise.all(
        dataChunk.map(async (row, index) => {
          if (!row.fullPath) return null;

          try {
            const result = await invoke<AiResponse>("analyze_document", {
              path: row.fullPath,
              docType: row.docType,
            });

            const docType = row.docType;

            completedCount++;
            setProgress(completedCount, totalTasks);
            return { index, row, docType, result };
          } catch (err) {
            console.error(err);
            completedCount++;
            setProgress(completedCount, totalTasks);
            hot!.setDataAtRowProp(index, "anmerkungen", String(err));
            return {
              index,
              row,
              docType: row.docType,
              result: {} as AiResponse,
            };
          }
        })
      );
      aiResults.push(
        ...chunkResults.filter(
          (
            item
          ): item is {
            index: number;
            row: PdfDataRow;
            docType: "auftrag" | "rechnung";
            result: AiResponse;
          } => item !== null
        )
      );
    }

    const newTableData: PdfDataRow[] = [];

    data.forEach((_row, index) => {
      const aiResult = aiResults[index]?.result;
      const products = aiResult?.produkte;
      const docType = aiResults[index]?.docType;

      if (products && Array.isArray(products) && products.length > 0) {
        products.forEach((prod, prodIndex) => {
          const newRow: PdfDataRow = { ..._row };

          if (prodIndex > 0) {
            newRow.pdfName = "";
            newRow.fullPath = "";
            newRow.confirmed = false;
          }

          newRow.produkt = prod.produkt;

          if (docType === "auftrag") {
            newRow.menge = prod.menge;
            newRow.waehrung = prod.waehrung;
            newRow.preis = prod.preis;
          } else {
            newRow.gelieferteMenge = prod.gelieferteMenge;
            newRow.nummerRechnung = aiResult.nummerRechnung;
          }

          newTableData.push(newRow);
        });
      } else {
        const errorRow = { ..._row };
        if (!aiResults[index]) {
          errorRow.anmerkungen = "Fehler: PDF konnte nicht gelesen werden.";
        } else if (!aiResult) {
          errorRow.anmerkungen = "Fehler: KI hat nicht geantwortet.";
        } else {
          errorRow.anmerkungen = "Keine Produkte erkannt.";
        }
        newTableData.push(errorRow);
      }
    });

    hot.loadData(newTableData);

    hot.render();

    requestAnimationFrame(() => {
      hot!.refreshDimensions();
    });
  } catch (error) {
    console.error("Kritischer Fehler im Prozess:", error);
    showToast(`Fehler: ${error}`, "error");
  } finally {
    isProcessing = false;
    if (startBtn) startBtn.disabled = false;
    document.body.style.cursor = "default";
  }
}

function parseDateStrings(dateString: string) {
  let date;
  if (dateString && dateString.length === 8) {
    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    date = `${day}.${month}.${year}`;
  }
  return date || null;
}

function updateFileUI() {
  if (!hot) return;

  const currentData = hot.getSourceData() as PdfDataRow[];
  const existingPaths = new Set(
    currentData.map((row) => row.fullPath).filter(Boolean)
  );

  let nextId =
    currentData.length > 0
      ? Math.max(...currentData.map((r) => r.id || 0)) + 1
      : 1;

  const newPaths = selectedPdfPaths.filter((path) => !existingPaths.has(path));

  const newRows = newPaths
    .map((path): PdfDataRow | null => {
      try {
        const lastSeparatorIndex = Math.max(
          path.lastIndexOf("/"),
          path.lastIndexOf("\\")
        );
        const fileName = path
          .substring(lastSeparatorIndex + 1)
          .replace(/\.pdf$/i, "")
          .toUpperCase();

        const isInvoice = fileName.startsWith("FT");
        const docType = isInvoice ? "rechnung" : "auftrag";

        let datumRechnung, datumAuftrag, nummerAuftrag, kunde, lieferant;

        const parts = fileName.split("_");

        if (isInvoice) {
          datumRechnung = parseDateStrings(parts[2]?.split("-")[0]);
          nummerAuftrag = parts[3] || null;
          kunde = parts[2]?.split("-")[1] || null;
          lieferant = parts[1] || null;
        } else {
          datumAuftrag = parseDateStrings(parts[1]);
          nummerAuftrag = parts[0] || null;
          kunde = parts[2]?.split("-")[1] || null;
          lieferant = parts[2]?.split("-")[0] || null;
        }

        return {
          id: nextId++,
          pdfName: fileName,
          fullPath: path,
          docType,
          confirmed: false,
          kunde,
          lieferant,
          datumAuftrag: datumAuftrag || null,
          nummerAuftrag,
          datumRechnung: datumRechnung || null,
        } as PdfDataRow;
      } catch (e) {
        console.error(`Errore durante l'analisi di ${path}:`, e);
        return null;
      }
    })
    .filter((row): row is PdfDataRow => row !== null);

  hot.loadData([...currentData, ...newRows]);
}

/**
 * Renderer for the PDF name column that places the filename (left) and a checkbox (right).
 * The checkbox stays in sync with the row's `confirmed` property.
 */
function pdfNameRenderer(
  this: Handsontable.Core,
  _instance: Handsontable.Core,
  td: HTMLTableCellElement,
  row: number,
  _col: number,
  _prop: string | number,
  value: Handsontable.CellValue,
  _cellProperties: Handsontable.CellProperties
) {
  // Keep base text rendering (for things like selection styling)
  Handsontable.renderers.TextRenderer.apply(this, arguments as any);

  // Ensure tooltip/title for full value
  if (value !== null && value !== undefined) td.title = String(value);

  td.classList.add("pdf-with-checkbox");
  td.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-cell-inner";

  const span = document.createElement("span");
  span.className = "pdf-cell-text";
  span.textContent = value !== null && value !== undefined ? String(value) : "";
  span.title = span.textContent || "";
  wrapper.appendChild(span);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "row-confirm-checkbox";

  const rowData = hot ? (hot.getSourceDataAtRow(row) as PdfDataRow) : null;
  checkbox.checked = Boolean(rowData && rowData.confirmed);

  checkbox.addEventListener("change", () => {
    const checked = checkbox.checked;
    if (hot) {
      hot.setDataAtRowProp(row, "confirmed", checked);
    }
  });

  wrapper.appendChild(checkbox);
  td.appendChild(wrapper);
}

/**
 * Custom renderer for ellipsis in table cells
 */
function ellipsisRenderer(
  this: Handsontable.Core,
  _instance: Handsontable.Core,
  td: HTMLTableCellElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: Handsontable.CellValue,
  _cellProperties: Handsontable.CellProperties
) {
  Handsontable.renderers.TextRenderer.apply(this, arguments as any);

  if (value !== null && value !== undefined) {
    td.title = String(value);
  }
}

/**
 * Update the header checkbox state (checked / indeterminate) based on row data
 */
function updateHeaderCheckboxState() {
  if (!hot) return;
  const cbs = Array.from(
    document.querySelectorAll(".header-confirmed")
  ) as HTMLInputElement[];
  if (!cbs || cbs.length === 0) return;

  const data = hot.getSourceData() as PdfDataRow[];
  if (!data || data.length === 0) {
    cbs.forEach((cb) => {
      cb.checked = false;
      cb.indeterminate = false;
    });
    return;
  }

  const confirmedCount = data.reduce(
    (acc, r) => acc + (r.confirmed ? 1 : 0),
    0
  );
  if (confirmedCount === 0) {
    cbs.forEach((cb) => {
      cb.checked = false;
      cb.indeterminate = false;
    });
  } else if (confirmedCount === data.length) {
    cbs.forEach((cb) => {
      cb.checked = true;
      cb.indeterminate = false;
    });
  } else {
    cbs.forEach((cb) => {
      cb.checked = false;
      cb.indeterminate = true;
    });
  }
}

/**
 * Injects a checkbox into the header cell at index 1 and wires its behaviour
 */
function setupHeaderCheckbox() {
  if (!hot) return;
  const container = document.querySelector("#data-grid") as HTMLElement | null;
  if (!container) return;

  // Handsontable renders header clones; attempt to find both top and master header cells
  const selectors = [
    ".ht_clone_top .htCore thead th:nth-child(1)",
    ".ht_master .htCore thead th:nth-child(1)",
    "#data-grid thead th:nth-child(1)",
  ];

  const headerCells: HTMLElement[] = [];
  for (const s of selectors) {
    const el = container.querySelector(s) as HTMLElement | null;
    if (el && !headerCells.includes(el)) headerCells.push(el);
  }

  if (headerCells.length === 0) {
    // header not ready yet — try again on next frame
    requestAnimationFrame(setupHeaderCheckbox);
    return;
  }

  // Inject a separate checkbox into each found header cell (keep them in sync via updateHeaderCheckboxState)
  headerCells.forEach((th) => {
    // Avoid re-injecting
    if (th.querySelector(".header-confirmed")) return;

    // Preserve header text and insert checkbox aligned to the right
    // Avoid re-injecting if header already contains our wrapper
    if (th.querySelector(".header-content")) return;

    const existingText = th.textContent ? th.textContent.trim() : "";
    th.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "header-content";
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "space-between";
    wrapper.style.alignItems = "center";
    wrapper.style.width = "100%";

    const span = document.createElement("span");
    span.className = "header-text";
    span.textContent = existingText;
    wrapper.appendChild(span);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "header-confirmed";
    checkbox.title = "Alle bestätigen";
    checkbox.setAttribute("aria-label", "Alle bestätigen");

    checkbox.addEventListener("change", () => {
      const checked = checkbox.checked;

      // batch() verhindert unnötiges Neu-Rendern bei jeder einzelnen Änderung
      hot!.batch(() => {
        const data = hot!.getSourceData() as PdfDataRow[];
        data.forEach((row, index) => {
          hot!.setDataAtRowProp(index, "confirmed", checked);
        });
      });
      updateHeaderCheckboxState();
    });

    wrapper.appendChild(checkbox);
    th.appendChild(wrapper);
  });

  updateHeaderCheckboxState();
}

/**
 * Handsontable instance for data grid
 */
let hot: Handsontable | null = null;

/**
 * Initialize Handsontable data grid
 */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector("#data-grid");
  if (!container) return;

  hot = new Handsontable(container, {
    data: [],
    colHeaders: [
      "File PDF",
      "Data",
      "N°",
      "Cliente",
      "Casa Estera",
      "Prodotto",
      "kg/pz.",
      "Val.",
      "Prezzo kg/z.",
      "Data fattura Casa rapp.",
      "N° fattura Casa rapp.",
      "kg/pz.",
      "Note",
    ],
    className: "htEllipsis",
    renderer: ellipsisRenderer,
    columns: [
      {
        data: "pdfName",
        readOnly: true,
        className: "htEllipsis htLink pdf-with-checkbox",
        renderer: pdfNameRenderer,
        width: 100,
      },
      {
        data: "datumAuftrag",
        type: "date",
        dateFormat: "DD.MM.YYYY",
        dateFormats: ["DD.MM.YYYY"],
        correctFormat: true,
        width: 75,
      },
      { data: "nummerAuftrag", width: 50 },
      { data: "kunde", width: 120 },
      { data: "lieferant", width: 120 },
      { data: "produkt", width: 160 },
      { data: "menge", type: "numeric", width: 40 },
      { data: "waehrung", width: 40 },
      {
        data: "preis",
        type: "numeric",
        numericFormat: { pattern: "0.00 €" },
        width: 50,
      },
      {
        data: "datumRechnung",
        type: "date",
        dateFormat: "DD.MM.YYYY",
        dateFormats: ["DD.MM.YYYY"],
        correctFormat: true,
        width: 75,
      },
      { data: "nummerRechnung", width: 50 },
      { data: "gelieferteMenge", type: "numeric", width: 40 },
      { data: "anmerkungen", type: "text", width: 50 },
    ],
    copyPaste: true,
    allowInsertRow: false,
    allowInsertColumn: false,
    allowRemoveRow: false,
    allowRemoveColumn: false,
    manualColumnMove: false,
    manualRowMove: false,
    manualColumnResize: true,
    manualRowResize: false,
    dropdownMenu: false,
    filters: false,
    columnSorting: false,
    contextMenu: false,
    fillHandle: true,
    cells(row, col) {
      if (!hot) return {};

      const cellProps: any = {};

      const classList = ["htEllipsis"];

      if (col === 0) {
        classList.push("htLink", "pdf-with-checkbox");
      }

      const rowData = hot.getSourceDataAtRow(row) as PdfDataRow;
      if (rowData) {
        if (rowData.confirmed) {
          classList.push("confirmed-row");
        }
      }

      cellProps.className = classList.join(" ");

      return cellProps;
    },
    afterRender() {
      setupHeaderCheckbox();
    },
    afterChange(changes, _source) {
      if (!changes) return;
      for (const c of changes) {
        const prop = c[1];
        if (prop === "confirmed") {
          updateHeaderCheckboxState();
          break;
        }
      }
    },

    async afterOnCellMouseDown(event, coords) {
      if (coords.col === 0 && hot) {
        const target = event && (event.target as HTMLElement | null);
        if (target) {
          if (!target.closest(".pdf-cell-text")) return;
        }

        const rowData = hot.getSourceDataAtRow(coords.row) as PdfDataRow;
        if (rowData && rowData.fullPath) {
          await openPath(rowData.fullPath);
        }
      }
    },
    renderAllRows: true,
    viewportColumnRenderingOffset: 10,
    viewportRowRenderingOffset: 10,
    width: "100%",
    height: "100%",
    stretchH: "all",
    preventOverflow: "horizontal",
    minSpareRows: 0,
    rowHeaders: false,
    autoColumnSize: false,
    themeName: "ht-theme-main-dark-auto",
    licenseKey: "non-commercial-and-evaluation",
  });

  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  requestAnimationFrame(() => setupHeaderCheckbox());

  const observer = new ResizeObserver(() => {
    if (hot) {
      hot.refreshDimensions();
    }
  });

  observer.observe(container);

  setTimeout(() => {
    if (hot) {
      hot.refreshDimensions();
    }
  }, 200);
});

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const themeToggle = document.querySelector(
    "#theme-toggle-input"
  ) as HTMLInputElement;
  const themeLabel = document.querySelector(
    ".theme-toggle-label"
  ) as HTMLElement | null;
  if (!themeToggle) return;

  const isChecked = themeToggle.checked;
  const theme = isChecked ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", theme);

  themeToggle.setAttribute("aria-checked", String(isChecked));
  if (themeLabel) {
    themeLabel.setAttribute("aria-pressed", String(isChecked));
  }
}

async function handleExportExcel() {
  if (!hot || isProcessing) return;

  isProcessing = true;

  const allData = hot.getSourceData() as PdfDataRow[];
  const confirmedData = allData.filter((row) => row.confirmed);

  if (confirmedData.length === 0) {
    showToast("Keine bestätigten Zeilen für den Export.", "info");
    return;
  }

  let unlisten: (() => void) | null = null;

  try {
    document.body.style.cursor = "wait";

    setProgress(0, confirmedData.length);

    unlisten = await listen<{ current: number; total: number }>(
      "excel-progress",
      (event) => {
        setProgress(event.payload.current, event.payload.total);
      }
    );

    const defaultExcelPath = await store?.get<string>("defaultExcelPath");

    const msg = await invoke<string>("export_to_excel", {
      data: confirmedData,
      filePath: defaultExcelPath || null,
    });

    if (msg !== "Demolizione") {
      showToast(msg, "success");
    }

    isProcessing = false;
  } catch (err) {
    console.error(err);
    showToast(`${err}`, "error");
  } finally {
    if (unlisten) unlisten();
    setProgress(0, 0);
    document.body.style.cursor = "default";
    isProcessing = false;
  }
}

/**
 * Zeigt ein minimalistisches Pop-Up (Toast) an.
 * @param text Nachricht
 * @param type 'success' | 'error' | 'info'
 */
function showToast(text: string, type: "success" | "error" | "info" = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = text;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => {
      toast.remove();
    });
  }, 3000);
}
