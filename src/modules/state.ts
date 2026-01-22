import { Store } from "@tauri-apps/plugin-store";
import Handsontable from "handsontable";

interface AppState {
  selectedPdfPaths: string[];
  controller: AbortController | null;
  store: Store | null;
  isProcessing: boolean;
  hot: Handsontable | null;
}

export const appState: AppState = {
  selectedPdfPaths: [],
  controller: null,
  store: null,
  isProcessing: false,
  hot: null,
};
