Add-Type -AssemblyName System.Speech

# List installed recognizers
Write-Host "=== Installed Speech Recognizers ==="
$recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
foreach ($r in $recognizers) {
    Write-Host "ID: $($r.Id) - $($r.Description) - Culture: $($r.Culture)"
}

if ($recognizers.Count -eq 0) {
    Write-Host "ERROR: No speech recognizers installed!"
    exit 1
}

# Test creating engine
try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    Write-Host "`n=== SpeechRecognitionEngine created successfully ==="
    Write-Host "Grammar: DictationGrammar loaded OK"
    $engine.Dispose()
    Write-Host "Test PASSED"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}
