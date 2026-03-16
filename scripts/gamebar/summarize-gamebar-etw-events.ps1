param(
  [Parameter(Mandatory = $true)]
  [string]$EtlPath,
  [string]$OutputPath,
  [int]$TopCount = 80
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EtlPath)) {
  throw "ETL을 찾지 못했습니다: $EtlPath"
}

function Get-EventXmlData {
  param(
    [System.Diagnostics.Eventing.Reader.EventRecord]$EventRecord
  )

  try {
    $xml = [xml]$EventRecord.ToXml()
    $items = @()

    foreach ($node in $xml.Event.EventData.Data) {
      $items += [pscustomobject]@{
        name = [string]$node.Name
        value = [string]$node.'#text'
      }
    }

    return $items
  }
  catch {
    return @()
  }
}

$events = @(Get-WinEvent -Oldest -Path $EtlPath)

$normalized = @(
  $events | ForEach-Object {
    $dataItems = @(Get-EventXmlData -EventRecord $_)

    [pscustomobject]@{
      provider = [string]$_.ProviderName
      event_id = [int]$_.Id
      task = [int]$_.Task
      opcode = [int]$_.Opcode
      level = [int]$_.Level
      process_id = [int]$_.ProcessId
      thread_id = [int]$_.ThreadId
      time_created = if ($_.TimeCreated) { $_.TimeCreated.ToString('o') } else { $null }
      data = $dataItems
    }
  }
)

$processNames = @{}
foreach ($pidValue in ($normalized.process_id | Sort-Object -Unique)) {
  try {
    $processNames[[string]$pidValue] = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName
  }
  catch {
    $processNames[[string]$pidValue] = $null
  }
}

$topProviderEvents = @(
  $normalized |
    Group-Object provider, event_id, task, opcode |
    Sort-Object Count -Descending |
    Select-Object -First $TopCount |
    ForEach-Object {
      $first = $_.Group | Select-Object -First 1
      [pscustomobject]@{
        provider = $first.provider
        event_id = $first.event_id
        task = $first.task
        opcode = $first.opcode
        count = $_.Count
      }
    }
)

$sampleData = @(
  $topProviderEvents | ForEach-Object {
    $providerName = $_.provider
    $eventId = $_.event_id
    $taskId = $_.task
    $opcodeId = $_.opcode

    $sample = $normalized |
      Where-Object {
        $_.provider -eq $providerName -and
        $_.event_id -eq $eventId -and
        $_.task -eq $taskId -and
        $_.opcode -eq $opcodeId
      } |
      Select-Object -First 1

    [pscustomobject]@{
      provider = $providerName
      event_id = $eventId
      task = $taskId
      opcode = $opcodeId
      sample_process_id = if ($sample) { $sample.process_id } else { $null }
      sample_process_name = if ($sample) { $processNames[[string]$sample.process_id] } else { $null }
      sample_data = if ($sample) { $sample.data } else { @() }
    }
  }
)

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  etl_path = $EtlPath
  total_events = $normalized.Count
  process_names = $processNames
  provider_counts = @(
    $normalized |
      Group-Object provider |
      Sort-Object Count -Descending |
      ForEach-Object {
        [pscustomobject]@{
          provider = $_.Name
          count = $_.Count
        }
      }
  )
  provider_process_counts = @(
    $normalized |
      Group-Object provider, process_id |
      Sort-Object Count -Descending |
      Select-Object -First $TopCount |
      ForEach-Object {
        $first = $_.Group | Select-Object -First 1
        [pscustomobject]@{
          provider = $first.provider
          process_id = $first.process_id
          process_name = $processNames[[string]$first.process_id]
          count = $_.Count
        }
      }
  )
  provider_event_counts = $topProviderEvents
  provider_event_samples = $sampleData
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
