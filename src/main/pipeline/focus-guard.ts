import { spawn } from 'child_process'
import { app } from 'electron'
import * as path from 'path'

/**
 * 前台窗口保护：会话开始时记录用户当时所在的窗口（如微信输入框），
 * 粘贴输出前若焦点被弹窗等抢走，先把焦点还给原窗口再粘贴。
 */

export interface ForegroundWindow {
  hwnd: string
  title: string
}

function scriptPath(name: string): string {
  // dev: 项目根/scripts；打包后: resources/scripts
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(app.getAppPath(), 'scripts')
  return path.join(dir, name)
}

function runPowerShell(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, ...args,
    ], { windowsHide: true })

    let out = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already exited */ }
      finish(() => reject(new Error('PowerShell 超时')))
    }, 5000)

    child.stdout!.on('data', (d: Buffer) => { out += d.toString('utf-8') })
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => finish(() => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`PowerShell 退出码 ${code}`))
    }))
  })
}

export async function recordForegroundWindow(): Promise<ForegroundWindow | null> {
  try {
    const out = await runPowerShell(scriptPath('focus-record.ps1'))
    const sep = out.indexOf('|')
    if (sep <= 0) return null
    const hwnd = out.slice(0, sep)
    if (!/^\d+$/.test(hwnd) || Number(hwnd) === 0) return null
    const title = out.slice(sep + 1)
    console.log(`[FocusGuard] 会话目标窗口: "${title}"`)
    return { hwnd, title }
  } catch (err) {
    console.warn('[FocusGuard] 记录前台窗口失败:', err)
    return null
  }
}

export async function restoreForegroundIfChanged(target: ForegroundWindow): Promise<void> {
  try {
    const result = await runPowerShell(scriptPath('focus-restore.ps1'), ['-Hwnd', target.hwnd])
    if (result === 'restored') {
      console.log(`[FocusGuard] 前台窗口被抢占，已恢复焦点到: "${target.title}"`)
      // 等目标窗口完成焦点切换，避免粘贴太快又落到旧窗口
      await new Promise((r) => setTimeout(r, 250))
    } else if (result === 'failed') {
      console.warn(`[FocusGuard] 恢复焦点失败，文本可能粘贴到当前前台窗口`)
    }
    // same / gone：无需处理
  } catch (err) {
    console.warn('[FocusGuard] 恢复前台窗口失败:', err)
  }
}
