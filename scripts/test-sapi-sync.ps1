Add-Type -AssemblyName System.Speech

$wavPath = 'd:\record\app-dev\typeness\scripts\test-tts.wav'
Write-Host 'Creating engine...'
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)

Write-Host ('Setting input to WAV: ' + $wavPath)
$engine.SetInputToWaveFile($wavPath)

Write-Host 'Running synchronous recognition...'
try {
    $result = $engine.Recognize()
    if ($result) {
        Write-Host ('RESULT: ' + $result.Text + ' confidence=' + $result.Confidence)
    } else {
        Write-Host 'RESULT: null (no speech detected)'
    }
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message)
    Write-Host ('STACK: ' + $_.ScriptStackTrace)
}

$engine.Dispose()
Write-Host 'Done.'
