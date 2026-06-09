# Simpler SAPI test - output to file for reliable capture
Add-Type -AssemblyName System.Speech

$logFile = "d:\record\app-dev\typeness\scripts\sapi-test-output.log"

function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss.fff"
    $line = "[$ts] $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

Clear-Content -Path $logFile -ErrorAction SilentlyContinue

Log "Creating SAPI engine..."

try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $engine.SetInputToDefaultAudioDevice()
    Log "Engine created and configured"
} catch {
    Log "ERROR creating engine: $($_.Exception.Message)"
    exit 1
}

$engine.add_SpeechHypothesized({
    param($s, $e)
    Log "[HYPO] $($e.Result.Text)"
})

$engine.add_SpeechRecognized({
    param($s, $e)
    Log "[RECO] $($e.Result.Text) conf=$([math]::Round($e.Result.Confidence, 3))"
})

$engine.add_SpeechRecognitionRejected({
    param($s, $e)
    Log "[REJECTED] $($e.Result.Text)"
})

$completed = New-Object System.Threading.ManualResetEvent($false)
$engine.add_RecognizeCompleted({
    param($s, $e)
    Log "[COMPLETED] Error=$($e.Error) Cancelled=$($e.Cancelled) InitialSilence=$($e.InitialSilenceTimeout)"
    $completed.Set()
})

$engine.add_AudioStateChanged({
    param($s, $e)
    Log "[AUDIO] State=$($e.AudioState)"
})

Log "Starting recognition..."
$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
Log "Recognition started! Speak for 10 seconds..."

Start-Sleep -Seconds 10

Log "Stopping recognition..."
$engine.RecognizeAsyncStop()
$completed.WaitOne(5000) | Out-Null

Log "Done."
$engine.Dispose()
