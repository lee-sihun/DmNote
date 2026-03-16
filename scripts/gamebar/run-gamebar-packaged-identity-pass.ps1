$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactRoot = Join-Path $PSScriptRoot "..\..\docs\artifacts"
$artifactRoot = [System.IO.Path]::GetFullPath($artifactRoot)
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$pythonScript = Join-Path $PSScriptRoot "probe_packaged_identity_frida.py"

$targets = @(
    @{ ProcessName = "GameBar.exe"; Label = "IGameConfigStoreFT"; OutputName = "gamebar-gameconfigstore-$timestamp.json" },
    @{ ProcessName = "GameBar.exe"; Label = "IInputFocusTrackerFT"; OutputName = "gamebar-inputfocus-$timestamp.json" },
    @{ ProcessName = "GameBarFTServer.exe"; Label = "IWindowManagerFT"; OutputName = "gamebar-ftserver-windowmanager-$timestamp.json" }
)

$outputs = @()

foreach ($target in $targets) {
    $outputPath = Join-Path $artifactRoot $target.OutputName
    $success = $false

    foreach ($attempt in 1..3) {
        Get-Process GameBar,GameBarFTServer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Start-Process "ms-gamebar:"
        Start-Sleep -Seconds 6

        python $pythonScript `
            --process-name $target.ProcessName `
            --output $outputPath `
            --wait-seconds 15 `
            --probe-labels $target.Label | Out-Host

        if (Test-Path $outputPath) {
            try {
                $parsed = Get-Content $outputPath -Raw | ConvertFrom-Json
                if ($null -ne $parsed.result) {
                    $success = $true
                    break
                }
            } catch {
            }
        }
    }

    if (-not $success) {
        Write-Warning ("probe failed after retries: {0} / {1}" -f $target.ProcessName, $target.Label)
    }

    $outputs += $outputPath
}

$outputs
