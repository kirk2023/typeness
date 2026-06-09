Add-Type -AssemblyName System.Speech

$logFile = 'd:\record\app-dev\typeness\scripts\sapi-wav-test.log'

function Log($msg) {
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    Add-Content -Path $logFile -Value ('[' + $ts + '] ' + $msg) -Encoding UTF8
}

Clear-Content -Path $logFile -ErrorAction SilentlyContinue

Log '=== Step 1: Create test WAV with TTS ==='
$wavPath = 'd:\record\app-dev\typeness\scripts\test-tts.wav'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($wavPath)
$synth.Speak('Hello world this is a test of speech recognition')
$synth.Dispose()
Log ('TTS WAV created: ' + $wavPath)

Log '=== Step 2: Recognize from WAV file ==='
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
$engine.SetInputToWaveFile($wavPath)

$engine.add_SpeechHypothesized({
    param($s, $e)
    Log ('[HYPO] ' + $e.Result.Text)
})

$engine.add_SpeechRecognized({
    param($s, $e)
    $t = $e.Result.Text
    $c = [math]::Round($e.Result.Confidence, 3)
    Log ('[RECO] ' + $t + ' conf=' + $c)
})

$completed = New-Object System.Threading.ManualResetEvent($false)
$engine.add_RecognizeCompleted({
    param($s, $e)
    Log ('[COMPLETED] Error=' + $e.Error + ' Cancelled=' + $e.Cancelled)
    $completed.Set()
})

Log 'Starting recognition from WAV...'
$engine.RecognizeAsync()
$completed.WaitOne(10000) | Out-Null

Log 'Done.'
$engine.Dispose()

Get-Content $logFile
