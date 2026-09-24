<#
.SYNOPSIS
  把整个 BOX 项目目录打包并复制到服务器（不做版本目录、不做共享软链）。

.DESCRIPTION
  1. 在本机把项目打成 tar.gz，默认排除 node_modules、.next、.git、resources/data、
     resources/.env.local 与 resources/public/image；
  2. 用 SSH/SCP 把压缩包和配套的 deploy-project.sh 上传到服务器；
  3. 输出需要在服务器上执行的部署命令。

  服务器上的项目目录始终只有一份（默认 ~/BOX）：新代码就地覆盖旧代码，
  resources/.env.local、resources/data、resources/public/image 与 code/node_modules 不受影响。
  上传本身不会停止、重启或修改正在运行的网站。

.PARAMETER Server
  ~/.ssh/config 里的主机别名，默认 box-prod。

.PARAMETER RemoteDirectory
  服务器上存放压缩包与部署脚本的目录，默认 ~/box-upload。

.PARAMETER IncludeImages
  连 resources/public/image 一起打包（本地约 65 MB）。第一次在新服务器上部署时需要，
  之后图片基本不变，日常升级不用带。

.PARAMETER SkipBuild
  不在本机执行 npm run build（压缩包里的 code/out 沿用当前内容；服务器侧部署脚本仍会重新构建）。

.PARAMETER KeepArchive
  上传完成后保留本机的 ops\.upload 打包目录，方便排查。

.EXAMPLE
  .\ops\release\upload-project.ps1 -Server box-prod
  .\ops\release\upload-project.ps1 -Server box-prod -IncludeImages

.NOTES
  文件必须保存为「UTF-8 带 BOM」，否则 Windows PowerShell 5.1 会按本地编码读取，
  中文注释可能导致脚本解析失败。
#>
[CmdletBinding()]
param(
  [string]$Server = 'box-prod',
  [string]$RemoteDirectory = '~/box-upload',
  [switch]$IncludeImages,
  [switch]$SkipBuild,
  [switch]$KeepArchive
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RequiredFiles = @('code\package.json', 'code\package-lock.json', 'code\server\index.js', 'code\prisma\schema.prisma', 'resources\.env.example', 'resources\content\tools.json', 'ops\scripts\prisma-cli.mjs', 'package.json', 'README.md')

# robocopy 用 /XD 按目录名排除；返回码 0-7 表示成功，8 及以上才是错误。
function Copy-Tree {
  param([string]$Source, [string]$Destination, [string[]]$ExcludeDirectories = @())
  if (!(Test-Path -LiteralPath $Source)) { throw "缺少要打包的目录：$Source" }
  $arguments = @($Source, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1')
  if ($ExcludeDirectories.Count -gt 0) { $arguments += '/XD'; $arguments += $ExcludeDirectories }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（$LASTEXITCODE）：$Source -> $Destination" }
}

Push-Location $ProjectRoot
try {
  if (!$SkipBuild) {
    Write-Host '==> 本机构建（npm run build）...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw '本机构建失败，未生成压缩包。' }
  }

  foreach ($file in $RequiredFiles) {
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot $file))) { throw "缺少必要文件：$file" }
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $revision = git rev-parse --short HEAD 2>$null
  if (($LASTEXITCODE -ne 0) -or (!$revision)) { $revision = 'nogit' }
  $archiveName = "box-project-$timestamp-$revision.tar.gz"
  $stagingRoot = Join-Path $ProjectRoot 'ops\.upload'
  $stage = Join-Path $stagingRoot "stage-$timestamp"
  $archive = Join-Path $stagingRoot $archiveName

  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Write-Host "==> 打包项目目录：$archiveName" -ForegroundColor Cyan

  # 代码类：不带依赖与 Next 缓存，其余照搬（含 code/out 与 code/dnd-app）
  Copy-Tree -Source (Join-Path $ProjectRoot 'code') -Destination (Join-Path $stage 'code') -ExcludeDirectories @('node_modules', '.next')
  # 资源类：content 与 public；image 体积大且基本不变，默认不带（用 -IncludeImages 打开）
  Copy-Tree -Source (Join-Path $ProjectRoot 'resources\content') -Destination (Join-Path $stage 'resources\content')
  $publicExcludes = if ($IncludeImages) { @() } else { @('image') }
  Copy-Tree -Source (Join-Path $ProjectRoot 'resources\public') -Destination (Join-Path $stage 'resources\public') -ExcludeDirectories $publicExcludes
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'resources\.env.example') -Destination (Join-Path $stage 'resources\.env.example')
  # 命令行类：脚本与发布工具整体搬过去（排除日志、本地检查产物与打包暂存目录）
  Copy-Tree -Source (Join-Path $ProjectRoot 'ops') -Destination (Join-Path $stage 'ops') -ExcludeDirectories @('logs', 'checks', '.release', '.upload')
  Copy-Tree -Source (Join-Path $ProjectRoot 'docs') -Destination (Join-Path $stage 'docs')
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README.md') -Destination (Join-Path $stage 'README.md')
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination (Join-Path $stage 'package.json')

  # 持久化数据绝不能进压缩包：出问题要在本机就炸掉，而不是传到服务器再发现。
  foreach ($item in @('package.json', 'README.md', 'code\package.json', 'code\server\index.js', 'code\prisma\schema.prisma', 'code\out', 'resources\content\tools.json', 'resources\public', 'resources\.env.example', 'ops\scripts\prisma-cli.mjs')) {
    if (!(Test-Path -LiteralPath (Join-Path $stage $item))) { throw "打包结果不完整，缺少：$item" }
  }
  foreach ($item in @('code\node_modules', 'code\.next', 'resources\.env.local', 'resources\data', 'ops\.release', 'ops\.upload', 'ops\logs', 'ops\checks')) {
    if (Test-Path -LiteralPath (Join-Path $stage $item)) { throw "打包结果包含不该上传的内容：$item" }
  }
  if (!$IncludeImages -and (Test-Path -LiteralPath (Join-Path $stage 'resources\public\image'))) { throw '打包结果包含 resources/public/image（要带上图片请显式加 -IncludeImages）' }

  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  & tar.exe -czf $archive -C $stage .
  if ($LASTEXITCODE -ne 0) { throw '创建压缩包失败。' }
  if (!(Test-Path -LiteralPath $archive)) { throw '压缩包没有生成。' }
  Write-Host ('==> 压缩包大小：{0:N1} MB' -f ((Get-Item -LiteralPath $archive).Length / 1MB))

  Write-Host '==> 上传压缩包与部署脚本...' -ForegroundColor Cyan
  ssh $Server "mkdir -p $RemoteDirectory"
  if ($LASTEXITCODE -ne 0) { throw '无法在服务器上创建上传目录。' }
  scp $archive ('{0}:{1}/' -f $Server, $RemoteDirectory)
  if ($LASTEXITCODE -ne 0) { throw '压缩包上传失败。' }
  scp (Join-Path $ProjectRoot 'ops\release\deploy-project.sh') ('{0}:{1}/deploy-project.sh' -f $Server, $RemoteDirectory)
  if ($LASTEXITCODE -ne 0) { throw '部署脚本上传失败。' }
  ssh $Server "chmod 700 $RemoteDirectory/deploy-project.sh"
  if ($LASTEXITCODE -ne 0) { throw '无法设置服务器上的脚本权限。' }

  Write-Host "`n上传完成：$archiveName" -ForegroundColor Green
  Write-Host '下一步（服务器上就地覆盖代码、构建并重启服务）：' -ForegroundColor Yellow
  Write-Host ("ssh {0} `"{1}/deploy-project.sh {1}/{2}`"" -f $Server, $RemoteDirectory, $archiveName)
  Write-Host '只想覆盖代码、不重装依赖与构建时，加上 --skip-install --skip-build。'
  Write-Host '上传本身不会停止、重启或修改正在运行的网站。'

  if (!$KeepArchive) {
    Remove-Item -LiteralPath $stage -Recurse -Force
    Remove-Item -LiteralPath $archive -Force
  }
} finally {
  Pop-Location
}