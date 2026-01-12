<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
</head>
<body>

<h1>Raccolta Dati</h1>

<p>
    <strong>Raccolta Dati</strong> is a desktop application based on <strong>Tauri</strong> and <strong>Vanilla TypeScript</strong> that specializes in extracting data from PDF documents (order confirmations and invoices) using AI and processing it in a tabular overview.
</p>

<h2>Main Functions</h2>
<ul>
    <li><strong>AI-powered PDF analysis:</strong> Automatic extraction of products, quantities, prices, and currencies from PDF files using <em>Mistral AI</em>.</li>
    <li><strong>Data-Grid (Handsontable):</strong> An interactive, Excel-like interface for editing and validating the extracted data.</li>
    <li><strong>Intelligent translation:</strong> Automatic translation of product names into Italian directly during the extraction process.</li>
    <li><strong>Excel-Export:</strong> Export validated and confirmed data to existing Excel spreadsheets.</li>
    <li><strong>Correction learning mode:</strong> The application learns from manual corrections of product names for future analyses.</li>
</ul>

<h2>Technology Stack</h2>
<ul>
    <li><strong>Frontend:</strong> TypeScript, Vite, HTML5, CSS3.</li>
    <li><strong>UI components:</strong> Handsontable (Spreadsheet-Grid).</li>
    <li><strong>Backend:</strong> Rust (Tauri Framework).</li>
    <li><strong>AI integration:</strong> Mistral AI API.</li>
    <li><strong>PDF processing:</strong> PDF.js and an external <code>pdftotext</code> binary.</li>
</ul>

<h2>Project Structure</h2>
<pre><code>
.
├── src/                # Frontend (TypeScript & Styles)
│   ├── prompts/        # AI system prompts for orders and invoices
│   └── main.ts         # Main logic (event handling, grid control)
├── src-tauri/          # Backend (Rust & Konfiguration)
│   ├── src/            # Rust Source Code
│   ├── binaries/       # External utility programs (pdftotext)
│   └── tauri.conf.json # App configuration & security policies
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
