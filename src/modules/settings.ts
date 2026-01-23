import { handleSelectFiles, handleSelectFolder } from "./file-manager";
import { toggleTheme } from "./ui";
import { api } from "./api";

export async function loadAndRenderCorrections() {
  const listEl = document.getElementById("corrections-list");
  if (!listEl) return;

  try {
    const corrections = await api.getCorrections();

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
          await api.removeCorrection(wrong);
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
  themeToggle.addEventListener("change", () => toggleTheme());
  toggleTheme();
}
