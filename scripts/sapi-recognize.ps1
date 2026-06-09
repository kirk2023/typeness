# Windows SAPI Speech Recognition via PowerShell
# Protocol: JSON lines on stdout, JSON commands on stdin

Add-Type -AssemblyName System.Speech

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# --- Shared state (must be global for thread access) ---
$Global:cmdQueue = [System.Collections.Concurrent.BlockingCollection[string]]::new()
$Global:resultQueue = [System.Collections.Concurrent.BlockingCollection[string]]::new()

# --- Create recognition engine ---
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
$engine.SetInputToDefaultAudioDevice()

# Reduce silence timeouts for faster response
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2)   # Max initial silence (default ~5s)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(2)           # Max unintelligible speech (default ~5s)
$engine.EndSilence = [TimeSpan]::FromMilliseconds(150)       # Silence after speech to finalize
$engine.EndSilenceAmbiguous = [TimeSpan]::FromMilliseconds(500)  # Ambiguous silence

# --- Register events using Register-ObjectEvent ---
$hypoSub = Register-ObjectEvent -InputObject $engine -EventName 'SpeechHypothesized' -Action {
    $text = $Event.SourceEventArgs.Result.Text
    if ($text) {
        $json = @{type='partial'; text=$text} | ConvertTo-Json -Compress
        $Event.MessageData.Add($json)
    }
} -MessageData $Global:resultQueue

$recoSub = Register-ObjectEvent -InputObject $engine -EventName 'SpeechRecognized' -Action {
    $text = $Event.SourceEventArgs.Result.Text
    $conf = [math]::Round($Event.SourceEventArgs.Result.Confidence, 3)
    if ($text) {
        $json = @{type='final'; text=$text; confidence=$conf} | ConvertTo-Json -Compress
        $Event.MessageData.Add($json)
    }
} -MessageData $Global:resultQueue

$rejectSub = Register-ObjectEvent -InputObject $engine -EventName 'SpeechRecognitionRejected' -Action {
    $text = $Event.SourceEventArgs.Result.Text
    if ($text) {
        $json = @{type='rejected'; text=$text} | ConvertTo-Json -Compress
        $Event.MessageData.Add($json)
    }
} -MessageData $Global:resultQueue

# --- Start stdin reader using Start-Job alternative: Runspace ---
$stdinRunspace = [runspacefactory]::CreateRunspace()
$stdinRunspace.Open()
$stdinRunspace.SessionStateProxy.SetVariable('cmdQueue', $Global:cmdQueue)

$stdinPS = [powershell]::Create().AddScript({
    param($cmdQueue)
    try {
        while ($true) {
            $line = [Console]::ReadLine()
            if ($null -eq $line) {
                $cmdQueue.Add('EXIT')
                break
            }
            $cmdQueue.Add($line)
        }
    } catch {
        $cmdQueue.Add('EXIT')
    }
}).AddArgument($Global:cmdQueue)
$stdinPS.Runspace = $stdinRunspace
$stdinHandle = $stdinPS.BeginInvoke()

# Signal ready
$readyJson = @{type='ready'} | ConvertTo-Json -Compress
[Console]::WriteLine($readyJson)
[Console]::Out.Flush()

# --- Main loop ---
$recognizing = $false

while ($true) {
    # Drain result queue (non-blocking)
    $drained = 0
    while ($Global:resultQueue.Count -gt 0 -and $drained -lt 20) {
        $json = $null
        if ($Global:resultQueue.TryTake([ref]$json, 0)) {
            [Console]::WriteLine($json)
            [Console]::Out.Flush()
            $drained++
        }
    }

    # Check for commands (100ms timeout to allow draining results)
    $cmd = $null
    if ($Global:cmdQueue.TryTake([ref]$cmd, 100)) {
        if ($cmd -eq 'EXIT') {
            if ($recognizing) {
                $engine.RecognizeAsyncStop()
                $recognizing = $false
            }
            break
        }

        try {
            $parsed = $cmd | ConvertFrom-Json

            switch ($parsed.cmd) {
                'start' {
                    if (-not $recognizing) {
                        $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
                        $recognizing = $true
                        $json = @{type='started'} | ConvertTo-Json -Compress
                        [Console]::WriteLine($json)
                        [Console]::Out.Flush()
                    }
                }
                'stop' {
                    if ($recognizing) {
                        $engine.RecognizeAsyncStop()
                        $recognizing = $false
                        $json = @{type='stopped'} | ConvertTo-Json -Compress
                        [Console]::WriteLine($json)
                        [Console]::Out.Flush()
                    }
                }
            }
        } catch {
            $errMsg = $_.Exception.Message
            $json = @{type='error'; error=$errMsg} | ConvertTo-Json -Compress
            [Console]::WriteLine($json)
            [Console]::Out.Flush()
        }
    }
}

# Cleanup
Unregister-Event -SourceIdentifier $hypoSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $recoSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $rejectSub.Name -ErrorAction SilentlyContinue
$stdinPS.Stop()
$stdinPS.Dispose()
$stdinRunspace.Close()
$engine.Dispose()
$Global:cmdQueue.Dispose()
$Global:resultQueue.Dispose()
