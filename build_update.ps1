# --- KONFIGURATION ---
# Fügen Sie hier Ihren Private Key ein (der lange String):
$env:TAURI_SIGNING_PRIVATE_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5MzZTN2Z4amJnM0hQQWNCQ2lFeFZEMEhOd3U2YTZic1M0ZG41RUo3SzBvY0FBQkFBQUFBQUFBQUFBQUlBQUFBQThtTlpEQ3J3ME1xeXFuVC9Yd0ZwUzdMZXF3cHFnNmlCMnViSmQwdEZEZkVMSFdFZjNzdkxlRE1CS0hnWDZVQk9wbXkrRndCNFZ1ZWZBRDVkUEFpc3ZtR3puZlJnb2k1TGRRcTZjNDVHUXdTd3p6MXhGMHZNSFora1JVWEVtOGgxR3l4Rm9JOEo4bWM9Cg=="

# Fügen Sie hier Ihr Passwort ein (leer lassen "", falls keins):
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "Ib3gHb-S"
# ---------------------

Write-Host "Starte Build-Prozess..." -ForegroundColor Green

# Wir prüfen kurz, ob der Key da ist (nur die ersten 5 Zeichen anzeigen zur Sicherheit)
if ($env:TAURI_SIGNING_PRIVATE_KEY.Length -gt 10) {
    Write-Host "Key geladen: $($env:TAURI_SIGNING_PRIVATE_KEY.Substring(0, 5))..." -ForegroundColor Cyan
}
else {
    Write-Host "FEHLER: Key scheint leer zu sein!" -ForegroundColor Red
    exit
}

# Build starten (wir nutzen npx direkt, um Pfadprobleme zu vermeiden)
npx tauri build

# Prüfung am Ende
$targetDir = "src-tauri/target/release/bundle/nsis"
if (Test-Path "$targetDir/*.zip") {
    Write-Host "ERFOLG! Update-Dateien (.zip und .sig) wurden erstellt." -ForegroundColor Green
}
else {
    Write-Host "WARNUNG: Keine .zip Datei gefunden. Key wurde wohl nicht akzeptiert." -ForegroundColor Yellow
}