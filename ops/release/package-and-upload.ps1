<#
.SYNOPSIS
  Build a BOX release package on Windows and upload it through SSH/SCP.

.NOTES
  Package layout (目录名全部是英文):
    code/               代码类（含 code/out 构建产物与 code/dnd-app 独立静态应用）
    resources/content/  受版本控制的资源（工具定义、卡牌目录、模板）
    resources/public/   静态资源；不含 image/（约 700 MB，随共享目录单独上传）
    resources/.env.example
    ops/scripts/        数据库与维护脚本（code/package.json 的命令依赖它）
    docs/              文档类
    README.md, package.json

  The package excludes .git, node_modules, .next, .env.local, resources/data,
  resources/public/image, ops/logs and ops/.release.
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
$RequiredFiles = @('code\package.json', 'code\package-lock.json', 'code\server\index.js', 'code\next.config.ts', 'code\tsconfig.json', 'code\dnd-app\index.html', 'resources\.env.example', 'resources\content\tools.json', 'package.json', 'README.md')

# robocopy 用 /XD 按目录名排除；返回码 0-7 表示成功，8 及以上才是错误。
function Copy-Tree {
  param([string]$Source, [string]$Destination, [string[]]$ExcludeDirectories = @())
  if (!(Test-Path -LiteralPath $Source)) { throw "Required release directory is missing: $Source" }
  $arguments = @($Source, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1')
  if ($ExcludeDirectories.Count -gt 0) { $arguments += '/XD'; $arguments += $ExcludeDirectories }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $Source -> $Destination" }
}

function Assert-ReleaseTree {
  param([string]$Stage)
  $required = @(
    'package.json',
    'README.md',
    'code\package.json',
    'code\server\index.js',
    'code\out',
    'code\dnd-app\index.html',
    'resources\content\tools.json',
    'resources\public',
    'resources\.env.example',
    'ops\scripts\prisma-cli.mjs'
  )
  foreach ($item in $required) {
    if (!(Test-Path -LiteralPath (Join-Path $Stage $item))) { throw "Release tree is incomplete, missing: $item" }
  }
  $forbidden = @('code\node_modules', 'code\.next', 'resources\.env.local', 'resources\data', 'resources\public\image', 'ops\.release', 'ops\logs')
  foreach ($item in $forbidden) {
    if (Test-Path -LiteralPath (Join-Path $Stage $item)) { throw "Release tree contains something that must not be packaged: $item" }
  }
}

Push-Location $ProjectRoot
try {
  if (!$SkipBuild) {
    Write-Host '==> Building production output...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; no release package was created.' }
  }

  $OutDirectory = Join-Path $ProjectRoot 'code\out'
  if (!(Test-Path -LiteralPath $OutDirectory)) { throw 'code/out is missing; run npm run build or omit -SkipBuild.' }
  foreach ($file in $RequiredFiles) {
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot $file))) { throw "Required release file is missing: $file" }
  }
  $revision = git rev-parse --short HEAD 2>$null
  if (($LASTEXITCODE -ne 0) -or (!$revision)) { $revision = 'nogit' }
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $version = "$timestamp-$revision"
  $releaseRoot = Join-Path $ProjectRoot 'ops\.release'
  $stage = Join-Path $releaseRoot "stage-$version"
  $package = Join-Path $releaseRoot "box-$version.tar.gz"

  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Write-Host "==> Staging release $version..." -ForegroundColor Cyan

  # 代码类：带上 code/out 构建产物，排除依赖与 Next 缓存
  Copy-Tree -Source (Join-Path $ProjectRoot 'code') -Destination (Join-Path $stage 'code') -ExcludeDirectories @('node_modules', '.next')
  # 资源类：content + public（不含约 700 MB 的 public/image）+ 配置模板
  Copy-Tree -Source (Join-Path $ProjectRoot 'resources\content') -Destination (Join-Path $stage 'resources\content')
  Copy-Tree -Source (Join-Path $ProjectRoot 'resources\public') -Destination (Join-Path $stage 'resources\public') -ExcludeDirectories @('image')
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'resources\.env.example') -Destination (Join-Path $stage 'resources\.env.example')
  # 命令行类：数据库脚本必须随包，code/package.json 的 db:* 命令要调用它
  Copy-Tree -Source (Join-Path $ProjectRoot 'ops\scripts') -Destination (Join-Path $stage 'ops\scripts')
  # 文档类与顶层说明
  Copy-Tree -Source (Join-Path $ProjectRoot 'docs') -Destination (Join-Path $stage 'docs')
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README.md') -Destination (Join-Path $stage 'README.md')
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination (Join-Path $stage 'package.json')

  Assert-ReleaseTree -Stage $stage

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
  scp (Join-Path $ProjectRoot 'ops\release\deploy-release.sh') ('{0}:~/box-ops/deploy-release.sh' -f $Server)
  scp (Join-Path $ProjectRoot 'ops\release\rollback-release.sh') ('{0}:~/box-ops/rollback-release.sh' -f $Server)
  scp (Join-Path $ProjectRoot 'ops\release\bootstrap-releases.sh') ('{0}:~/box-ops/bootstrap-releases.sh' -f $Server)
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
