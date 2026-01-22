import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

import { appState } from "./state";
import { showToast } from "./ui";
import { PdfDataRow } from "../types";

export async function handleSelectFiles() {
  if (appState.isProcessing) return;
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
    appState.selectedPdfPaths = result;
  } else if (result) {
    appState.selectedPdfPaths = [result];
  } else {
    appState.selectedPdfPaths = [];
  }

  updateFileUI();
}

export async function handleSelectFolder() {
  if (appState.isProcessing) return;
  const result = await open({
    title: "Selezionare la cartella PDF",
    directory: true,
    multiple: false,
  });

  if (typeof result === "string") {
    await loadPdfsFromDirectory(result);
  }
}

export async function loadPdfsFromDirectory(path: string) {
  try {
    const entries = await readDir(path);

    const pdfEntries = entries.filter(
      (entry) =>
        entry.name?.toLowerCase().endsWith(".pdf") && !entry.isDirectory
    );

    appState.selectedPdfPaths = await Promise.all(
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

export function updateFileUI() {
  if (!appState.hot) return;

  const currentData = appState.hot.getSourceData() as PdfDataRow[];

  const existingPaths = new Set(
    currentData.map((row) => row.fullPath).filter(Boolean)
  );

  let nextId =
    currentData.length > 0
      ? Math.max(...currentData.map((r) => r.id || 0)) + 1
      : 1;

  const newPaths = appState.selectedPdfPaths.filter(
    (path) => !existingPaths.has(path)
  );

  const duplicatesCount = appState.selectedPdfPaths.length - newPaths.length;

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

  const allData = [...currentData, ...newRows];

  allData.sort((a, b) => {
    const compLieferant = (a.lieferant || "").localeCompare(b.lieferant || "");
    if (compLieferant !== 0) return compLieferant;

    const compOrder = (a.nummerAuftrag || "").localeCompare(
      b.nummerAuftrag || "",
      undefined,
      { numeric: true }
    );
    if (compOrder !== 0) return compOrder;

    const dateA = a.datumAuftrag
      ? a.datumAuftrag.split("/").reverse().join("-")
      : "";
    const dateB = b.datumAuftrag
      ? b.datumAuftrag.split("/").reverse().join("-")
      : "";
    return dateA.localeCompare(dateB);
  });

  appState.hot.loadData(allData);
}

function parseDateStrings(dateString: string) {
  let date;
  if (dateString && dateString.length === 8) {
    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    date = `${day}/${month}/${year}`;
  }
  return date || null;
}
