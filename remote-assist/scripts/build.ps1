param([switch]$Sign, [string]$CertificateThumbprint, [string]$TrustedOrigin = "https://connect.snapkeystudio.com")
$ErrorActionPreference = 'Stop'
$uri = [uri]$TrustedOrigin
if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw 'TrustedOrigin must be an HTTPS origin' }
$env:SNAPKEY_REMOTE_ASSIST_ORIGIN = $uri.GetLeftPart([System.UriPartial]::Authority)
Push-Location (Join-Path $PSScriptRoot '..')
try {
    cargo test --locked --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'Native tests failed' }
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'Build failed' }
    $exe = Join-Path $PWD 'target\x86_64-pc-windows-msvc\release\snapkey-remote-assist.exe'
    if ($Sign) {
        if (!$CertificateThumbprint) { throw 'Signing certificate thumbprint is required' }
        signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $exe
        if ($LASTEXITCODE) { throw 'Signing failed' }
        if ((Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'Valid') { throw 'Signature validation failed' }
    }
    Get-FileHash -LiteralPath $exe -Algorithm SHA256
    Write-Output "Artifact: $exe"
    if (!$Sign) { Write-Warning 'UNSIGNED DEVELOPMENT BUILD: do not publish through the Studio download endpoint.' }
} finally { Pop-Location }
