<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
</head>
<body>

<h1>Raccolta Dati</h1>

<p>
    <strong>Raccolta Dati</strong> is a desktop application based on <strong>Tauri</strong> and <strong>Vanilla TypeScript</strong> that specializes in extracting data from PDF documents (order confirmations and invoices) using AI and synchronizing it with Excel spreadsheets.
</p>

<h2>Main Functions</h2>
<ul>
    <li><strong>Hybrid AI & OCR Engine:</strong> Combines local text extraction via <em>pdftotext</em> with <em>Mistral OCR</em> and <em>Mistral Large</em> to handle complex layouts and even image-based PDFs reliably.</li>
    <li><strong>Smart Excel Synchronization:</strong> Intelligent export that doesn't just append data but updates existing order rows with invoice details (matching by fuzzy logic on prices/quantities). It preserves cell formatting, formulas, and sorts entries automatically (Supplier &gt; Order Nr &gt; Date).</li>
    <li><strong>Data-Grid (Handsontable):</strong> An interactive, Excel-like interface for editing and validating the extracted data before export.</li>
    <li><strong>Intelligent translation:</strong> Automatic translation of product names into Italian directly during the extraction process.</li>
    <li><strong>Correction learning mode:</strong> The application learns from manual corrections of product names to improve future analyses automatically.</li>
    <li><strong>Auto-Updater:</strong> Integrated update mechanism to keep the application up-to-date via GitHub Releases.</li>
</ul>

<h2>Technology Stack</h2>
<ul>
    <li><strong>Frontend:</strong> TypeScript, Vite, HTML5, CSS3.</li>
    <li><strong>UI components:</strong> Handsontable (Spreadsheet-Grid).</li>
    <li><strong>Backend:</strong> Rust (Tauri Framework).</li>
    <li><strong>AI integration:</strong> Mistral AI API (Large & OCR models).</li>
    <li><strong>PDF processing:</strong> Hybrid approach using <code>pdftotext</code> binary (Sidecar) and Cloud OCR.</li>
    <li><strong>Excel Engine:</strong> <code>umya_spreadsheet</code> for reading/writing .xlsx files with style preservation.</li>
</ul>

<h2>Project Structure</h2>
<pre><code>
.
├── src/                # Frontend (TypeScript & Styles)
│   ├── modules/        # Main logic (event handling, grid control, API)
│   ├── prompts/        # AI system prompts for orders and invoices
│   ├── types/          # Central type definitions
│   └── main.ts         # Entry Point & Updater Logic
├── src-tauri/          # Backend (Rust & Configuration)
│   ├── src/            # Rust Source Code (Modules: AI, Excel, Config)
│   ├── binaries/       # External utility programs (pdftotext)
│   └── tauri.conf.json # App configuration, permissions & plugins
├── package.json        # Dependencies & Scripts
└── tsconfig.json       # TypeScript configuration
</code></pre>

<h2>Installation & Development</h2>

<h3>Prerequisites</h3>
<ul>
    <li>Node.js & npm</li>
    <li>Rust-Toolchain (via rustup)</li>
    <li>WebView2 (pre-installed on Windows)</li>
</ul>

<h3>Steps</h3>
<ol>
    <li><strong>Clone repository:</strong>
        <pre><code>git clone https://github.com/SilasRoe/raccolta-dati.git</code></pre>
    </li>
    <li><strong>Install dependencies:</strong>
        <pre><code>npm install</code></pre>
    </li>
    <li><strong>Start development mode:</strong>
        <pre><code>npm run tauri dev</code></pre>
    </li>
    <li><strong>Create production build:</strong>
        <pre><code>npm run tauri build</code></pre>
    </li>
    <li><strong>Path to the installation file:</strong>
        <pre><code>.\src-tauri\target\release\bundle</code></pre>
    </li>
</ol>

<h2>Configuration</h2>
<p>
    The following parameters can be configured within the application via the settings menu:
</p>
<ul>
    <li><strong>API-Key:</strong> Your personal Mistral AI API key.</li>
    <li><strong>Standard paths:</strong> Default directories for PDF sources and Excel export.</li>
    <li><strong>Theme:</strong> Switch between dark and light mode.</li>
</ul>

</body>
</html>