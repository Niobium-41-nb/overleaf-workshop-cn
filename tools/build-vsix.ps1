# Build an installable VSIX from the patched extension tree (no vsce / network needed).
#
#   pwsh -File tools/build-vsix.ps1
#
# Produces: overleaf-workshop-cn-<version>.vsix in the repository root.
# The extension tree under .\extension is copied verbatim; only the stale
# __metadata block that VS Code writes at install time is stripped.

$ErrorActionPreference = 'Stop'

$repo   = Split-Path -Parent $PSScriptRoot
$src    = Join-Path $repo 'extension'
$stage  = Join-Path $repo 'build\vsix'
$pkg    = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$out    = Join-Path $repo "overleaf-workshop-cn-$version.vsix"

Write-Host "packaging $($pkg.publisher).$($pkg.name)@$version"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'extension') -Force | Out-Null

# Copy the extension tree, then drop install-time bookkeeping from package.json.
Copy-Item (Join-Path $src '*') (Join-Path $stage 'extension') -Recurse -Force
$stagedPkgPath = Join-Path $stage 'extension\package.json'
node -e @"
const fs = require('fs');
const p = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
delete pkg.__metadata;
fs.writeFileSync(p, JSON.stringify(pkg, null, '\t') + '\n');
"@ $stagedPkgPath
if ($LASTEXITCODE -ne 0) { throw "failed to rewrite staged package.json" }

$description = 'Open Overleaf/ShareLaTex projects in VSCode, with full collaboration support. CN build: defaults to https://cn.overleaf.com.'
$tags = ($pkg.keywords + $pkg.contributes.languages.id) -join ','

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="$($pkg.name)" Version="$version" Publisher="$($pkg.publisher)" />
		<DisplayName>Overleaf Workshop</DisplayName>
		<Description xml:space="preserve">$description</Description>
		<Tags>$tags</Tags>
		<Categories>$($pkg.categories -join ',')</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="$($pkg.extensionKind -join ',')" />
			<Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
			<Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="$($pkg.repository.url)" />
			<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
		</Properties>
		<License>extension/LICENSE.txt</License>
		<Icon>extension/resources/icons/app_icon.png</Icon>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code"/>
	</Installation>
	<Dependencies/>
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/resources/icons/app_icon.png" Addressable="true" />
	</Assets>
</PackageManifest>
"@
function Write-Utf8NoBom([string]$path, [string]$text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Utf8NoBom (Join-Path $stage 'extension.vsixmanifest') $manifest

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="vsixmanifest" ContentType="text/xml" />
	<Default Extension="json" ContentType="application/json" />
	<Default Extension="js" ContentType="application/javascript" />
	<Default Extension="mjs" ContentType="application/javascript" />
	<Default Extension="cjs" ContentType="application/javascript" />
	<Default Extension="md" ContentType="text/markdown" />
	<Default Extension="txt" ContentType="text/plain" />
	<Default Extension="xml" ContentType="text/xml" />
	<Default Extension="html" ContentType="text/html" />
	<Default Extension="css" ContentType="text/css" />
	<Default Extension="svg" ContentType="image/svg+xml" />
	<Default Extension="png" ContentType="image/png" />
	<Default Extension="jpg" ContentType="image/jpeg" />
	<Default Extension="gif" ContentType="image/gif" />
	<Default Extension="ico" ContentType="image/x-icon" />
	<Default Extension="yml" ContentType="text/yaml" />
	<Default Extension="yaml" ContentType="text/yaml" />
	<Default Extension="map" ContentType="application/json" />
	<Default Extension="ttf" ContentType="font/ttf" />
	<Default Extension="woff" ContentType="font/woff" />
	<Default Extension="woff2" ContentType="font/woff2" />
	<Default Extension="wasm" ContentType="application/wasm" />
	<Default Extension="swf" ContentType="application/x-shockwave-flash" />
	<Default Extension="bin" ContentType="application/octet-stream" />
	<Override PartName="/extension.vsixmanifest" ContentType="text/xml" />
</Types>
'@
Write-Utf8NoBom (Join-Path $stage '[Content_Types].xml') $contentTypes

if (Test-Path $out) { Remove-Item $out -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $base = (Resolve-Path $stage).Path.TrimEnd('\') + '\'
    $files = Get-ChildItem $stage -Recurse -File
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($base.Length).Replace('\', '/')
        $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        try {
            $input = [System.IO.File]::OpenRead($file.FullName)
            try { $input.CopyTo($entryStream) } finally { $input.Dispose() }
        } finally { $entryStream.Dispose() }
    }
} finally { $zip.Dispose() }

$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "wrote $out ($size MB, $($files.Count) files)"

# Sanity check: manifest is the first entry, paths use forward slashes.
$verify = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
    $names = $verify.Entries | ForEach-Object { $_.FullName }
    $bad = $names | Where-Object { $_ -match '\\' }
    if ($bad) { throw "backslash entry names found: $($bad[0])" }
    if (-not ($names -contains 'extension.vsixmanifest')) { throw 'missing extension.vsixmanifest' }
    if (-not ($names -contains '[Content_Types].xml')) { throw 'missing [Content_Types].xml' }
    if (-not ($names -contains 'extension/package.json')) { throw 'missing extension/package.json' }
    Write-Host "verified: $($names.Count) entries, manifest present, paths normalized"
} finally { $verify.Dispose() }
