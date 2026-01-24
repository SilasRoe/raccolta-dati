import { PdfDataRow } from "../types";
import { appState } from "./state";
import { setProgress, showToast } from "./ui";
import { api } from "./api";

import Handsontable from "handsontable";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";

export function createGrid(container: Element): Handsontable {
  appState.hot = new Handsontable(container, {
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
        width: 75,
      },
      {
        data: "datumAuftrag",
        type: "date",
        dateFormat: "DD/MM/YYYY",
        dateFormats: ["DD/MM/YYYY"],
        correctFormat: true,
        width: 60,
      },
      { data: "nummerAuftrag", width: 50 },
      { data: "kunde", width: 75 },
      { data: "lieferant", width: 75 },
      { data: "produkt", width: 150 },
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
        dateFormat: "DD/MM/YYYY",
        dateFormats: ["DD/MM/YYYY"],
        correctFormat: true,
        width: 60,
      },
      { data: "nummerRechnung", width: 50 },
      { data: "gelieferteMenge", type: "numeric", width: 40 },
      { data: "anmerkungen", type: "text", width: 100 },
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
      if (!appState.hot) return {};
      const cellProps: any = {};
      const classList = ["htEllipsis"];

      if (col === 0) {
        classList.push("htLink", "pdf-with-checkbox");
      }

      const rowData = this.instance.getSourceDataAtRow(row) as PdfDataRow;

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
            api
              .learnCorrection(oldVal, newVal)
              .then(() => {
                console.log(`Imparato: "${oldVal}" -> "${newVal}"`);
              })
              .catch((err) => console.error("Errori di apprendimento:", err));
          }
        }
      }
    },
    afterCreateRow: (index, amount, source) => {
      if (source === "loadData" || !appState.hot) return;

      if (index > 0) {
        const sourceRow = appState.hot.getSourceDataAtRow(index - 1) as PdfDataRow;
        if (!sourceRow) return;

        appState.hot.batch(() => {
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
              appState.hot!.setDataAtRowProp(rowIdx, prop, sourceRow[prop]);
            });
          }
        });
      }
    },
    async afterOnCellMouseDown(event, coords) {
      if (coords.col === 0 && appState.hot) {
        const target = event && (event.target as HTMLElement | null);
        if (target) {
          if (!target.closest(".pdf-cell-text")) return;
        }

        const rowData = appState.hot.getSourceDataAtRow(coords.row) as PdfDataRow;
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

  return appState.hot;
}

function ellipsisRenderer(
  this: Handsontable.Core,
  _instance: Handsontable.Core,
  td: HTMLTableCellElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: Handsontable.CellValue,
  _cellProperties: Handsontable.CellProperties,
) {
  Handsontable.renderers.TextRenderer.apply(this, arguments as any);

  if (value !== null && value !== undefined) {
    td.title = String(value);
  }
}

async function reAnalyzeRow(row: number) {
  if (!appState.hot) return;

  const rowData = appState.hot.getSourceDataAtRow(row) as PdfDataRow;

  if (!rowData || !rowData.fullPath) {
    showToast("Nessun percorso file presente in questa riga.", "error");
    return;
  }

  document.body.classList.add("app-loading");
  showToast("Analizza nuovamente il PDF...", "info");

  try {
    const result = await api.analyzeDocument(rowData.fullPath, rowData.docType);

    const products = result.produkte;

    if (products && Array.isArray(products) && products.length > 0) {
      appState.hot.batch(() => {
        const firstProd = products[0];

        appState.hot!.setDataAtRowProp(row, "produkt", firstProd.produkt);

        if (rowData.docType === "auftrag") {
          appState.hot!.setDataAtRowProp(row, "menge", firstProd.menge);
          appState.hot!.setDataAtRowProp(row, "waehrung", firstProd.waehrung);
          appState.hot!.setDataAtRowProp(row, "preis", firstProd.preis);
        } else {
          appState.hot!.setDataAtRowProp(
            row,
            "gelieferteMenge",
            firstProd.gelieferteMenge,
          );
          appState.hot!.setDataAtRowProp(
            row,
            "nummerRechnung",
            result.nummerRechnung,
          );
          appState.hot!.setDataAtRowProp(row, "preis", firstProd.preis);
        }

        appState.hot!.setDataAtRowProp(row, "anmerkungen", "");

        if (products.length > 1) {
          const extraProducts = products.slice(1);
          appState.hot!.alter("insert_row_below", row, extraProducts.length);

          extraProducts.forEach((prod, i) => {
            const newRowIdx = row + 1 + i;

            appState.hot!.setDataAtRowProp(newRowIdx, "produkt", prod.produkt);

            if (rowData.docType === "auftrag") {
              appState.hot!.setDataAtRowProp(newRowIdx, "menge", prod.menge);
              appState.hot!.setDataAtRowProp(
                newRowIdx,
                "waehrung",
                prod.waehrung,
              );
              appState.hot!.setDataAtRowProp(newRowIdx, "preis", prod.preis);
            } else {
              appState.hot!.setDataAtRowProp(
                newRowIdx,
                "gelieferteMenge",
                prod.gelieferteMenge,
              );
              appState.hot!.setDataAtRowProp(
                newRowIdx,
                "nummerRechnung",
                result.nummerRechnung,
              );
              appState.hot!.setDataAtRowProp(newRowIdx, "preis", prod.preis);
            }
          });
        }
      });

      showToast("Analisi completata con successo!", "success");
    } else {
      appState.hot.setDataAtRowProp(
        row,
        "anmerkungen",
        "Nessun prodotto rilevato.",
      );
      showToast("Nessun prodotto riconosciuto.", "info");
    }
  } catch (err) {
    console.error(err);
    appState.hot.setDataAtRowProp(row, "anmerkungen", String(err));
    showToast("Errore nell'analisi.", "error");
  } finally {
    document.body.classList.remove("app-loading");
  }
}

export function setupHeaderCheckbox() {
  if (!appState.hot) return;
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

      appState.hot!.batch(() => {
        const data = appState.hot!.getSourceData() as PdfDataRow[];
        data.forEach((_row, index) => {
          appState.hot!.setDataAtRowProp(index, "confirmed", checked);
        });
      });
      updateHeaderCheckboxState();
    });

    wrapper.appendChild(checkbox);
    th.appendChild(wrapper);
  });

  updateHeaderCheckboxState();
}

function updateHeaderCheckboxState() {
  if (!appState.hot) return;
  const cbs = Array.from(
    document.querySelectorAll(".header-confirmed"),
  ) as HTMLInputElement[];
  if (!cbs || cbs.length === 0) return;

  const data = appState.hot.getSourceData() as PdfDataRow[];
  if (!data || data.length === 0) {
    cbs.forEach((cb) => {
      cb.checked = false;
      cb.indeterminate = false;
    });
    return;
  }

  const confirmedCount = data.reduce(
    (acc, r) => acc + (r.confirmed ? 1 : 0),
    0,
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

function pdfNameRenderer(
  this: Handsontable.Core,
  _instance: Handsontable.Core,
  td: HTMLTableCellElement,
  row: number,
  _col: number,
  _prop: string | number,
  value: Handsontable.CellValue,
  _cellProperties: Handsontable.CellProperties,
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

  const rowData = appState.hot
    ? (appState.hot.getSourceDataAtRow(row) as PdfDataRow)
    : null;
  checkbox.checked = Boolean(rowData && rowData.confirmed);

  checkbox.addEventListener("change", () => {
    const checked = checkbox.checked;
    if (appState.hot) {
      appState.hot.setDataAtRowProp(row, "confirmed", checked);
    }
  });

  wrapper.appendChild(checkbox);
  td.appendChild(wrapper);
}

export async function handleExportExcel() {
  if (!appState.hot || appState.isProcessing) return;

  appState.isProcessing = true;

  const allData = appState.hot.getSourceData() as PdfDataRow[];
  const confirmedData = allData.filter((row) => row.confirmed);

  const pathsToMove = new Set<string>();
  confirmedData.forEach((row) => {
    if (row.fullPath && !row.warnings && row.produkt) {
      pathsToMove.add(row.fullPath);
    }
  });

  if (confirmedData.length === 0) {
    showToast("Nessuna riga confermata per l'esportazione.", "info");
    appState.isProcessing = false;
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
      },
    );

    const msg = await api.exportExcel(
      confirmedData,
      (await appState.store?.get<string>("defaultExcelPath")) || null,
    );

    if (msg !== "Interruzione da parte dell'utente") {
      showToast(msg, "success");

      const processedDir = await appState.store?.get<string>(
        "defaultProcessedPdfPath",
      );
      if (processedDir && pathsToMove.size > 0) {
        try {
          await api.moveFiles(Array.from(pathsToMove), processedDir);
          showToast(`${pathsToMove.size} PDF spostati.`, "success");
        } catch (moveErr) {
          showToast(`Errore durante lo spostamento: ${moveErr}`, "error");
        }
      }
    }

    appState.isProcessing = false;
  } catch (err) {
    console.error(err);
    showToast(`${err}`, "error");
  } finally {
    if (unlisten) unlisten();
    setProgress(0, 0);
    document.body.classList.remove("app-loading");
    appState.isProcessing = false;
  }
}