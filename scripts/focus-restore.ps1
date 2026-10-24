param([long]$Hwnd)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 若前台窗口不是目标窗口，则把焦点还给目标窗口（粘贴前调用，防止弹窗抢焦点导致文字粘错地方）
# 输出: same=焦点未变 / restored=已恢复 / gone=目标窗口已关闭 / failed=恢复失败
Add-Type -Namespace T -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
'@
$target = [IntPtr]::new($Hwnd)
if (-not [T.W]::IsWindow($target)) { Write-Output 'gone'; exit }
$fg = [T.W]::GetForegroundWindow()
if ($fg -eq $target) { Write-Output 'same'; exit }

# SetForegroundWindow 有前台锁定限制，用 AttachThreadInput 绕过（不注入按键，无副作用）
$me = [T.W]::GetCurrentThreadId()
$fgPid = [uint32]0
$fgThread = [T.W]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$tPid = [uint32]0
$tThread = [T.W]::GetWindowThreadProcessId($target, [ref]$tPid)
[void][T.W]::AttachThreadInput($me, $fgThread, $true)
[void][T.W]::AttachThreadInput($me, $tThread, $true)
$ok = [T.W]::SetForegroundWindow($target)
[void][T.W]::AttachThreadInput($me, $fgThread, $false)
[void][T.W]::AttachThreadInput($me, $tThread, $false)

if ($ok -and [T.W]::GetForegroundWindow() -eq $target) { Write-Output 'restored' } else { Write-Output 'failed' }
