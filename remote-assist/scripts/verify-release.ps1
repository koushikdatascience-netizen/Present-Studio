param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
if ((Get-AuthenticodeSignature -LiteralPath $Executable).Status -ne 'Valid') { throw 'Only a valid Authenticode-signed helper may be published' }
Copy-Item -LiteralPath $Executable -Destination $Destination
Get-FileHash -LiteralPath $Destination -Algorithm SHA256
