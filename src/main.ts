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
interface PdfDataRow {
  id: number;
  pdfName: string;
  fullPath: string;
  docType: "auftrag" | "rechnung";
  confirmed: boolean;
  warnings?: boolean;

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

let selectedPdfPaths: string[] = [];

let controller: AbortController | null = null;

let store: Store | null = null;

let isProcessing = false;

document.addEventListener("DOMContentLoaded", async () => {
  const exportBtn = document.getElementById("export-excel-btn");
  if (exportBtn) {
    const newExportBtn = exportBtn.cloneNode(true) as HTMLElement;
    exportBtn.parentNode?.replaceChild(newExportBtn, exportBtn);

    newExportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleExportExcel();
    });
  } else {
    console.error("CRITICO: pulsante Esporta (#export-excel-btn) non trovato!");
  }

  try {
    store = await Store.load("settings.json");
  } catch (err) {
    console.warn("settings.json non trovato, crea nuovo archivio:", err);
    await store?.save();
    store = await Store.load("settings.json");
  }

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

  updateStartProcessButtonState();

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
  const processedPathInput = document.getElementById(
    "setting-processed-pdf-path"
  ) as HTMLInputElement;

  const toggleApiKeyBtn = document.getElementById("toggle-api-key-btn");

  if (toggleApiKeyBtn) {
    toggleApiKeyBtn.addEventListener("click", (e) => {
      e.preventDefault();

      const apiKeyInput = document.getElementById(
        "setting-api-key"
      ) as HTMLInputElement;
      const iconEye = document.getElementById("icon-eye");
      const iconEyeOff = document.getElementById("icon-eye-off");

      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        if (iconEye) iconEye.style.display = "none";
        if (iconEyeOff) iconEyeOff.style.display = "block";
      } else {
        apiKeyInput.type = "password";
        if (iconEye) iconEye.style.display = "block";
        if (iconEyeOff) iconEyeOff.style.display = "none";
      }
    });
  }

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

  document
    .getElementById("setting-select-processed-pdf")
    ?.addEventListener("click", async () => {
      const selected = await open({ directory: true });
      if (typeof selected === "string") processedPathInput.value = selected;
    });

  settingsBtn?.addEventListener("click", async () => {
    const [apiKey, pdfPath, excelPath, processedPath, theme] =
      await Promise.all([
        invoke<string>("get_api_key").catch((err) => {
          console.warn(
            "Impossibile caricare la chiave API (forse al primo avvio):",
            err
          );
          return "";
        }),
        store?.get("defaultPdfPath").catch(() => null),
        store?.get("defaultExcelPath").catch(() => null),
        store?.get("defaultProcessedPdfPath").catch(() => null),
        store?.get("defaultTheme").catch(() => null),
      ]);

    if (apiKeyInput) apiKeyInput.value = apiKey || "";
    if (pdfPathInput) pdfPathInput.value = (pdfPath as string) || "";
    if (excelPathInput) excelPathInput.value = (excelPath as string) || "";
    if (processedPathInput)
      processedPathInput.value = (processedPath as string) || "";
    if (theme) themeToggle.checked = theme === "light";

    loadAndRenderCorrections();

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
      await store?.set("defaultProcessedPdfPath", processedPathInput.value);
      const newTheme = themeToggle.checked ? "light" : "dark";
      await store?.set("defaultTheme", newTheme);

      await store?.save();

      document.documentElement.setAttribute("data-theme", newTheme);

      settingsModal!.style.display = "none";
      showToast("Impostazioni salvate", "success");
    } catch (err) {
      console.error("Errore durante il salvataggio:", err);
      showToast(`Errore durante il salvataggio: ${err}`, "error");
    }
  });

  store?.get<string>("defaultTheme").then((theme) => {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
      const toggle = document.getElementById(
        "theme-toggle-input"
      ) as HTMLInputElement;
      if (toggle) toggle.checked = theme === "light";
    }
  });

  store?.get<string>("defaultPdfPath").then((path) => {
    if (path) {
      loadPdfsFromDirectory(path);
    }
  });

  listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
    const droppedPaths = event.payload.paths;

    if (
      droppedPaths &&
      Array.isArray(droppedPaths) &&
      droppedPaths.length > 0
    ) {
      const pdfs = droppedPaths.filter((p) => p.toLowerCase().endsWith(".pdf"));

      if (pdfs.length === 0) {
        showToast("Nessun file PDF rilevato.", "error");
        return;
      }

      selectedPdfPaths.push(...pdfs);

      updateFileUI();

      showToast(
        `${pdfs.length} Ricezione di file tramite drag & drop.`,
        "success"
      );
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
    console.error(
      "Errore durante il caricamento della cartella predefinita:",
      e
    );
    showToast(
      `Errore durante il caricamento della cartella predefinita: ${path}`,
      "error"
    );
  }
}

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
  document.body.classList.add("app-loading");

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
            newRow.warnings = _row.warnings || false;
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
        errorRow.warnings = true;
        if (!aiResults[index]) {
          errorRow.anmerkungen = "Errore: impossibile leggere il PDF.";
        } else if (!aiResult) {
          errorRow.anmerkungen = "Errore: KI non ha risposto.";
        } else {
          errorRow.anmerkungen = "Nessun prodotto riconosciuto.";
        }
        newTableData.push(errorRow);
      }
    });

    hot.loadData(newTableData);
    hot.render();
    hot.updateSettings({
      allowInsertRow: true,
    });
    requestAnimationFrame(() => {
      hot!.refreshDimensions();
    });
  } catch (error) {
    console.error("Errore critico nel processo:", error);
    showToast(`Errore: ${error}`, "error");
  } finally {
    isProcessing = false;
    document.body.classList.remove("app-loading");
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

  const duplicatesCount = selectedPdfPaths.length - newPaths.length;

  if (duplicatesCount > 0) {
    showToast(
      `${duplicatesCount} File ignorati (già presenti nell'elenco).`,
      "info"
    );
  }

  if (newPaths.length === 0) {
    return;
  }

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

        const missingData = isInvoice
          ? !datumRechnung || !nummerAuftrag || !kunde || !lieferant
          : !datumAuftrag || !nummerAuftrag || !kunde || !lieferant;

        return {
          id: nextId++,
          pdfName: fileName,
          fullPath: path,
          docType,
          confirmed: false,
          warnings: missingData,
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
  Handsontable.renderers.TextRenderer.apply(this, arguments as any);

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

function setupHeaderCheckbox() {
  if (!hot) return;
  const container = document.querySelector("#data-grid") as HTMLElement | null;
  if (!container) return;

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
    requestAnimationFrame(setupHeaderCheckbox);
    return;
  }

  headerCells.forEach((th) => {
    if (th.querySelector(".header-confirmed")) return;

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
    checkbox.title = "Conferma tutto";
    checkbox.setAttribute("aria-label", "Conferma tutto");

    checkbox.addEventListener("change", () => {
      const checked = checkbox.checked;

      hot!.batch(() => {
        const data = hot!.getSourceData() as PdfDataRow[];
        data.forEach((_row, index) => {
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

let hot: Handsontable | null = null;

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
        width: 60,
      },
      { data: "nummerAuftrag", width: 50 },
      { data: "kunde", width: 120 },
      { data: "lieferant", width: 120 },
      { data: "produkt", width: 200 },
      { data: "menge", type: "numeric", width: 40 },
      { data: "waehrung", width: 30 },
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
        width: 60,
      },
      { data: "nummerRechnung", width: 50 },
      { data: "gelieferteMenge", type: "numeric", width: 40 },
      { data: "anmerkungen", type: "text", width: 50 },
    ],
    copyPaste: true,
    allowInsertRow: false,
    allowInsertColumn: false,
    allowRemoveRow: true,
    allowRemoveColumn: false,
    manualColumnMove: false,
    manualRowMove: false,
    manualColumnResize: true,
    manualRowResize: false,
    dropdownMenu: false,
    filters: false,
    columnSorting: false,
    contextMenu: {
      items: {
        re_analyze: {
          name: "Analizza di nuovo",
          disabled: function () {
            const selection = this.getSelected();
            if (!selection || selection.length === 0) return true;
            return selection[0][0] !== selection[0][2];
          },
          callback: function (_key, selection) {
            const row = selection[0].start.row;
            reAnalyzeRow(row);
          },
        },
        row_above: { name: "Inserisci riga sopra" },
        row_below: { name: "Inserisci riga sotto" },
        remove_row: { name: "Rimuovi riga" },
        "---------": { name: "---------" },
        undo: { name: "Annulla" },
        redo: { name: "Rifai" },
      },
    },
    fillHandle: true,
    cells(row, col) {
      if (!hot) return {};
      const cellProps: any = {};
      const classList = ["htEllipsis"];

      if (col === 0) {
        classList.push("htLink", "pdf-with-checkbox");
      }

      const rowData = hot.getSourceDataAtRow(row) as PdfDataRow | undefined;

      if (rowData) {
        if (rowData.confirmed) {
          classList.push("confirmed-row");
        } else if (rowData.warnings) {
          classList.push("warning-row");
        }
      }

      cellProps.className = classList.join(" ");
      return cellProps;
    },
    afterRender() {
      setupHeaderCheckbox();
    },
    afterChange(changes, source) {
      if (!changes) return;

      if (
        source === "loadData" ||
        source === "timeValidate" ||
        source === "dateValidate"
      )
        return;

      for (const c of changes) {
        const prop = c[1];
        const oldVal = c[2];
        const newVal = c[3];

        if (prop === "confirmed") {
          updateHeaderCheckboxState();
        }
        if (
          prop === "produkt" &&
          (source === "edit" || source === "Autofill.fill")
        ) {
          if (
            oldVal &&
            newVal &&
            oldVal !== newVal &&
            typeof oldVal === "string" &&
            typeof newVal === "string"
          ) {
            invoke("learn_correction", {
              wrong: oldVal,
              correct: newVal,
            })
              .then(() => {
                console.log(`Imparato: "${oldVal}" -> "${newVal}"`);
              })
              .catch((err) => console.error("Errori di apprendimento:", err));
          }
        }
      }
    },
    afterCreateRow: (index, amount, source) => {
      if (source === "loadData" || !hot) return;

      if (index > 0) {
        const sourceRow = hot.getSourceDataAtRow(index - 1) as PdfDataRow;
        if (!sourceRow) return;

        hot.batch(() => {
          for (let i = 0; i < amount; i++) {
            const rowIdx = index + i;

            const props: (keyof PdfDataRow)[] = [
              "docType",
              "kunde",
              "lieferant",
              "datumAuftrag",
              "nummerAuftrag",
              "datumRechnung",
              "nummerRechnung",
            ];

            props.forEach((prop) => {
              hot!.setDataAtRowProp(rowIdx, prop, sourceRow[prop]);
            });
          }
        });
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

  const pathsToMove = new Set<string>();
  confirmedData.forEach((row) => {
    if (row.fullPath && !row.warnings && row.produkt) {
      pathsToMove.add(row.fullPath);
    }
  });

  if (confirmedData.length === 0) {
    showToast("Nessuna riga confermata per l'esportazione.", "info");
    isProcessing = false;
    return;
  }

  let unlisten: (() => void) | null = null;

  try {
    document.body.classList.add("app-loading");

    setProgress(0, confirmedData.length);

    unlisten = await listen<{ current: number; total: number }>(
      "excel-progress",
      (event) => {
        setProgress(event.payload.current, event.payload.total);
      }
    );

    const msg = await invoke<string>("export_to_excel", {
      data: confirmedData,
      filePath: (await store?.get<string>("defaultExcelPath")) || null,
    });

    if (msg !== "Interruzione da parte dell'utente") {
      showToast(msg, "success");

      const processedDir = await store?.get<string>("defaultProcessedPdfPath");
      if (processedDir && pathsToMove.size > 0) {
        try {
          await invoke("move_files", {
            paths: Array.from(pathsToMove),
            targetDir: processedDir,
          });
          showToast(`${pathsToMove.size} PDF spostati.`, "success");
        } catch (moveErr) {
          showToast(`Errore durante lo spostamento: ${moveErr}`, "error");
        }
      }
    }

    isProcessing = false;
  } catch (err) {
    console.error(err);
    showToast(`${err}`, "error");
  } finally {
    if (unlisten) unlisten();
    setProgress(0, 0);
    document.body.classList.remove("app-loading");
    isProcessing = false;
  }
}

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

async function loadAndRenderCorrections() {
  const listEl = document.getElementById("corrections-list");
  if (!listEl) return;

  try {
    const corrections = await invoke<Record<string, string>>("get_corrections");

    listEl.innerHTML = "";

    const entries = Object.entries(corrections);

    if (entries.length === 0) {
      listEl.innerHTML =
        '<li class="empty-state">Nessuna correzione imparata.</li>';
      return;
    }

    entries.sort((a, b) => a[0].localeCompare(b[0]));

    entries.forEach(([wrong, correct]) => {
      const li = document.createElement("li");

      const textDiv = document.createElement("div");
      textDiv.className = "correction-text";
      textDiv.innerHTML = `
        <span class="correction-wrong" title="${wrong}">${wrong}</span>
        <span class="correction-arrow">➜</span>
        <span class="correction-right" title="${correct}">${correct}</span>
      `;

      const delBtn = document.createElement("button");
      delBtn.className = "delete-correction-btn";
      delBtn.title = "Elimina voce";
      delBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;

      delBtn.addEventListener("click", async () => {
        try {
          await invoke("remove_correction", { wrong });
          await loadAndRenderCorrections();
        } catch (e) {
          console.error(e);
          alert("Errore durante la cancellazione: " + e);
        }
      });

      li.appendChild(textDiv);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  } catch (e) {
    console.error("Errore durante il caricamento delle correzioni:", e);
    listEl.innerHTML =
      '<li class="empty-state">Errore durante il caricamento delle correzioni.</li>';
  }
}

async function reAnalyzeRow(row: number) {
  if (!hot) return;

  const rowData = hot.getSourceDataAtRow(row) as PdfDataRow;

  if (!rowData || !rowData.fullPath) {
    showToast("Nessun percorso file presente in questa riga.", "error");
    return;
  }

  document.body.classList.add("app-loading");
  showToast("Analizza nuovamente il PDF...", "info");

  try {
    const result = await invoke<AiResponse>("analyze_document", {
      path: rowData.fullPath,
      docType: rowData.docType,
    });

    const products = result.produkte;

    if (products && Array.isArray(products) && products.length > 0) {
      hot.batch(() => {
        const firstProd = products[0];

        if (rowData.docType === "auftrag") {
          hot!.setDataAtRowProp(row, "menge", firstProd.menge);
          hot!.setDataAtRowProp(row, "waehrung", firstProd.waehrung);
          hot!.setDataAtRowProp(row, "preis", firstProd.preis);
        } else {
          hot!.setDataAtRowProp(
            row,
            "gelieferteMenge",
            firstProd.gelieferteMenge
          );
          hot!.setDataAtRowProp(row, "nummerRechnung", result.nummerRechnung);
        }
        hot!.setDataAtRowProp(row, "produkt", firstProd.produkt);

        hot!.setDataAtRowProp(row, "anmerkungen", "");
        if (products.length > 1) {
          const extraProducts = products.slice(1);
          hot!.alter("insert_row_below", row, extraProducts.length);

          extraProducts.forEach((prod, i) => {
            const newRowIdx = row + 1 + i;

            hot!.setDataAtRowProp(newRowIdx, "produkt", prod.produkt);

            if (rowData.docType === "auftrag") {
              hot!.setDataAtRowProp(newRowIdx, "menge", prod.menge);
              hot!.setDataAtRowProp(newRowIdx, "waehrung", prod.waehrung);
              hot!.setDataAtRowProp(newRowIdx, "preis", prod.preis);
            } else {
              hot!.setDataAtRowProp(
                newRowIdx,
                "gelieferteMenge",
                prod.gelieferteMenge
              );
              hot!.setDataAtRowProp(
                newRowIdx,
                "nummerRechnung",
                result.nummerRechnung
              );
            }
          });
        }
      });

      showToast("Analisi completata con successo!", "success");
    } else {
      hot.setDataAtRowProp(row, "anmerkungen", "Nessun prodotto rilevato.");
      showToast("Nessun prodotto riconosciuto.", "info");
    }
  } catch (err) {
    console.error(err);
    hot.setDataAtRowProp(row, "anmerkungen", String(err));
    showToast("Errore nell'analisi.", "error");
  } finally {
    document.body.classList.remove("app-loading");
  }
}
