param(
  [string]$PackageName = 'Microsoft.XboxGamingOverlay',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-SingleValue {
  param(
    [System.Xml.XmlNodeList]$Nodes
  )

  if (-not $Nodes) {
    return $null
  }

  $node = $Nodes | Select-Object -First 1
  if (-not $node) {
    return $null
  }

  return $node.InnerText
}

$pkg = Get-AppxPackage $PackageName | Select-Object -First 1
if (-not $pkg) {
  throw "패키지를 찾지 못했습니다: $PackageName"
}

$manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
if (-not (Test-Path $manifestPath)) {
  throw "AppxManifest.xml을 찾지 못했습니다: $manifestPath"
}

[xml]$manifest = Get-Content $manifestPath
$ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
$ns.AddNamespace('pkg', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
$ns.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$ns.AddNamespace('desktop', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10')
$ns.AddNamespace('desktop6', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10/6')
$ns.AddNamespace('com', 'http://schemas.microsoft.com/appx/manifest/com/windows10')
$ns.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
$ns.AddNamespace('wincap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/windowscapabilities')
$ns.AddNamespace('build', 'http://schemas.microsoft.com/developer/appx/2015/build')

$identity = $manifest.SelectSingleNode('/pkg:Package/pkg:Identity', $ns)
$application = $manifest.SelectSingleNode('/pkg:Package/pkg:Applications/pkg:Application', $ns)

$summary = [ordered]@{
  analyzed_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  package = [ordered]@{
    full_name = $pkg.PackageFullName
    install_location = $pkg.InstallLocation
    architecture = $pkg.Architecture.ToString()
    version = $pkg.Version
    identity_name = $identity.Name
    publisher = $identity.Publisher
    executable = $application.Executable
    entry_point = $application.EntryPoint
    display_name = Get-SingleValue ($manifest.SelectNodes('/pkg:Package/pkg:Properties/pkg:DisplayName', $ns))
    publisher_display_name = Get-SingleValue ($manifest.SelectNodes('/pkg:Package/pkg:Properties/pkg:PublisherDisplayName', $ns))
  }
  dependencies = @(
    $manifest.SelectNodes('/pkg:Package/pkg:Dependencies/*', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          element = $_.LocalName
          name = $_.GetAttribute('Name')
          min_version = $_.GetAttribute('MinVersion')
          max_version_tested = $_.GetAttribute('MaxVersionTested')
          publisher = $_.GetAttribute('Publisher')
        }
      }
  )
  protocols = @(
    $manifest.SelectNodes('//uap:Extension[@Category="windows.protocol"]/uap:Protocol', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.GetAttribute('Name')
        }
      }
  )
  com_servers = @(
    $manifest.SelectNodes('//com:Extension[@Category="windows.comServer"]//com:ExeServer', $ns) |
      ForEach-Object {
        $exeServer = $_
        [pscustomobject]@{
          executable = $exeServer.GetAttribute('Executable')
          launch_permission = $exeServer.GetAttribute('LaunchAndActivationPermission')
          classes = @(
            $exeServer.SelectNodes('./com:Class', $ns) |
              ForEach-Object {
                [pscustomobject]@{
                  id = $_.GetAttribute('Id')
                  display_name = $_.GetAttribute('DisplayName')
                }
              }
          )
        }
      }
  )
  app_execution_aliases = @(
    $manifest.SelectNodes('//uap3:Extension[@Category="windows.appExecutionAlias"]', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          executable = $_.GetAttribute('Executable')
          entry_point = $_.GetAttribute('EntryPoint')
          aliases = @(
            $_.SelectNodes('.//desktop:ExecutionAlias', $ns) |
              ForEach-Object { $_.GetAttribute('Alias') }
          )
        }
      }
  )
  app_extension_hosts = @(
    $manifest.SelectNodes('//uap3:Extension[@Category="windows.appExtensionHost"]//uap3:Name', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.InnerText
        }
      }
  )
  proxy_stubs = @(
    $manifest.SelectNodes('//pkg:Extension[@Category="windows.activatableClass.proxyStub"]/pkg:ProxyStub', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          class_id = $_.GetAttribute('ClassId')
          path = Get-SingleValue ($_.SelectNodes('./pkg:Path', $ns))
          interface_count = @($_.SelectNodes('./pkg:Interface', $ns)).Count
          widget_host_interfaces = @(
            $_.SelectNodes('./pkg:Interface', $ns) |
              Where-Object { $_.GetAttribute('Name') -match 'WidgetHost|WidgetPrivate|AppTargetInfo' } |
              ForEach-Object {
                [pscustomobject]@{
                  name = $_.GetAttribute('Name')
                  interface_id = $_.GetAttribute('InterfaceId')
                }
              }
          )
        }
      }
  )
  inprocess_servers = @(
    $manifest.SelectNodes('//pkg:Extension[@Category="windows.activatableClass.inProcessServer"]/pkg:InProcessServer', $ns) |
      ForEach-Object {
        $server = $_
        [pscustomobject]@{
          path = Get-SingleValue ($server.SelectNodes('./pkg:Path', $ns))
          activatable_class_count = @($server.SelectNodes('./pkg:ActivatableClass', $ns)).Count
          sample_classes = @(
            $server.SelectNodes('./pkg:ActivatableClass', $ns) |
              Select-Object -First 12 |
              ForEach-Object { $_.GetAttribute('ActivatableClassId') }
          )
        }
      }
  )
  capabilities = @(
    $manifest.SelectNodes('/pkg:Package/pkg:Capabilities/*', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          element = $_.LocalName
          name = $_.GetAttribute('Name')
        }
      }
  )
  build_metadata = @(
    $manifest.SelectNodes('/pkg:Package/build:Metadata/build:Item', $ns) |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.GetAttribute('Name')
          version = $_.GetAttribute('Version')
        }
      }
  )
  package_files = @(
    Get-ChildItem $pkg.InstallLocation |
      Sort-Object Name |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.Name
          is_directory = $_.PSIsContainer
          length = if ($_.PSIsContainer) { $null } else { $_.Length }
        }
      }
  )
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
