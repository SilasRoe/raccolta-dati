<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
</head>
<body>

<h1>Raccolta Dati</h1>

<p>
    <strong>Raccolta Dati</strong> ist eine Desktop-Anwendung auf Basis von <strong>Tauri</strong> und <strong>Vanilla TypeScript</strong>, die darauf spezialisiert ist, Daten aus PDF-Dokumenten (Auftragsbestätigungen und Rechnungen) mithilfe von KI zu extrahieren und in einer tabellarischen Übersicht zu verarbeiten.
</p>

<h2>Hauptfunktionen</h2>
<ul>
    <li><strong>KI-gestützte PDF-Analyse:</strong> Automatische Extraktion von Produkten, Mengen, Preisen und Währungen aus PDF-Dateien unter Verwendung von <em>Mistral AI</em>.</li>
    <li><strong>Daten-Grid (Handsontable):</strong> Eine interaktive, Excel-ähnliche Oberfläche zur Bearbeitung und Validierung der extrahierten Daten.</li>
    <li><strong>Intelligente Übersetzung:</strong> Automatische Übersetzung von Produktnamen ins Italienische direkt während des Extraktionsprozesses.</li>
    <li><strong>Excel-Export:</strong> Export der validierten und bestätigten Daten in bestehende Excel-Arbeitsblätter.</li>
    <li><strong>Drag & Drop Support:</strong> Einfaches Hinzufügen von PDF-Dateien durch Ziehen in das Anwendungsfenster.</li>
    <li><strong>Korrektur-Lernmodus:</strong> Die Anwendung lernt aus manuellen Korrekturen von Produktnamen für zukünftige Analysen.</li>
</ul>

<h2>Technologie-Stack</h2>
<ul>
    <li><strong>Frontend:</strong> TypeScript, Vite, HTML5, CSS3.</li>
    <li><strong>UI-Komponenten:</strong> Handsontable (Spreadsheet-Grid).</li>
    <li><strong>Backend:</strong> Rust (Tauri Framework).</li>
    <li><strong>KI-Integration:</strong> Mistral AI API.</li>
    <li><strong>PDF-Verarbeitung:</strong> PDF.js und ein externes <code>pdftotext</code> Binary.</li>
</ul>

<h2>Projektstruktur</h2>
<pre><code>
.
├── src/                # Frontend (TypeScript & Styles)
│   ├── prompts/        # KI-System-Prompts für Aufträge & Rechnungen
│   └── main.ts         # Hauptlogik (Event-Handling, Grid-Steuerung)
├── src-tauri/          # Backend (Rust & Konfiguration)
│   ├── src/            # Rust Source Code
│   ├── binaries/       # Externe Hilfsprogramme (pdftotext)
│   └── tauri.conf.json # App-Konfiguration & Sicherheitsrichtlinien
├── package.json        # Abhängigkeiten & Scripts
└── tsconfig.json       # TypeScript Konfiguration
</code></pre>

<h2>Installation & Entwicklung</h2>

<h3>Voraussetzungen</h3>
<ul>
    <li>Node.js & npm</li>
    <li>Rust-Toolchain (via rustup)</li>
    <li>WebView2 (unter Windows vorinstalliert)</li>
</ul>

<h3>Schritte</h3>
<ol>
    <li><strong>Repository klonen:</strong>
        <pre><code>git clone [URL-ZUM-REPO]</code></pre>
    </li>
    <li><strong>Abhängigkeiten installieren:</strong>
        <pre><code>npm install</code></pre>
    </li>
    <li><strong>Entwicklungsmodus starten:</strong>
        <pre><code>npm run tauri dev</code></pre>
    </li>
    <li><strong>Produktions-Build erstellen:</strong>
        <pre><code>npm run tauri build</code></pre>
    </li>
</ol>

<h2>Konfiguration</h2>
<p>
    Innerhalb der Anwendung können über das Einstellungsmenü folgende Parameter konfiguriert werden:
</p>
<ul>
    <li><strong>API-Key:</strong> Dein persönlicher Mistral AI API-Key.</li>
    <li><strong>Standard-Pfade:</strong> Standardverzeichnisse für PDF-Quellen und den Excel-Export.</li>
    <li><strong>Theme:</strong> Wechsel zwischen Dark- und Light-Mode.</li>
</ul>

</body>
</html>
