param(
  [string]$CsvPath = 'C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-procmon-capture.csv',
  [string]$SummaryPath,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not $SummaryPath -and -not (Test-Path $CsvPath)) {
  throw "Procmon CSV를 찾지 못했습니다: $CsvPath"
}

function Get-RegistryValueSafe {
  param(
    [string]$Path,
    [string]$Name = '(default)'
  )

  try {
    if ($Name -eq '(default)') {
      return (Get-Item -LiteralPath $Path -ErrorAction Stop).GetValue('')
    }

    return (Get-ItemProperty -LiteralPath $Path -ErrorAction Stop).$Name
  } catch {
    return $null
  }
}

function Get-PackagedComClasses {
  param(
    [string]$Clsid
  )

  $indexPath = "Registry::HKEY_CLASSES_ROOT\PackagedCom\ClassIndex\$Clsid"
  if (-not (Test-Path $indexPath)) {
    return @()
  }

  return Get-ChildItem -LiteralPath $indexPath -ErrorAction SilentlyContinue |
    ForEach-Object {
      $packageName = $_.PSChildName
      $classPath = "Registry::HKEY_CLASSES_ROOT\PackagedCom\Package\$packageName\Class\$Clsid"

      [pscustomobject]@{
        package = $packageName
        display_name = Get-RegistryValueSafe -Path $classPath -Name 'DisplayName'
        server_id = Get-RegistryValueSafe -Path $classPath -Name 'ServerId'
      }
    }
}

function Add-HitFromRow {
  param(
    [object]$Row
  )

  $path = if ($null -ne $Row.path) { $Row.path } elseif ($null -ne $Row.Path) { $Row.Path } else { $null }
  if (-not $path -or $path -notmatch $regex) {
    return @()
  }

  $processName = if ($null -ne $Row.process_name) { $Row.process_name } elseif ($null -ne $Row.'Process Name') { $Row.'Process Name' } else { $null }
  $operation = if ($null -ne $Row.operation) { $Row.operation } elseif ($null -ne $Row.Operation) { $Row.Operation } else { $null }
  $timeOfDay = if ($null -ne $Row.time_of_day) { $Row.time_of_day } elseif ($null -ne $Row.'Time of Day') { $Row.'Time of Day' } else { $null }
  $matches = [regex]::Matches($path, $regex)

  foreach ($match in $matches) {
    [pscustomobject]@{
      clsid = $match.Value.ToUpperInvariant()
      process_name = $processName
      operation = $operation
      path = $path
      time_of_day = $timeOfDay
    }
  }
}

$regex = '\{[0-9A-Fa-f-]{36}\}'
$hits = @()

if ($SummaryPath) {
  if (-not (Test-Path $SummaryPath)) {
    throw "Procmon summary JSON을 찾지 못했습니다: $SummaryPath"
  }

  $summary = Get-Content $SummaryPath -Raw | ConvertFrom-Json
  $groups = @()

  foreach ($propertyName in @('top_paths', 'registry_focus', 'file_focus', 'samples', 'startup_operations')) {
    if ($summary.PSObject.Properties.Name -contains $propertyName) {
      $groups += ,@($summary.$propertyName)
    }
  }

  if ($summary.PSObject.Properties.Name -contains 'first_non_profiling_by_process') {
    foreach ($processSummary in @($summary.first_non_profiling_by_process)) {
      if ($processSummary.PSObject.Properties.Name -contains 'samples') {
        $groups += ,@($processSummary.samples)
      }
    }
  }

  foreach ($group in $groups) {
    foreach ($row in $group) {
      $hits += @(Add-HitFromRow -Row $row)
    }
  }
} else {
  $rows = Import-Csv $CsvPath | Where-Object {
    $_.'Process Name' -match 'GameBar|Xbox|Widget' -and
    $_.Path -match $regex
  }

  $hits = foreach ($row in $rows) {
    Add-HitFromRow -Row $row
  }
}

$summary = [ordered]@{
  csv_path = if ($SummaryPath) { $null } else { $CsvPath }
  summary_path = $SummaryPath
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  total_hits = $hits.Count
  clsids = $hits |
    Group-Object clsid |
    Sort-Object Count -Descending |
    ForEach-Object {
      $clsid = $_.Name
      $clsidPath = "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid"
      $inProcServer32Path = Join-Path $clsidPath 'InProcServer32'
      $inProcHandler32Path = Join-Path $clsidPath 'InProcHandler32'
      $localServer32Path = Join-Path $clsidPath 'LocalServer32'

      [pscustomobject]@{
        clsid = $clsid
        hit_count = $_.Count
        default_name = Get-RegistryValueSafe -Path $clsidPath
        inproc_server32 = Get-RegistryValueSafe -Path $inProcServer32Path
        inproc_handler32 = Get-RegistryValueSafe -Path $inProcHandler32Path
        local_server32 = Get-RegistryValueSafe -Path $localServer32Path
        threading_model = @(
          Get-RegistryValueSafe -Path $inProcServer32Path -Name 'ThreadingModel'
          Get-RegistryValueSafe -Path $inProcHandler32Path -Name 'ThreadingModel'
        ) | Where-Object { $_ } | Select-Object -First 1
        packaged_com = @(
          Get-PackagedComClasses -Clsid $clsid
        )
        process_counts = @(
          $_.Group |
          Group-Object process_name |
          Sort-Object Count -Descending |
          ForEach-Object {
            [pscustomobject]@{
              process_name = $_.Name
              count = $_.Count
            }
          }
        )
        sample_paths = @(
          $_.Group |
          Select-Object -First 8 -ExpandProperty path
        )
      }
    }
}

$json = $summary | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $parent = Split-Path $OutputPath -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -Path $OutputPath -Value $json -Encoding UTF8
}

$json
