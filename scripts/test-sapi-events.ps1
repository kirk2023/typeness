Add-Type -AssemblyName System.Speech

$logFile = 'd:\record\app-dev\typeness\scripts\sapi-event-test.log'
Clear-Content -Path $logFile -ErrorAction SilentlyContinue

function Log($msg) {
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    Add-Content -Path $logFile -Value ('[' + $ts + '] ' + $msg) -Encoding UTF8
}

Log 'Creating engine...'
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
$engine.SetInputToDefaultAudioDevice()

$resultQueue = [System.Collections.Concurrent.BlockingCollection[string]]::new()

$hypoSub = Register-ObjectEvent -InputObject $engine -EventName 'SpeechHypothesized' -Action {
    $text = $Event.SourceEventArgs.Result.Text
    if ($text) {
        $Event.MessageData.Add('[HYPO] ' + $text)
    }
} -MessageData $resultQueue

$recoSub = Register-ObjectEvent -InputObject $engine -EventName 'SpeechRecognized' -Action {
    $text = $Event.SourceEventArgs.Result.Text
    $Event.MessageData.Add('[RECO] ' + $text)
} -MessageData $resultQueue

Log 'Starting recognition (10 seconds)...'
$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

# Poll for results while waiting
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
while ($stopwatch.ElapsedMilliseconds -lt 10000) {
    $item = $null
    if ($resultQueue.TryTake([ref]$item, 200)) {
        Log $item
    }
}

$engine.RecognizeAsyncStop()
Start-Sleep -Milliseconds 500

# Drain remaining
while ($resultQueue.Count -gt 0) {
    $item = $null
    if ($resultQueue.TryTake([ref]$item, 0)) {
        Log $item
    }
}

Log 'Done.'
$engine.Dispose()

Unregister-Event -SourceIdentifier $hypoSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $recoSub.Name -ErrorAction SilentlyContinue

Get-Content $logFile
