[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 输出当前前台窗口: "hwnd|窗口标题"
Add-Type -Namespace T -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
$h = [T.W]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][T.W]::GetWindowText($h, $sb, 256)
Write-Output ("{0}|{1}" -f $h.ToInt64(), $sb.ToString())
