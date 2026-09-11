<#
.SYNOPSIS
  Build a BOX release package on Windows and upload it through SSH/SCP.

.NOTES
  The package excludes .git, node_modules, .env.local, and real data/.
  Uploading does not deploy, restart, or modify the running application.
#>
[CmdletBinding()]
param(
  [string]$Server = 'box-prod',
  [string]$RemoteUploadDirectory = '~/box-upload',
  [switch]$SkipBuild,
  [switch]$KeepPackage
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RequiredDirectories = @('app', 'components', 'content', 'lib', 'prisma', 'public', 'scripts', 'server', 'types')
$OptionalDirectories = @('docs')
$RequiredFiles = @('.env.example', '.gitignore', 'next.config.ts', 'package.json', 'package-lock.json', 'postcss.config.js', 'tailwind.config.ts', 'tsconfig.json')

function Copy-ReleaseItem {
  param([string]$Path, [string]$Destination)
  $SourcePath = Join-Path $ProjectRoot $Path
  if (!(Test-Path -LiteralPath $SourcePath)) { throw "Required release item is missing: $Path" }
  Copy-Item -LiteralPath $SourcePath -Destination $Destination -Recurse -Force
}

Push-Location $ProjectRoot
try {
  if (!$SkipBuild) {
    Write-Host '==> Building production output...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; no release package was created.' }
  }

  $OutDirectory = Join-Path $ProjectRoot 'out'
  if (!(Test-Path -LiteralPath $OutDirectory)) { throw 'out/ is missing; run npm run build or omit -SkipBuild.' }
  $revision = git rev-parse --short HEAD 2>$null
  if (($LASTEXITCODE -ne 0) -or (!$revision)) { $revision = 'nogit' }
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $version = "$timestamp-$revision"
  $releaseRoot = Join-Path $ProjectRoot '.release'
  $stage = Join-Path $releaseRoot "stage-$version"
  $package = Join-Path $releaseRoot "box-$version.tar.gz"

  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Write-Host "==> Staging release $version..." -ForegroundColor Cyan
  foreach ($directory in $RequiredDirectories) { Copy-ReleaseItem -Path $directory -Destination $stage }
  foreach ($directory in $OptionalDirectories) {
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot $directory)) { Copy-ReleaseItem -Path $directory -Destination $stage }
  }
  foreach ($file in $RequiredFiles) { Copy-ReleaseItem -Path $file -Destination $stage }
  Copy-ReleaseItem -Path 'out' -Destination $stage

  $manifest = @{ version = $version; revision = $revision; builtAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
  Set-Content -LiteralPath (Join-Path $stage 'release-manifest.json') -Value $manifest -Encoding utf8
  Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue
  & tar.exe -czf $package -C $stage .
  if ($LASTEXITCODE -ne 0) { throw 'Release archive creation failed.' }
  if (!(Test-Path -LiteralPath $package)) { throw 'Release archive was not created.' }

  Write-Host '==> Uploading archive and release scripts...' -ForegroundColor Cyan
  ssh $Server "mkdir -p $RemoteUploadDirectory ~/box-ops"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create remote upload directories.' }
  $archiveDestination = '{0}:{1}/' -f $Server, $RemoteUploadDirectory
  scp $package $archiveDestination
  if ($LASTEXITCODE -ne 0) { throw 'Release archive upload failed.' }
  scp (Join-Path $ProjectRoot 'scripts\release\deploy-release.sh') ('{0}:~/box-ops/deploy-release.sh' -f $Server)
  scp (Join-Path $ProjectRoot 'scripts\release\rollback-release.sh') ('{0}:~/box-ops/rollback-release.sh' -f $Server)
  scp (Join-Path $ProjectRoot 'scripts\release\bootstrap-releases.sh') ('{0}:~/box-ops/bootstrap-releases.sh' -f $Server)
  if ($LASTEXITCODE -ne 0) { throw 'Release script upload failed.' }
  ssh $Server 'chmod 700 ~/box-ops/*.sh'
  if ($LASTEXITCODE -ne 0) { throw 'Could not set remote script permissions.' }

  Write-Host "`nUpload complete. Version: $version" -ForegroundColor Green
  Write-Host 'Next step, after release bootstrap is complete:' -ForegroundColor Yellow
  Write-Host ("ssh {0} '~/box-ops/deploy-release.sh {1}/box-{2}.tar.gz'" -f $Server, $RemoteUploadDirectory, $version)
  Write-Host 'Upload alone does not stop, restart, or change the running website.'

  if (!$KeepPackage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
    Remove-Item -LiteralPath $package -Force
  }
} finally {
  Pop-Location
}
