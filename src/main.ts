// In src/main.ts
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'

// Hält die Liste der Dateipfade
let selectedPdfPaths: string[] = []

// DOM-Elemente holen, wenn das Fenster geladen ist
document.addEventListener('DOMContentLoaded', () => {
  const selectFilesBtn = document.querySelector('#select-files-btn')
  const selectFolderBtn = document.querySelector('#select-folder-btn')

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', handleSelectFiles)
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', handleSelectFolder)
  }
})

/**
 * Öffnet den Dialog zur Auswahl von EINER oder MEHREREN PDF-Dateien
 */
async function handleSelectFiles() {
  const result = await open({
    title: 'PDF-Dateien auswählen',
    multiple: true,
    filters: [{
      name: 'PDF',
      extensions: ['pdf']
    }]
  })

  if (Array.isArray(result)) {
    // Wenn mehrere Dateien ausgewählt wurden (string[])
    selectedPdfPaths = result
  } else if (result) {
    // Wenn nur eine Datei ausgewählt wurde (string)
    selectedPdfPaths = [result]
  } else {
    // Dialog wurde abgebrochen (null)
    selectedPdfPaths = []
  }

  updateFileListUI()
}

/**
 * Öffnet den Dialog zur Auswahl eines ORDNERs und liest PDFs darin
 */
async function handleSelectFolder() {
  const result = await open({
    title: 'PDF-Ordner auswählen',
    directory: true, // WICHTIG: Schaltet in den Ordner-Modus
    multiple: false
  })

  if (typeof result === 'string') {
    // result ist der Pfad zum Ordner
    try {
      const entries = await readDir(result)

      // 1. Nur die relevanten PDF-Einträge filtern
      const pdfEntries = entries.filter(
        entry => entry.name?.endsWith('.pdf') && !entry.isDirectory
      )

      // 2. Die Pfade asynchron zusammensetzen
      selectedPdfPaths = await Promise.all(
        pdfEntries.map(entry => join(result, entry.name!)) // '!' ist sicher, da wir null-Namen gefiltert haben
      )

    } catch (e) {
      console.error("Fehler beim Lesen des Ordners:", e)
      selectedPdfPaths = []
    }

  } else {
    // Dialog wurde abgebrochen
    selectedPdfPaths = []
  }

  updateFileListUI()
}

/**
 * Zeigt die ausgewählten Dateinamen in der HTML-Liste an
 */
function updateFileListUI() {
  const fileList = document.querySelector('#file-list')
  if (!fileList) return

  // Liste leeren
  fileList.innerHTML = ''

  // Liste füllen (nur Dateiname, nicht den ganzen Pfad)
  for (const path of selectedPdfPaths) {
    const li = document.createElement('li')
    // Extrahiert den Dateinamen aus dem Pfad
    li.textContent = path.split('\\').pop()?.split('/').pop() ?? 'Unbekannte Datei'
    fileList.appendChild(li)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.sliding-nav') as HTMLElement
  const buttons = Array.from(
    nav.querySelectorAll('button')
  ) as HTMLElement[]

  if (!nav) return

  function updateUnderlinePosition() {
    const activeButton = nav.querySelector('button.active') as HTMLElement
    if (!activeButton) return

    const left = activeButton.offsetLeft
    const width = activeButton.offsetWidth

    nav.style.setProperty('--underline-left', `${left}px`)
    nav.style.setProperty('--underline-width', `${width}px`)
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('active'))
      button.classList.add('active')
      updateUnderlinePosition()
    })
  })

  updateUnderlinePosition()
})