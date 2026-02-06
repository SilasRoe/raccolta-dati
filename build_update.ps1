$env:TAURI_SIGNING_PRIVATE_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5MzZTN2Z4amJnM0hQQWNCQ2lFeFZEMEhOd3U2YTZic1M0ZG41RUo3SzBvY0FBQkFBQUFBQUFBQUFBQUlBQUFBQThtTlpEQ3J3ME1xeXFuVC9Yd0ZwUzdMZXF3cHFnNmlCMnViSmQwdEZEZkVMSFdFZjNzdkxlRE1CS0hnWDZVQk9wbXkrRndCNFZ1ZWZBRDVkUEFpc3ZtR3puZlJnb2k1TGRRcTZjNDVHUXdTd3p6MXhGMHZNSFora1JVWEVtOGgxR3l4Rm9JOEo4bWM9Cg=="
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "Ib3gHb-S" # Leer lassen, falls keins
$githubUser = "silasroe"
$repoName = "raccolta-dati"
# ---------------------

Write-Host "1. Lese Version aus tauri.conf.json..." -ForegroundColor Cyan
$confPath = "src-tauri/tauri.conf.json"
$json = Get-Content $confPath -Raw | ConvertFrom-Json
$version = $json.version
Write-Host "   Version erkannt: $version" -ForegroundColor Green

Write-Host "2. Starte Build-Prozess..." -ForegroundColor Cyan
# Wir nutzen npx, damit es sauber läuft
npx tauri build

# Pfad zu den erstellten Dateien (NSIS Installer)
$basePath = "src-tauri/target/release/bundle/nsis"
$exePattern = "$basePath/*-setup.exe"
$sigPattern = "$basePath/*-setup.exe.sig"

# Dateien suchen
$exeFile = Get-Item $exePattern | Select-Object -First 1
$sigFile = Get-Item $sigPattern | Select-Object -First 1

if ($exeFile -and $sigFile) {
    Write-Host "3. Erstelle latest.json..." -ForegroundColor Cyan
    
    # Signatur auslesen
    $signature = Get-Content $sigFile.FullName -Raw
    
    # Dateinamen für URL kodieren (Leerzeichen -> %20)
    $filename = $exeFile.Name
    $filenameEncoded = [System.Uri]::EscapeDataString($filename)
    
    # Download-URL zusammenbauen
    # Format: https://github.com/USER/REPO/releases/download/vVERSION/DATEINAME
    $downloadUrl = "https://github.com/$githubUser/$repoName/releases/download/v$version/$filenameEncoded"
    
    # JSON Inhalt erstellen
    $latestJson = @{
        version = $version
        notes = "Update auf Version $version"
        pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        platforms = @{
            "windows-x86_64" = @{
                signature = $signature
                url = $downloadUrl
            }
        }
    }
    
    # JSON Datei schreiben
    $jsonPath = "$basePath/latest.json"
    $latestJson | ConvertTo-Json -Depth 4 | Set-Content $jsonPath
    
    Write-Host "------------------------------------------------" -ForegroundColor Green
    Write-Host "FERTIG! Folgende Dateien jetzt auf GitHub hochladen (Tag: v$version):" -ForegroundColor White
    Write-Host "1. $($exeFile.FullName)" -ForegroundColor Yellow
    Write-Host "2. $jsonPath" -ForegroundColor Yellow
    Write-Host "------------------------------------------------" -ForegroundColor Green
} else {
    Write-Host "FEHLER: Build erfolgreich, aber Dateien nicht gefunden." -ForegroundColor Red
}