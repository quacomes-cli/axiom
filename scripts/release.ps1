# Axiom release script — Windows
#
# Kullanım:
#   .\scripts\release.ps1 0.2.0
#
# Yaptıkları:
#   1) Versiyon stringini package.json + Cargo.toml + tauri.conf.json'a yazar
#   2) `bun run tauri build` ile installer + updater bundle üretir
#   3) Hangi dosyaların release'e yükleneceğini listeler
#
# Önceden TEK SEFER yapılması gerekenler:
#   1) `bun add -D @tauri-apps/cli` (zaten yüklü)
#   2) Updater keypair oluştur:
#        bun run tauri signer generate -w $env:USERPROFILE\.tauri\axiom.key
#      Public key'i tauri.conf.json'daki "pubkey" alanına yapıştır.
#      Private key'i (.key dosyası) ASLA commitleme.
#   3) Signing için env vars (her release oturumunda):
#        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:USERPROFILE\.tauri\axiom.key -Raw
#        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "key-sifren"
#   4) LIBCLANG_PATH: .cargo\config.toml ayarlandı, dokunma.

param(
  [Parameter(Mandatory=$true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom([string]$path, [string]$content) {
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error "Versiyon X.Y.Z formatinda olmali (orn 0.2.0)"
  exit 1
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  Write-Error "TAURI_SIGNING_PRIVATE_KEY env var set edilmemis. README'ye bak."
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot

Write-Host "-> Versiyon yaziliyor: $Version" -ForegroundColor Cyan

# package.json
$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.version = $Version
Write-Utf8NoBom $pkgPath ($pkg | ConvertTo-Json -Depth 10)

# Cargo.toml
# NOT: PS 5.1'de Get-Content, BOM'suz UTF-8 dosyayi ANSI olarak okur ve Turkce
# karakterler her calistirmada katlanarak bozulur (bkz: 330MB'lik description
# vakasi). Bu yuzden encoding'i acikca UTF-8 vererek okuyoruz.
$cargoPath = Join-Path $root "src-tauri\Cargo.toml"
$cargo = [System.IO.File]::ReadAllText($cargoPath, [System.Text.Encoding]::UTF8)
$cargo = $cargo -replace '(?m)^version = "\d+\.\d+\.\d+"', "version = `"$Version`""
Write-Utf8NoBom $cargoPath $cargo

# tauri.conf.json
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$conf.version = $Version
Write-Utf8NoBom $confPath ($conf | ConvertTo-Json -Depth 10)

# Eski sürümlere ait artefactlari temizle — yoksa Get-ChildItem yanlislikla
# onlari secebilir ve latest.json bos URL ile bozulur.
$bundleDir = Join-Path $root "src-tauri\target\release\bundle"
$nsisDir = Join-Path $bundleDir "nsis"
$msiDir  = Join-Path $bundleDir "msi"

if (Test-Path $nsisDir) {
  Write-Host "-> Eski nsis artefactlari temizleniyor..." -ForegroundColor DarkGray
  Get-ChildItem -Path $nsisDir -Recurse | Remove-Item -Force -Recurse
}
if (Test-Path $msiDir) {
  Write-Host "-> Eski msi artefactlari temizleniyor..." -ForegroundColor DarkGray
  Get-ChildItem -Path $msiDir -Recurse | Remove-Item -Force -Recurse
}

Write-Host "-> Build basliyor..." -ForegroundColor Cyan
Push-Location $root
try {
  bun run tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build basarisiz (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "-> Build tamam. Release'e yuklenecek dosyalar:" -ForegroundColor Green

# Versiyona göre filtrele — çift güvenlik
$nsis    = Get-ChildItem -Path $nsisDir -Filter "*_${Version}_*.exe"  -ErrorAction SilentlyContinue
$nsisSig = Get-ChildItem -Path $nsisDir -Filter "*_${Version}_*.sig"  -ErrorAction SilentlyContinue
$msi     = Get-ChildItem -Path $msiDir  -Filter "*_${Version}_*.msi"  -ErrorAction SilentlyContinue
$msiSig  = Get-ChildItem -Path $msiDir  -Filter "*_${Version}_*.sig"  -ErrorAction SilentlyContinue

if (-not $nsis -or -not $nsisSig) {
  Write-Error "Build cikti dosyalari bulunamadi (nsis/exe veya .sig eksik). Build basarili tamamlanmamis olabilir."
  exit 1
}

@($nsis, $nsisSig, $msi, $msiSig) | ForEach-Object {
  if ($_) { Write-Host "  * $($_.FullName)" }
}

# .sig içeriğini oku ve latest.json'ı otomatik oluştur
# Tauri 2 NSIS updater artefact'ı doğrudan .exe — .zip değil
$exeFile = $nsis | Select-Object -First 1
$sigFile = $nsisSig | Select-Object -First 1
$sigContent = ""
if ($sigFile) {
  $sigContent = (Get-Content $sigFile.FullName -Raw).Trim()
}
$exeName = if ($exeFile) { $exeFile.Name } else { "Axiom_${Version}_x64-setup.exe" }

$latestJson = @"
{
  "version": "$Version",
  "notes": "Yenilikler...",
  "pub_date": "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')",
  "platforms": {
    "windows-x86_64": {
      "signature": "$sigContent",
      "url": "https://github.com/quacomes-cli/axiom/releases/download/v$Version/$exeName"
    }
  }
}
"@

$latestJsonPath = Join-Path $root "latest.json"
Write-Utf8NoBom $latestJsonPath $latestJson

Write-Host ""
Write-Host "-> latest.json olusturuldu: $latestJsonPath" -ForegroundColor Green
Write-Host ""
Write-Host "-> Sirada (gh CLI ile):" -ForegroundColor Cyan
Write-Host "   gh release create v$Version --repo quacomes-cli/axiom --title 'Axiom v$Version' --notes 'Yenilikler...'"

$files = @()
if ($nsis)    { $files += "`"$($nsis.FullName)`"" }
if ($nsisSig) { $files += "`"$($nsisSig.FullName)`"" }
if ($msi)     { $files += "`"$($msi.FullName)`"" }
if ($msiSig)  { $files += "`"$($msiSig.FullName)`"" }
$files += "`"$latestJsonPath`""

Write-Host "   gh release upload v$Version --repo quacomes-cli/axiom $($files -join ' ')"
