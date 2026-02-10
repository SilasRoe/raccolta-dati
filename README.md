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
    <li><strong>AI-powered PDF analysis:</strong> Automatic extraction of products, quantities, prices, and currencies using <em>Mistral AI</em>. Includes fallback mechanisms using <strong>Mistral OCR</strong> for scanned documents and specific layout preservation strategies.</li>
    <li><strong>Data-Grid (Handsontable):</strong> An interactive, Excel-like interface for editing and validating the extracted data.</li>
    <li><strong>Intelligent translation:</strong> Automatic translation of product names into Italian directly during the extraction process.</li>
    <li><strong>Excel-Export:</strong> Export validated and confirmed data to existing Excel spreadsheets.</li>
    <li><strong>Correction learning mode:</strong> The application learns from manual corrections of product names for future analyses.</li>
    <li><strong>Secure Configuration:</strong> Sensitive data (API keys) are encrypted and stored using the system's native keyring service with a local JSON fallback.</li>
    <li><strong>System Integration:</strong> Prevents system sleep mode during active document analysis to ensure process completion.</li>
</ul>

<h2>Technology Stack</h2>
<ul>
    <li><strong>Frontend:</strong> TypeScript, Vite, HTML5, CSS3.</li>
    <li><strong>UI components:</strong> Handsontable (Spreadsheet-Grid).</li>
    <li><strong>Backend:</strong> Rust (Tauri Framework, Keyring, Keepawake).</li>
    <li><strong>AI integration:</strong> Mistral AI API (Mistral Large & Mistral OCR).</li>
    <li><strong>PDF processing:</strong> PDF.js, external <code>pdftotext</code> binary, and Mistral OCR.</li>
</ul>

<h2>Project Structure</h2>
<pre><code>
.
├── src/                # Frontend (TypeScript & Styles)
│   ├── modules/        # Main logic (event handling, grid control)
│   ├── prompts/        # AI system prompts for orders and invoices
│   ├── types/          # Central type definitions
│   └── main.ts         # Entry Point
├── src-tauri/          # Backend (Rust & Configuration)
│   ├── src/            # Rust Source Code
│   │   ├── modules/    # Backend modules (AI, Config, Excel, Utils)
│   │   └── lib.rs     # Application entry
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
    <li><strong>Path to the installation file:</strong>
        <pre><code>.\src-tauri\target\release\bundle</code></pre>
    </li>
</ol>

<h2>Configuration</h2>
<p>
    The following parameters can be configured within the application via the settings menu:
</p>
<ul>
    <li><strong>API-Key:</strong> Your personal Mistral AI API key (stored securely via system keyring).</li>
    <li><strong>Standard paths:</strong> Default directories for PDF sources and Excel export.</li>
    <li><strong>Theme:</strong> Switch between dark and light mode.</li>
</ul>

</body>
</html>