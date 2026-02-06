import { setupUI } from "./modules/ui";
import { check } from '@tauri-apps/plugin-updater';

document.addEventListener("DOMContentLoaded", async () => {
  setupUI();

  checkForAppUpdates();
});

async function checkForAppUpdates() {
  try {
    const update = await check();
    if (update) {
      console.log(`Update gefunden: ${update.version}`);
    }
  } catch (error) {
    console.error("Update-Check fehlgeschlagen:", error);
  }
}