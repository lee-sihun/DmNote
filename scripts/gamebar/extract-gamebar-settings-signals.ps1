param(
  [string]$SettingsPath = "$env:LOCALAPPDATA\Packages\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe\Settings\settings.dat",
  [string]$OutputPath = "C:\Users\esihun\Desktop\workfile\DmNote\docs\artifacts\gamebar-settings-signals-20260316.json"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SettingsPath)) {
  throw "settings.dat not found: $SettingsPath"
}

$parent = Split-Path $OutputPath -Parent
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

$text = Get-Content -Path $SettingsPath -Raw -Encoding Unicode

function Get-JsonSettingValue {
  param(
    [string]$Text,
    [string]$Key
  )

  $pattern = '"' + [Regex]::Escape($Key) + '":"(?<value>(?:\\.|[^"])*)"'
  $match = [Regex]::Match($Text, $pattern)
  if (-not $match.Success) {
    return $null
  }

  $value = $match.Groups['value'].Value
  return [Regex]::Unescape($value)
}

function Get-ScalarSettingValue {
  param(
    [string]$Text,
    [string]$Key
  )

  $pattern = '"' + [Regex]::Escape($Key) + '":(?<value>true|false|"-?[^"]*"|[0-9]+)'
  $match = [Regex]::Match($Text, $pattern)
  if (-not $match.Success) {
    return $null
  }

  $raw = $match.Groups['value'].Value
  if ($raw -eq 'true' -or $raw -eq 'false') {
    return ($raw -eq 'true')
  }

  if ($raw.StartsWith('"') -and $raw.EndsWith('"')) {
    return [Regex]::Unescape($raw.Trim('"'))
  }

  return [int64]$raw
}

$allowListRaw = Get-JsonSettingValue -Text $text -Key 'RESTRICTED-API-ALLOW-LIST'
$allowList = @()
$kglUrl = Get-JsonSettingValue -Text $text -Key 'KGLOneSettingsUri'
if (-not $kglUrl) {
  $kglUrl = [Regex]::Match($text, 'https://[^\u0000\s"]+').Value
}

if ($allowListRaw) {
  try {
    $allowJson = $allowListRaw | ConvertFrom-Json
    $allowList = @($allowJson.RestrictedApiAllowList)
  } catch {
    $allowList = @()
  }
}

$candidateAppIds = @(
  'f60d6f7e-5a38-4fbe-bb53-37ed4ec7d424_ws4vteaf97a5e_App_DmNoteOverlay',
  'Microsoft.Edge.GameAssist_8wekyb3d8bbwe_App',
  'Microsoft.TeamsXboxGameBarWidget_8wekyb3d8bbwe_App_TeamsWidget',
  '62269AlexShats.CrosshairZoom_gghb1w55myjr2_App_CrosshairZoomWidget'
)

$candidatePresence = foreach ($appId in $candidateAppIds) {
  [pscustomobject]@{
    app_id = $appId
    present_in_settings = $text.Contains($appId)
    present_in_allow_list = $allowList -contains $appId
  }
}

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  settings_path = $SettingsPath
  kgl_one_settings_uri = $kglUrl
  kgl_one_settings_version = Get-JsonSettingValue -Text $text -Key 'KGLOneSettingsVersion'
  kgl_one_settings_hash = Get-JsonSettingValue -Text $text -Key 'KGLOneSettingsHash'
  open_widget_menu_count = Get-ScalarSettingValue -Text $text -Key 'UA_OpenWidgetMenu_Count'
  open_widget_store_count = Get-ScalarSettingValue -Text $text -Key 'UA_OpenWidgetStore_Count'
  restricted_api_allow_list_raw = $allowListRaw
  restricted_api_allow_list = $allowList
  candidate_app_ids = $candidatePresence
}

$json = $summary | ConvertTo-Json -Depth 8
Set-Content -Path $OutputPath -Value $json -Encoding UTF8
$json
