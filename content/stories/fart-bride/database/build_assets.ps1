$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dbPath = Join-Path $root 'database\story_database.json'

function Get-WavDuration([string]$path) {
    $fs = [System.IO.File]::OpenRead($path)
    try {
        $br = New-Object System.IO.BinaryReader($fs)
        if ([System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4)) -ne 'RIFF') { return $null }
        $null = $br.ReadUInt32()
        if ([System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4)) -ne 'WAVE') { return $null }
        $byteRate = $null; $dataSize = $null
        while ($fs.Position -le $fs.Length - 8) {
            $chunkId = [System.Text.Encoding]::ASCII.GetString($br.ReadBytes(4))
            $chunkSize = $br.ReadUInt32()
            if ($chunkId -eq 'fmt ') {
                $fmtStart = $fs.Position
                $null = $br.ReadUInt16(); $null = $br.ReadUInt16(); $null = $br.ReadUInt32()
                $byteRate = $br.ReadUInt32()
                $fs.Position = $fmtStart + $chunkSize
            } elseif ($chunkId -eq 'data') {
                $dataSize = $chunkSize
                break
            } else {
                $fs.Position += $chunkSize
            }
            if ($chunkSize % 2 -eq 1) { $fs.Position += 1 }
        }
        if ($byteRate -and $dataSize) { return [math]::Round($dataSize / $byteRate, 2) }
        return $null
    } finally { $fs.Dispose() }
}

function Get-PngSize([string]$path) {
    $fs = [System.IO.File]::OpenRead($path)
    try {
        $buf = New-Object byte[] 33
        $null = $fs.Read($buf, 0, 33)
        $w = ([int]$buf[16] -shl 24) -bor ([int]$buf[17] -shl 16) -bor ([int]$buf[18] -shl 8) -bor [int]$buf[19]
        $h = ([int]$buf[20] -shl 24) -bor ([int]$buf[21] -shl 16) -bor ([int]$buf[22] -shl 8) -bor [int]$buf[23]
        return @($w, $h)
    } finally { $fs.Dispose() }
}

$db = Get-Content $dbPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable

# --- collect audio filenames referenced by scenes, mapped to scene id ---
$audioUse = @{}
$imageUse = @{}
foreach ($scene in $db.scenes) {
    if ($scene.type -eq 'linear') {
        $imageUse[$scene.image] = $scene.id
        foreach ($l in $scene.lines) { $audioUse[$l.audio] = $scene.id }
    } else {
        foreach ($p in $scene.phases) {
            if ($p.ContainsKey('image')) { $imageUse[$p.image] = $scene.id }
            if ($p.ContainsKey('lines')) { foreach ($l in $p.lines) { $audioUse[$l.audio] = $scene.id } }
        }
    }
}

# --- build image table ---
$images = [ordered]@{}
Get-ChildItem (Join-Path $root 'source\image') -Filter *.png | Sort-Object Name | ForEach-Object {
    $size = Get-PngSize $_.FullName
    $images[$_.Name] = [ordered]@{
        path             = "source/image/$($_.Name)"
        width            = $size[0]
        height           = $size[1]
        needsReplacement = $_.Name.Contains('이미지 교체 필요')
        usedByScene      = if ($imageUse.ContainsKey($_.Name)) { $imageUse[$_.Name] } else { $null }
    }
}

# --- build audio table ---
$audio = [ordered]@{}
Get-ChildItem (Join-Path $root 'source\sound') -Filter *.wav | Sort-Object Name | ForEach-Object {
    $audio[$_.Name] = [ordered]@{
        path        = "source/sound/$($_.Name)"
        durationSec = Get-WavDuration $_.FullName
        usedByScene = if ($audioUse.ContainsKey($_.Name)) { $audioUse[$_.Name] } else { $null }
    }
}

$db.assets = [ordered]@{ images = $images; audio = $audio }

# --- validate: every referenced file must exist ---
$missing = @()
foreach ($f in $audioUse.Keys) { if (-not $audio.Contains($f)) { $missing += "audio: $f (scene $($audioUse[$f]))" } }
foreach ($f in $imageUse.Keys) { if (-not $images.Contains($f)) { $missing += "image: $f (scene $($imageUse[$f]))" } }

$json = $db | ConvertTo-Json -Depth 12
# un-escape non-ASCII \uXXXX sequences so Korean stays readable
$json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', {
    param($m)
    $code = [Convert]::ToInt32($m.Groups[1].Value, 16)
    if ($code -ge 0x80) { [string][char]$code } else { $m.Value }
})
[System.IO.File]::WriteAllText($dbPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "images: $($images.Count), audio: $($audio.Count)"
Write-Host "unused audio files: $(($audio.Keys | Where-Object { $null -eq $audio[$_].usedByScene }).Count)"
if ($missing.Count) { Write-Host "MISSING REFERENCES:"; $missing | ForEach-Object { Write-Host "  $_" } }
else { Write-Host "all scene references resolve to existing files: OK" }
$total = ($audio.Keys | Where-Object { $null -ne $audio[$_].usedByScene } | ForEach-Object { $audio[$_].durationSec } | Measure-Object -Sum).Sum
Write-Host "total narration duration (used takes): $([math]::Round($total,1)) sec"
