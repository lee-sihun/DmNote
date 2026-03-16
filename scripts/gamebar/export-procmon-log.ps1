param(
  [string]$ProcmonPath = 'C:\Users\esihun\Downloads\SysinternalsSuite\Procmon64.exe',
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ProcmonPath)) {
  throw "Procmon 실행 파일을 찾지 못했습니다: $ProcmonPath"
}

if (-not (Test-Path $InputPath)) {
  throw "입력 PML 파일을 찾지 못했습니다: $InputPath"
}

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

if (Test-Path $OutputPath) {
  Remove-Item $OutputPath -Force
}

& $ProcmonPath /AcceptEula /OpenLog $InputPath /SaveAs $OutputPath /Quiet | Out-Null

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $OutputPath) {
    Get-Item $OutputPath | Select-Object FullName, Length, LastWriteTime
    exit 0
  }

  Start-Sleep -Milliseconds 500
}

throw "Procmon 로그 내보내기가 완료되지 않았습니다: $OutputPath"
