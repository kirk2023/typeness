# Quick test: Start SAPI recognition, listen for 10 seconds, then stop
Add-Type -AssemblyName System.Speech

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=== SAPI Direct Test ==="
Write-Host "Creating engine..."

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
$engine.SetInputToDefaultAudioDevice()

Write-Host "Engine ready, starting recognition..."
Write-Host "SAY SOMETHING NOW (10 seconds)..."

$results = @()

$engine.add_SpeechHypothesized({
    param($s, $e)
    $text = $e.Result.Text
    Write-Host "[PARTIAL] $text"
    $script:results += $text
})

$engine.add_SpeechRecognized({
    param($s, $e)
    $text = $e.Result.Text
    $conf = $e.Result.Confidence
    Write-Host "[FINAL] $text (confidence: $conf)"
    $script:results += $text
})

$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

# Wait 10 seconds
Start-Sleep -Seconds 10

$engine.RecognizeAsyncStop()
Start-Sleep -Milliseconds 500

Write-Host "`n=== Results ==="
Write-Host "Total results: $($results.Count)"
foreach ($r in $results) {
    Write-Host "  - $r"
}

$engine.Dispose()
Write-Host "Done."
