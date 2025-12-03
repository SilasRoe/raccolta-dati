import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import Handsontable from 'handsontable'
import { openPath } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'

import 'handsontable/styles/handsontable.min.css'
import 'handsontable/styles/ht-theme-main.min.css'

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
  // Freitext für Anmerkungen
  anmerkungen?: string | null
  // Bestätigungsflag für die gesamte Zeile
  confirmed?: boolean | null
}
interface AiResponse {
  produkt?: string | null
  menge?: number | null
  waehrung?: string | null
  preis?: number | null
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
  const startProcessBtn = document.querySelector('#start-process-btn') as HTMLButtonElement;
  if (startProcessBtn) {
    startProcessBtn.addEventListener('click', handleStartProcess);
  }

  function handleStartProcess() {

  }

  function updateStartProcessButtonState() {
    const startProcessBtn = document.querySelector('#start-process-btn') as HTMLButtonElement;
    if (startProcessBtn) {
      const isTableFilled = document.querySelector('#data-grid table tbody tr td:first-child') !== null;
      startProcessBtn.disabled = !isTableFilled;
    }
  }

  // Call the function to set the initial state of the button
  updateStartProcessButtonState();

  // Add event listener to update the button state when the table content changes
  const dataGrid = document.querySelector('#data-grid') as HTMLElement;
  const observer = new MutationObserver(() => {
    updateStartProcessButtonState();
  });
  observer.observe(dataGrid, { childList: true, subtree: true });

  const selectFilesBtn = document.querySelector('#select-files-btn') as HTMLButtonElement;
  const selectFolderBtn = document.querySelector('#select-folder-btn') as HTMLButtonElement;
  const startResearchBtn = document.querySelector('#start-process-btn') as HTMLButtonElement;
  const themeToggle = document.querySelector('#theme-toggle-input') as HTMLInputElement;

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', handleSelectFiles);
  }
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', handleSelectFolder);
  }
  if (startResearchBtn) {
    startResearchBtn.addEventListener('click', () => handleReseachStart('asdf'));
  }

  if (themeToggle) {
    // Improve accessibility and ensure the visual switch styles are in sync
    themeToggle.setAttribute('role', 'switch');
    themeToggle.setAttribute('aria-checked', String(themeToggle.checked));
    themeToggle.addEventListener('change', toggleTheme);
    // Ensure the UI and document theme reflect the current toggle state on load
    toggleTheme();
  }
});

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

  updateFileUIAufträge()
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

  updateFileUIAufträge()
}

async function handleReseachStart(prompt: String) {
  try {
    // Ruft die Rust-Funktion 'ask_mistral' auf
    const result = await invoke<AiResponse>('ask_mistral', {
      prompt: prompt
    })

    console.log('Antwort aus Rust:', result)

  } catch (error) {
    console.error('Fehler im Backend:', error)
  }
}

function parseDateStrings(dateString: string) {
  let date
  if (dateString && dateString.length === 8) {
    const year = dateString.substring(0, 4)
    const month = dateString.substring(4, 6)
    const day = dateString.substring(6, 8)
    date = `${day}.${month}.${year}`
  }
  return date || null
}

/**
 * Update the file UI with selected PDF data
 */
function updateFileUIAufträge() {
  if (!hot) return

  const tableData: PdfDataRow[] = selectedPdfPaths.map(path => {
    const lastSeparatorIndex = Math.max(
      path.lastIndexOf('/'),
      path.lastIndexOf('\\')
    )
    const fileName = path.substring(lastSeparatorIndex + 1).split('.pdf')[0].split('.PDF')[0]
    const datumAuftrag = parseDateStrings(fileName.split('_')[1])
    const nummerAuftrag = fileName.split('_')[0] || null
    const kunde = fileName.split('_')[2].split('-')[1] || null
    const lieferant = fileName.split('_')[2].split('-')[0] || null

    return {
      pdfName: fileName,
      fullPath: path,
      datumAuftrag: datumAuftrag,
      nummerAuftrag: nummerAuftrag,
      kunde: kunde,
      lieferant: lieferant,
      confirmed: false,
      anmerkungen: ''
    }
  })

  hot.loadData(tableData)
  // Ensure header checkbox state is correct after loading new data
  updateHeaderCheckboxState()
  // Apply row classes for any pre-confirmed rows
  const current = hot.getSourceData() as PdfDataRow[]
  for (let i = 0; i < current.length; i++) {
    applyRowConfirmedClass(i, Boolean(current[i].confirmed))
  }
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
      'Prezzo kg/z.',
      'Note'
    ]
  } else {
    return [
      'File PDF',
      'Data fattura Casa rapp.',
      'N° fattura Casa rapp.',
      'kg/pz.',
      'Note'
    ]
  }
}

/**
 * Renderer for the PDF name column that places the filename (left) and a checkbox (right).
 * The checkbox stays in sync with the row's `confirmed` property.
 */
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
  // Keep base text rendering (for things like selection styling)
  Handsontable.renderers.TextRenderer.apply(this, arguments as any)

  // Ensure tooltip/title for full value
  if (value !== null && value !== undefined) td.title = String(value)

  td.classList.add('pdf-with-checkbox')
  td.innerHTML = ''

  const wrapper = document.createElement('div')
  wrapper.className = 'pdf-cell-inner'

  const span = document.createElement('span')
  span.className = 'pdf-cell-text'
  span.textContent = value !== null && value !== undefined ? String(value) : ''
  span.title = span.textContent || ''
  wrapper.appendChild(span)

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'row-confirm-checkbox'

  const rowData = hot ? (hot.getSourceDataAtRow(row) as PdfDataRow) : null
  checkbox.checked = Boolean(rowData && rowData.confirmed)

  checkbox.addEventListener('change', () => {
    const checked = checkbox.checked
    if (hot) {
      hot.setDataAtRowProp(row, 'confirmed', checked)
      applyRowConfirmedClass(row, checked)
      hot.render()
      updateHeaderCheckboxState()
    }
  })

  wrapper.appendChild(checkbox)
  td.appendChild(wrapper)
}

/**
 * Get column configuration based on current mode
 */
function getColumnConfig(mode: AppMode): Handsontable.ColumnSettings[] {
  if (mode === 'auftraege') {
    return [
      { data: 'pdfName', readOnly: true, className: 'htEllipsis htLink pdf-with-checkbox', renderer: pdfNameRenderer },
      { data: 'datumAuftrag', type: 'date', dateFormat: 'DD.MM.YYYY', dateFormats: ['DD.MM.YYYY'], correctFormat: true },
      { data: 'nummerAuftrag' },
      { data: 'kunde' },
      { data: 'lieferant' },
      { data: 'produkt' },
      { data: 'menge', type: 'numeric' },
      { data: 'waehrung' },
      { data: 'preis', type: 'numeric', numericFormat: { pattern: '0.00 €' } },
      { data: 'anmerkungen', type: 'text' }
    ]
  } else {
    return [
      { data: 'pdfName', readOnly: true, className: 'htEllipsis htLink pdf-with-checkbox', renderer: pdfNameRenderer },
      { data: 'datumRechnung', type: 'date', dateFormat: 'DD.MM.YYYY', dateFormats: ['DD.MM.YYYY'], correctFormat: true },
      { data: 'nummerRechnung' },
      { data: 'gelieferteMenge', type: 'numeric' },
      { data: 'anmerkungen', type: 'text' }
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
  // Re-inject header checkbox after settings change (header DOM may be re-rendered)
  setTimeout(() => setupHeaderCheckbox(), 0)
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
 * Update the header checkbox state (checked / indeterminate) based on row data
 */
function updateHeaderCheckboxState() {
  if (!hot) return
  const cbs = Array.from(document.querySelectorAll('.header-confirmed')) as HTMLInputElement[]
  if (!cbs || cbs.length === 0) return

  const data = hot.getSourceData() as PdfDataRow[]
  if (!data || data.length === 0) {
    cbs.forEach(cb => {
      cb.checked = false
      cb.indeterminate = false
    })
    return
  }

  const confirmedCount = data.reduce((acc, r) => acc + (r.confirmed ? 1 : 0), 0)
  if (confirmedCount === 0) {
    cbs.forEach(cb => { cb.checked = false; cb.indeterminate = false })
  } else if (confirmedCount === data.length) {
    cbs.forEach(cb => { cb.checked = true; cb.indeterminate = false })
  } else {
    cbs.forEach(cb => { cb.checked = false; cb.indeterminate = true })
  }
}

/**
 * Apply or remove the confirmed-row class for all cells in a given row
 */
function applyRowConfirmedClass(row: number, confirmed: boolean) {
  if (!hot) return
  const colCount = hot.countCols()
  for (let col = 0; col < colCount; col++) {
    try {
      const meta = (hot as any).getCellMeta(row, col) || {}
      const existing = String(meta.className || '').split(/\s+/).filter(Boolean)

      if (confirmed) {
        if (!existing.includes('confirmed-row')) existing.push('confirmed-row')
      } else {
        // remove confirmed-row but keep other classes
        const idx = existing.indexOf('confirmed-row')
        if (idx >= 0) existing.splice(idx, 1)
      }

      if (existing.length > 0) {
        (hot as any).setCellMeta(row, col, 'className', existing.join(' '))
      } else {
        (hot as any).setCellMeta(row, col, 'className', undefined)
      }
    } catch (e) {
      // ignore out-of-range errors during init
    }
  }
}

/**
 * Injects a checkbox into the header cell at index 1 and wires its behaviour
 */
function setupHeaderCheckbox() {
  if (!hot) return
  const container = document.querySelector('#data-grid') as HTMLElement | null
  if (!container) return

  // Handsontable renders header clones; attempt to find both top and master header cells
  const selectors = [
    '.ht_clone_top .htCore thead th:nth-child(1)',
    '.ht_master .htCore thead th:nth-child(1)',
    '#data-grid thead th:nth-child(1)'
  ]

  const headerCells: HTMLElement[] = []
  for (const s of selectors) {
    const el = container.querySelector(s) as HTMLElement | null
    if (el && !headerCells.includes(el)) headerCells.push(el)
  }

  if (headerCells.length === 0) {
    // header not ready yet — try again on next frame
    requestAnimationFrame(setupHeaderCheckbox)
    return
  }

  // Inject a separate checkbox into each found header cell (keep them in sync via updateHeaderCheckboxState)
  headerCells.forEach(th => {
    // Avoid re-injecting
    if (th.querySelector('.header-confirmed')) return

    // Preserve header text and insert checkbox aligned to the right
    // Avoid re-injecting if header already contains our wrapper
    if (th.querySelector('.header-content')) return

    const existingText = th.textContent ? th.textContent.trim() : ''
    th.innerHTML = ''

    const wrapper = document.createElement('div')
    wrapper.className = 'header-content'
    wrapper.style.display = 'flex'
    wrapper.style.justifyContent = 'space-between'
    wrapper.style.alignItems = 'center'
    wrapper.style.width = '100%'

    const span = document.createElement('span')
    span.className = 'header-text'
    span.textContent = existingText
    wrapper.appendChild(span)

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'header-confirmed'
    checkbox.title = 'Alle bestätigen'
    checkbox.setAttribute('aria-label', 'Alle bestätigen')

    checkbox.addEventListener('change', () => {
      const checked = checkbox.checked
      const data = hot!.getSourceData() as PdfDataRow[]
      for (let i = 0; i < data.length; i++) {
        hot!.setDataAtRowProp(i, 'confirmed', checked)
        // apply or remove visual class for each row
        applyRowConfirmedClass(i, checked)
      }
      // Re-render so cells() is re-evaluated and classes are applied
      hot!.render()
      updateHeaderCheckboxState()
    })

    wrapper.appendChild(checkbox)
    th.appendChild(wrapper)
  })

  updateHeaderCheckboxState()
}

/**
 * Show an expanded view of a cell's content in a simple modal overlay
 */
// Note: expanded-cell modal removed — context menu is disabled in favor of Ctrl+C and fill-handle

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
    // Restrict features: only editing, copy and expand via context menu
    // Disable many interactive features to keep table minimal
    copyPaste: true,
    allowInsertRow: false,
    allowInsertColumn: false,
    allowRemoveRow: false,
    allowRemoveColumn: false,
    manualColumnMove: false,
    manualRowMove: false,
    manualColumnResize: false,
    manualRowResize: false,
    dropdownMenu: false,
    filters: false,
    columnSorting: false,
    // Disable right-click context menu; keep copy/paste and fill-handle
    contextMenu: false,
    fillHandle: true,
    // Cells callback kept minimal to avoid overwriting className meta set via setCellMeta
    cells() {
      return {}
    },
    // Ensure header checkbox is present after each render
    afterRender() {
      setupHeaderCheckbox()
    },
    // Keep header checkbox in sync when checkboxes change
    afterChange(changes, _source) {
      if (!changes) return
      for (const c of changes) {
        const prop = c[1]
        if (prop === 'confirmed') {
          const rowIndex = c[0] as number
          const newVal = c[3] as boolean
          // Apply or remove class for this specific row
          applyRowConfirmedClass(rowIndex, Boolean(newVal))
          // Ensure visual classes are updated after a confirmed change
          if (hot) hot.render()
          updateHeaderCheckboxState()
          break
        }
      }
    },

    async afterOnCellMouseDown(event, coords) {
      if (coords.col === 0 && hot) {
        // Only open the PDF when the user clicks the filename text itself.
        // Ignore clicks on the checkbox or other parts of the cell.
        const target = event && (event.target as HTMLElement | null)
        if (target) {
          // If click was not on the filename span, bail out
          if (!target.closest('.pdf-cell-text')) return
        }

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

  // Prevent the native browser context menu inside the table container
  // Handsontable's built-in contextMenu option is disabled, but some
  // browsers may still show the native menu — block it explicitly.
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault()
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

  // Inject header checkbox once the table is rendered
  requestAnimationFrame(() => setupHeaderCheckbox())
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
  /*if (hot) {
    hot.updateSettings({
      themeName: isChecked ? 'ht-theme-main-light-auto' : 'ht-theme-main-dark-auto'
    })
  }*/
}
