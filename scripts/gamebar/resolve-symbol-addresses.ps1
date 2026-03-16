param(
  [Parameter(Mandatory = $true)]
  [string]$ModulePath,
  [Parameter(Mandatory = $true)]
  [UInt64[]]$Addresses,
  [UInt64]$BaseAddress = 0,
  [string]$SymbolPath = 'srv*C:\Users\esihun\Desktop\symbols*https://msdl.microsoft.com/download/symbols'
)

$ErrorActionPreference = 'Stop'

$dbhPath = 'C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\dbh.exe'
if (-not (Test-Path -LiteralPath $dbhPath)) {
  throw 'dbh.exe를 찾지 못했습니다.'
}

if (-not (Test-Path -LiteralPath $ModulePath)) {
  throw "모듈을 찾지 못했습니다: $ModulePath"
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $dbhPath
$psi.Arguments = "-s:$SymbolPath `"$ModulePath`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
$process.Start() | Out-Null

if ($BaseAddress -ne 0) {
  $process.StandardInput.WriteLine(('base 0x{0:x}' -f $BaseAddress))
}

foreach ($address in $Addresses) {
  $process.StandardInput.WriteLine(('addr 0x{0:x}' -f $address))
}

$process.StandardInput.WriteLine('q')
$process.StandardInput.Close()
$process.WaitForExit()

[pscustomobject]@{
  module_path = $ModulePath
  base_address = if ($BaseAddress -ne 0) { '0x{0:x}' -f $BaseAddress } else { $null }
  addresses = @($Addresses | ForEach-Object { '0x{0:x}' -f $_ })
  exit_code = $process.ExitCode
  stdout = $process.StandardOutput.ReadToEnd()
  stderr = $process.StandardError.ReadToEnd()
} | ConvertTo-Json -Depth 6
