# Simpler SAPI test - single threaded, no stdin reader thread
Add-Type -AssemblyName System.Speech

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Write-Host "Creating SAPI engine..."
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
$engine.SetInputToDefaultAudioDevice()

$recognized = $false

$engine.add_SpeechHypothesized({
    param($s, $e)
    Write-Host "[HYPO] $($e.Result.Text)"
    [Console]::Out.Flush()
})

$engine.add_SpeechRecognized({
    param($s, $e)
    Write-Host "[RECO] $($e.Result.Text) conf=$($e.Result.Confidence)"
    $script:recognized = $true
    [Console]::Out.Flush()
})

# Use a Completed event to signal when we should stop
$completed = New-Object System.Threading.ManualResetEvent($false)

$engine.add_RecognizeCompleted({
    param($s, $e)
    Write-Host "[COMPLETED] Error=$($e.Error) Cancelled=$($e.Cancelled)"
    $completed.Set()
})

Write-Host "Starting recognition (Multiple mode)..."
$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
Write-Host "Recognition started! Speak now (8 seconds)..."

# Wait 8 seconds
Start-Sleep -Seconds 8

Write-Host "Stopping recognition..."
$engine.RecognizeAsyncStop()
$completed.WaitOne(3000) | Out-Null

Write-Host "Recognized anything: $recognized"
$engine.Dispose()
Write-Host "Done."
