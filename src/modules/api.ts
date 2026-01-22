import { invoke } from "@tauri-apps/api/core";
import { AiResponse, PdfDataRow } from "../types";
import { appState } from "./state";
import { setProgress, showToast } from "./ui";

export const api = {
  analyzeDocument: (path: string, docType: string) =>
    invoke<AiResponse>("analyze_document", { path, docType }),

  exportExcel: (data: PdfDataRow[], filePath: string | null) =>
    invoke<string>("export_to_excel", { data, filePath }),

  checkExcelAccess: (path: string) =>
    invoke<boolean>("check_excel_access", { path }),

  moveFiles: (paths: string[], targetDir: string) =>
    invoke("move_files", { paths, targetDir }),

  getCorrections: () => invoke<Record<string, string>>("get_corrections"),

  learnCorrection: (wrong: string, correct: string) =>
    invoke("learn_correction", { wrong, correct }),

  removeCorrection: (wrong: string) => invoke("remove_correction", { wrong }),

  saveApiKey: (key: string) => invoke("save_api_key", { key }),

  getApiKey: () => invoke<string>("get_api_key"),
};

export async function handleReseachStart() {
  if (!appState.hot || appState.isProcessing) return;

  const startBtn = document.querySelector(
    "#start-process-btn"
  ) as HTMLButtonElement;
  appState.isProcessing = true;
  if (startBtn) startBtn.disabled = true;
  document.body.classList.add("app-loading");

  try {
    const concurrencyLimit =
      (await appState.store?.get<number>("concurrencyLimit").catch(() => 2)) ||
      5;

    const data = appState.hot.getSourceData() as PdfDataRow[];

    const tasks = data
      .map((row, index) => ({ row, index }))
      .filter((item) => item.row.fullPath);

    const totalTasks = tasks.length;
    let completedCount = 0;
    setProgress(0, totalTasks);

    const aiResults: any[] = new Array(data.length).fill(null);
    let cursor = 0;

    const worker = async (workerId: number) => {
      while (cursor < tasks.length) {
        if (appState.controller && appState.controller.signal.aborted) return;

        const taskIndex = cursor++;
        const task = tasks[taskIndex];

        if (!task) break;

        try {
          if (completedCount < concurrencyLimit) {
            await new Promise((r) => setTimeout(r, workerId * 200));
          }

          const result = await invoke<AiResponse>("analyze_document", {
            path: task.row.fullPath,
            docType: task.row.docType,
          });

          aiResults[task.index] = {
            index: task.index,
            row: task.row,
            docType: task.row.docType,
            result,
          };
        } catch (err) {
          console.error(`Fehler bei Zeile ${task.index}:`, err);
          appState.hot!.setDataAtRowProp(
            task.index,
            "anmerkungen",
            String(err)
          );
          aiResults[task.index] = {
            index: task.index,
            row: task.row,
            docType: task.row.docType,
            result: {} as AiResponse,
          };
        } finally {
          completedCount++;
          setProgress(completedCount, totalTasks);
        }
      }
    };

    const workers = Array.from({ length: concurrencyLimit }, (_, i) =>
      worker(i)
    );
    await Promise.all(workers);

    const newTableData: PdfDataRow[] = [];

    data.forEach((originalRow, rowIndex) => {
      const processedItem = aiResults[rowIndex];

      if (processedItem && processedItem.result) {
        const aiResult = processedItem.result;
        const products = aiResult.produkte;
        const docType = processedItem.docType;

        if (products && Array.isArray(products) && products.length > 0) {
          products.forEach((prod: any, prodIndex: number) => {
            const newRow: PdfDataRow = { ...originalRow };

            if (prodIndex > 0) {
              newRow.pdfName = "";
              newRow.fullPath = "";
              newRow.confirmed = false;
              newRow.warnings = originalRow.warnings || false;
            }

            newRow.produkt = prod.produkt;

            if (docType === "auftrag") {
              newRow.menge = prod.menge;
              newRow.waehrung = prod.waehrung;
              newRow.preis = prod.preis;
            } else {
              newRow.gelieferteMenge = prod.gelieferteMenge;
              newRow.nummerRechnung = aiResult.nummerRechnung;
              newRow.preis = prod.preis;
            }

            newTableData.push(newRow);
          });
        } else {
          const errorRow = { ...originalRow };
          errorRow.warnings = true;
          if (!errorRow.anmerkungen) {
            errorRow.anmerkungen = aiResult
              ? "Nessun prodotto riconosciuto."
              : "Errore: KI non ha risposto.";
          }
          newTableData.push(errorRow);
        }
      } else {
        newTableData.push(originalRow);
      }
    });

    appState.hot.loadData(newTableData);
    appState.hot.render();
    appState.hot.updateSettings({ allowInsertRow: true });
    requestAnimationFrame(() => {
      appState.hot!.refreshDimensions();
    });
  } catch (error) {
    console.error("Errore critico:", error);
    showToast(`Errore: ${error}`, "error");
  } finally {
    appState.isProcessing = false;
    document.body.classList.remove("app-loading");
    const startBtn = document.querySelector(
      "#start-process-btn"
    ) as HTMLButtonElement;
    if (startBtn) startBtn.disabled = false;
  }
}
