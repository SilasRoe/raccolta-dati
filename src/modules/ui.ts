import { handleReseachStart, api } from "./api";
import {
  handleSelectFiles,
  handleSelectFolder,
  loadPdfsFromDirectory,
  updateFileUI,
} from "./file-manager";
import { appState } from "./state";
import { loadAndRenderCorrections } from "./settings";
import { createGrid, setupHeaderCheckbox, handleExportExcel } from "./grid";

import { Store } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { open, ask } from "@tauri-apps/plugin-dialog";

async function checkForAppUpdates() {
  try {
    const update = await check();
    if (update && update.available) {
      console.log(`Aggiornamento disponibile alla versione ${update.version}!`);
      const yes = await ask(
        `Una nuova versione (${update.version}) è disponibile!\n\nVuoi scaricarla e installarla ora?\n\nNote di rilascio:\n${update.body}`,
        {
          title: 'Update disponibile',
          kind: 'info',
          okLabel: 'Sì, aggiornamento',
          cancelLabel: 'Più tardi'
        }
      );

      if (yes) {
        await update.downloadAndInstall();
      }
    }
  } catch (error) {
    console.error("Errore durante il controllo degli aggiornamenti:", error);
  }
}

export async function setupUI() {
  api.setTaskbarProgress(0, 0).catch(() => { });

  checkForAppUpdates();

  const container = document.querySelector("#data-grid");
  if (!container) return;

  appState.hot = createGrid(container);

  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  requestAnimationFrame(() => setupHeaderCheckbox());

  const observerRes = new ResizeObserver(() => {
    if (appState.hot) {
      appState.hot.refreshDimensions();
    }
  });

  observerRes.observe(container);

  setTimeout(() => {
    if (appState.hot) {
      appState.hot.refreshDimensions();
    }
  }, 200);

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
    appState.store = await Store.load("settings.json");
  } catch (err) {
    console.warn("settings.json non trovato, crea nuovo archivio:", err);
    await appState.store?.save();
    appState.store = await Store.load("settings.json");
  }

  setupProgressBar();

  const startProcessBtn = document.querySelector(
    "#start-process-btn",
  ) as HTMLButtonElement;
  if (startProcessBtn) {
    startProcessBtn.addEventListener("click", handleStartProcess);
  }

  function handleStartProcess() { }

  function updateStartProcessButtonState() {
    const startProcessBtn = document.querySelector(
      "#start-process-btn",
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
    "#select-files-btn",
  ) as HTMLButtonElement;
  const selectFolderBtn = document.querySelector(
    "#select-folder-btn",
  ) as HTMLButtonElement;
  const startResearchBtn = document.querySelector(
    "#start-process-btn",
  ) as HTMLButtonElement;
  const themeToggle = document.querySelector(
    "#theme-toggle-input",
  ) as HTMLInputElement;

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener("click", handleSelectFiles);
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener("click", handleSelectFolder);
  }
  if (startResearchBtn) {
    appState.controller = new AbortController();
    const signal = appState.controller.signal;
    startResearchBtn.addEventListener(
      "click",
      () => {
        handleReseachStart();
      },
      { signal: signal },
    );
  }

  if (themeToggle) {
    themeToggle.setAttribute("role", "switch");
    themeToggle.setAttribute("aria-checked", String(themeToggle.checked));
    themeToggle.addEventListener("change", () => toggleTheme());
    toggleTheme();
  }

  const settingsModal = document.getElementById("settings-modal");
  const settingsBtn = document.getElementById("settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");

  const apiKeyInput = document.getElementById(
    "setting-api-key",
  ) as HTMLInputElement;
  const pdfPathInput = document.getElementById(
    "setting-pdf-path",
  ) as HTMLInputElement;
  const excelPathInput = document.getElementById(
    "setting-excel-path",
  ) as HTMLInputElement;
  const processedPathInput = document.getElementById(
    "setting-processed-pdf-path",
  ) as HTMLInputElement;
  const moveToggle = document.getElementById("setting-file-action") as HTMLInputElement;
  const openToggle = document.getElementById("setting-auto-open") as HTMLInputElement;

  const toggleApiKeyBtn = document.getElementById("toggle-api-key-btn");

  if (toggleApiKeyBtn) {
    toggleApiKeyBtn.addEventListener("click", (e) => {
      e.preventDefault();

      const apiKeyInput = document.getElementById(
        "setting-api-key",
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

      if (typeof selected === "string") {
        showToast("Verifico l'accesso al file...", "info");
        try {
          await api.checkExcelAccess(selected);

          excelPathInput.value = selected;
          showToast("File accessibile!", "success");
        } catch (e) {
          console.error(e);
          showToast(`Accesso negato: ${e}. Chiudi il file Excel!`, "error");
        }
      }
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
        api.getApiKey().catch((err) => {
          console.warn(
            "Impossibile caricare la chiave API (forse al primo avvio):",
            err,
          );
          return "";
        }),
        appState.store?.get("defaultPdfPath").catch(() => null),
        appState.store?.get("defaultExcelPath").catch(() => null),
        appState.store?.get("defaultProcessedPdfPath").catch(() => null),
        appState.store?.get("defaultTheme").catch(() => null),
      ]);

    const shouldMove = await appState.store?.get<boolean>("moveFilesEnabled");
    const autoOpen = await appState.store?.get<boolean>("autoOpenExcel");
    const isMove = shouldMove !== false;
    const isAutoOpen = autoOpen === true;

    const storedConcurrency =
      await appState.store?.get<number>("concurrencyLimit");

    const val =
      storedConcurrency !== null && storedConcurrency !== undefined
        ? Number(storedConcurrency)
        : 5;

    if (apiKeyInput) apiKeyInput.value = apiKey || "";
    if (pdfPathInput) pdfPathInput.value = (pdfPath as string) || "";
    if (excelPathInput) excelPathInput.value = (excelPath as string) || "";
    if (processedPathInput)
      processedPathInput.value = (processedPath as string) || "";
    if (theme) themeToggle.checked = theme === "light";
    if (moveToggle) moveToggle.checked = isMove;
    if (openToggle) openToggle.checked = isAutoOpen;
    const concurrencySlider = document.getElementById(
      "setting-concurrency",
    ) as HTMLInputElement;
    const concurrencyDisplay = document.getElementById("concurrency-value");
    if (concurrencySlider && concurrencyDisplay) {
      concurrencySlider.value = String(val);

      const updateLabel = () => {
        if (concurrencySlider.value === "0") {
          concurrencyDisplay.textContent = "Frammentato";
          concurrencyDisplay.style.fontSize = "1em";
        } else {
          concurrencyDisplay.textContent = concurrencySlider.value;
          concurrencyDisplay.style.fontSize = `${1.1 + parseInt(concurrencySlider.value) / 66}em`;
        }
      };

      updateLabel();

      concurrencySlider.oninput = updateLabel;
    }

    loadAndRenderCorrections();

    settingsModal!.style.display = "flex";
  });

  closeSettingsBtn?.addEventListener("click", () => {
    settingsModal!.style.display = "none";
  });

  const reloadBtn = document.getElementById("reload-btn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }

  saveSettingsBtn?.addEventListener("click", async () => {
    try {
      await api.saveApiKey(apiKeyInput.value);

      await appState.store?.set("defaultPdfPath", pdfPathInput.value);
      await appState.store?.set("defaultExcelPath", excelPathInput.value);
      await appState.store?.set(
        "defaultProcessedPdfPath",
        processedPathInput.value,
      );
      const newTheme = themeToggle.checked ? "light" : "dark";
      await appState.store?.set("defaultTheme", newTheme);
      const concurrencySlider = document.getElementById(
        "setting-concurrency",
      ) as HTMLInputElement;
      if (concurrencySlider) {
        await appState.store?.set(
          "concurrencyLimit",
          parseInt(concurrencySlider.value, 10),
        );
      }
      const moveToggle = document.getElementById("setting-file-action") as HTMLInputElement;
      const openToggle = document.getElementById("setting-auto-open") as HTMLInputElement;
      if (moveToggle) {
        await appState.store?.set("moveFilesEnabled", moveToggle.checked);
      }
      if (openToggle) {
        await appState.store?.set("autoOpenExcel", openToggle.checked);
      }

      await appState.store?.save();

      document.documentElement.setAttribute("data-theme", newTheme);

      settingsModal!.style.display = "none";
      if (reloadBtn) {
        reloadBtn.style.display = "inline-flex";
        reloadBtn.style.animation = "pulse-green 0.5s infinite";
      }
      showToast(
        "Impostazioni salvate. Ricarica la pagina per applicare",
        "success",
      );
    } catch (err) {
      console.error("Errore durante il salvataggio:", err);
      showToast(`Errore durante il salvataggio: ${err}`, "error");
    }
  });

  appState.store?.get<string>("defaultTheme").then((theme) => {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
      const toggle = document.getElementById(
        "theme-toggle-input",
      ) as HTMLInputElement;
      if (toggle) toggle.checked = theme === "light";
    }
  });

  appState.store?.get<string>("defaultPdfPath").then((path) => {
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

      appState.selectedPdfPaths.push(...pdfs);

      updateFileUI();

      showToast(
        `${pdfs.length} Ricezione di file tramite drag & drop.`,
        "success",
      );
    }
  });
}

export function showToast(
  text: string,
  type: "success" | "error" | "info" = "info",
) {
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
  }, 7500);
}

export function setupProgressBar() {
  if (!document.getElementById("progress-container")) {
    const container = document.createElement("div");
    container.id = "progress-container";
    const bar = document.createElement("div");
    bar.id = "progress-bar";
    container.appendChild(bar);
    document.body.appendChild(container);
  }
}

export function setProgress(current: number, total: number) {
  api.setTaskbarProgress(current, total).catch(() => { });

  const headerText = document.getElementById("header-progress-text");
  const container = document.getElementById("progress-container");
  const bar = document.getElementById("progress-bar");

  if (total <= 0) {
    if (headerText) {
      headerText.style.display = "none";
      headerText.textContent = "";
    }
    if (container) container.style.display = "none";
    return;
  }

  if (headerText) {
    headerText.style.display = "inline-block";
    headerText.textContent = `${current} / ${total}`;
  }

  if (container && bar) {
    container.style.display = "block";
    let percent = (current / total) * 100;
    if (current === 0 && total > 0) {
      percent = 1;
    } else if (current > 0) {
      percent = 1 + (current / total) * 99;
    }
    bar.style.width = `${percent}%`;

    if (current >= total) {
      setTimeout(() => {
        container.style.display = "none";
        if (headerText) headerText.style.display = "none";
        api.setTaskbarProgress(0, 0).catch(() => { });
      }, 3000);
    }
  }
}

export function toggleTheme(forceTheme?: "light" | "dark") {
  const themeToggle = document.querySelector(
    "#theme-toggle-input",
  ) as HTMLInputElement;
  if (!themeToggle && !forceTheme) return;

  const isChecked = forceTheme ? forceTheme === "light" : themeToggle.checked;
  const theme = isChecked ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", theme);

  if (themeToggle) {
    themeToggle.checked = isChecked;
    themeToggle.setAttribute("aria-checked", String(isChecked));
  }
}
