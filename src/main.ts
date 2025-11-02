/**
 * Main application file for the PDF data management tool.
 * This file handles PDF file selection, folder browsing, and data table management.
 *
 * Key Features:
 * - PDF file selection via file dialog
 * - Folder browsing with PDF filtering
 * - Interactive data table with Handsontable
 * - PDF file opening functionality
 *
 * Dependencies:
 * - @tauri-apps/plugin-dialog for file/folder selection
 * - @tauri-apps/plugin-fs for filesystem operations
 * - @tauri-apps/api/path for path manipulation
 * - @tauri-apps/plugin-opener for opening files
 * - Handsontable for data grid functionality
 */

import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import Handsontable from 'handsontable'
import { openPath } from '@tauri-apps/plugin-opener';

import 'handsontable/styles/handsontable.min.css';
import 'handsontable/styles/ht-theme-main.min.css';

/**
 * Interface representing a row of PDF data in the table
 * Contains all possible fields for both Aufträge and Rechnungen modes
 */
interface PdfDataRow {
  pdfName: string
  fullPath: string
  // Aufträge fields
  datumAuftrag?: string | null
  nummerAuftrag?: string | null
  kunde?: string | null
  lieferant?: string | null
  produkt?: string | null
  menge?: number | null
  waehrung?: string | null
  preis?: number | null
  // Rechnungen fields
  datumRechnung?: string | null
  nummerRechnung?: string | null
  gelieferteMenge?: number | null
}

/**
 * Type definition for available modes
 */
type AppMode = 'auftraege' | 'rechnungen'

/**
 * Current active mode
 */
let currentMode: AppMode = 'auftraege'

/**
 * Array storing paths of selected PDF files
 */
let selectedPdfPaths: string[] = []

/**
 * Initialize event listeners when DOM content is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  const selectFilesBtn = document.querySelector('#select-files-btn')
  const selectFolderBtn = document.querySelector('#select-folder-btn')
  const themeToggle = document.querySelector('#theme-toggle-input') as HTMLInputElement

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', handleSelectFiles)
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', handleSelectFolder)
  }

  if (themeToggle) {
    // Improve accessibility and ensure the visual switch styles are in sync
    themeToggle.setAttribute('role', 'switch')
    themeToggle.setAttribute('aria-checked', String(themeToggle.checked))
    themeToggle.addEventListener('change', toggleTheme)
    // Ensure the UI and document theme reflect the current toggle state on load
    toggleTheme()
  }
})

/**
 * Handle PDF file selection via file dialog
 */
async function handleSelectFiles() {
  const result = await open({
    title: 'Selezionare i file PDF',
    multiple: true,
    filters: [{
      name: 'PDF',
      extensions: ['pdf']
    }]
  })

  if (Array.isArray(result)) {
    selectedPdfPaths = result
  } else if (result) {
    selectedPdfPaths = [result]
  } else {
    selectedPdfPaths = []
  }

  updateFileUI()
}

/**
 * Handle folder selection and filter PDF files
 */
async function handleSelectFolder() {
  const result = await open({
    title: 'Selezionare la cartella PDF',
    directory: true,
    multiple: false
  })

  if (typeof result === 'string') {
    try {
      const entries = await readDir(result)

      const pdfEntries = entries.filter(
        entry => entry.name?.toLowerCase().endsWith('.pdf') && !entry.isDirectory
      )

      selectedPdfPaths = await Promise.all(
        pdfEntries.map(entry => join(result, entry.name!))
      )

    } catch (e) {
      console.error("Fehler beim Lesen des Ordners:", e)
      selectedPdfPaths = []
    }

  } else {
    selectedPdfPaths = []
  }

  updateFileUI()
}

/**
 * Update the file UI with selected PDF data
 */
function updateFileUI() {
  if (!hot) return

  const tableData: PdfDataRow[] = selectedPdfPaths.map(path => {
    const lastSeparatorIndex = Math.max(
      path.lastIndexOf('/'),
      path.lastIndexOf('\\')
    )
    const fileName = path.substring(lastSeparatorIndex + 1)

    return {
      pdfName: fileName,
      fullPath: path
    }
  })

  hot.loadData(tableData)
}

/**
 * Initialize navigation button event listeners
 */
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

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('active'))
      button.classList.add('active')
      updateUnderlinePosition()

      // Switch mode based on button index
      const newMode: AppMode = index === 0 ? 'auftraege' : 'rechnungen'
      if (currentMode !== newMode) {
        currentMode = newMode
        updateTableConfiguration()
      }
    })
  })

  updateUnderlinePosition()
})

/**
 * Get column headers based on current mode
 */
function getColumnHeaders(mode: AppMode): string[] {
  if (mode === 'auftraege') {
    return [
      'File PDF',
      "Data",
      'N°',
      'Cliente',
      'Casa Estera',
      'Prodotto',
      'kg/pz.',
      'Val.',
      'Prezzo kg/z.'
    ]
  } else {
    return [
      'File PDF',
      'Data fattura Casa rapp.',
      'N° fattura Casa rapp.',
      'kg/pz.'
    ]
  }
}

/**
 * Get column configuration based on current mode
 */
function getColumnConfig(mode: AppMode): Handsontable.ColumnSettings[] {
  if (mode === 'auftraege') {
    return [
      { data: 'pdfName', readOnly: true, className: 'htEllipsis htLink' },
      { data: 'datumAuftrag', type: 'date', dateFormat: 'YYYY-MM-DD' },
      { data: 'nummerAuftrag' },
      { data: 'kunde' },
      { data: 'lieferant' },
      { data: 'produkt' },
      { data: 'menge', type: 'numeric' },
      { data: 'waehrung' },
      { data: 'preis', type: 'numeric', numericFormat: { pattern: '0.00 €' } }
    ]
  } else {
    return [
      { data: 'pdfName', readOnly: true, className: 'htEllipsis htLink' },
      { data: 'datumRechnung', type: 'date', dateFormat: 'YYYY-MM-DD' },
      { data: 'nummerRechnung' },
      { data: 'gelieferteMenge', type: 'numeric' }
    ]
  }
}

/**
 * Update table configuration based on current mode
 */
function updateTableConfiguration() {
  if (!hot) return

  const currentData = hot.getSourceData() as PdfDataRow[]

  hot.updateSettings({
    colHeaders: getColumnHeaders(currentMode),
    columns: getColumnConfig(currentMode)
  })

  // Reload data to ensure all rows are properly formatted
  if (currentData.length > 0) {
    hot.loadData(currentData)
  }
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
  Handsontable.renderers.TextRenderer.apply(this, arguments as any)

  if (value !== null && value !== undefined) {
    td.title = String(value)
  }
}

/**
 * Handsontable instance for data grid
 */
let hot: Handsontable | null = null

/**
 * Initialize Handsontable data grid
 */
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('#data-grid')
  if (!container) return

  hot = new Handsontable(container, {
    data: [],
    colHeaders: getColumnHeaders(currentMode),
    className: 'htEllipsis',
    renderer: ellipsisRenderer,
    columns: getColumnConfig(currentMode),

    async afterOnCellMouseDown(_event, coords) {
      if (coords.col === 0 && hot) {
        const rowData = hot.getSourceDataAtRow(coords.row) as PdfDataRow
        if (rowData && rowData.fullPath) {
          await openPath(rowData.fullPath)
        }
      }
    },

    minSpareRows: 0,
    rowHeaders: false,
    stretchH: 'all',
    autoColumnSize: false,
    themeName: 'ht-theme-main-dark-auto',
    licenseKey: 'non-commercial-and-evaluation'
  })

  // Update Handsontable theme when global theme changes
  const themeToggle = document.querySelector('#theme-toggle-input') as HTMLInputElement
  if (themeToggle) {
    themeToggle.addEventListener('change', () => {
      if (hot) {
        const theme = themeToggle.checked ? 'light' : 'dark'
        hot.updateSettings({
          themeName: theme === 'light' ? 'ht-theme-main-light-auto' : 'ht-theme-main-dark-auto'
        })
      }
    })
  }
})

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const themeToggle = document.querySelector('#theme-toggle-input') as HTMLInputElement
  const themeLabel = document.querySelector('.theme-toggle-label') as HTMLElement | null
  if (!themeToggle) return

  const isChecked = themeToggle.checked
  const theme = isChecked ? 'light' : 'dark'

  // Apply theme to the document
  document.documentElement.setAttribute('data-theme', theme)

  // Accessibility: keep ARIA attributes in sync
  themeToggle.setAttribute('aria-checked', String(isChecked))
  if (themeLabel) {
    themeLabel.setAttribute('aria-pressed', String(isChecked))
  }

  // If Handsontable is already initialized, update its theme immediately
  if (hot) {
    hot.updateSettings({
      themeName: isChecked ? 'ht-theme-main-light-auto' : 'ht-theme-main-dark-auto'
    })
  }
}
