# Test sapi-recognize.ps1 communication protocol
# 1. Start the script
# 2. Wait for "ready" signal
# 3. Send "start" command
# 4. Listen for 8 seconds
# 5. Send "stop" command
# 6. Report results

$scriptPath = "d:\record\app-dev\typeness\scripts\sapi-recognize.ps1"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-ExecutionPolicy Bypass -File `"$scriptPath`""
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8

$proc = [System.Diagnostics.Process]::Start($psi)

Write-Host "Process started (PID: $($proc.Id))"

# Read first line (should be "ready")
$readyLine = $proc.StandardOutput.ReadLine()
Write-Host "Ready signal: $readyLine"

# Send start command
$proc.StandardInput.WriteLine('{"cmd":"start"}')
$proc.StandardInput.Flush()
Write-Host "Sent start command"

# Read lines for 8 seconds in a loop
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$lines = @()
while ($stopwatch.ElapsedMilliseconds -lt 8000) {
    if ($proc.StandardOutput.Peek() -gt 0) {
        $line = $proc.StandardOutput.ReadLine()
        $lines += $line
        Write-Host "[${stopwatch.ElapsedMilliseconds}ms] $line"
    } else {
        Start-Sleep -Milliseconds 100
    }
}

# Send stop command
$proc.StandardInput.WriteLine('{"cmd":"stop"}')
$proc.StandardInput.Flush()
Write-Host "Sent stop command"

# Read any remaining lines
Start-Sleep -Milliseconds 500
while ($proc.StandardOutput.Peek() -gt 0) {
    $line = $proc.StandardOutput.ReadLine()
    $lines += $line
    Write-Host "[remaining] $line"
}

# Kill process
$proc.Kill()

Write-Host "`n=== Summary ==="
Write-Host "Total output lines: $($lines.Count)"
Write-Host "Test complete."
