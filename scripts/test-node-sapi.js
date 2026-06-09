// Debug test: spawn sapi-recognize.ps1 and log all stdout/stderr
const { spawn } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'sapi-recognize.ps1');
console.log('Script:', scriptPath);

const ps = spawn('powershell.exe', [
  '-ExecutionPolicy', 'Bypass',
  '-File', scriptPath,
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdoutBuf = '';
let lineCount = 0;

ps.stdout.on('data', (data) => {
  const raw = data.toString('utf-8');
  stdoutBuf += raw;
  console.log(`[STDOUT RAW ${data.length}b] ${JSON.stringify(raw)}`);
  
  const lines = stdoutBuf.split('\n').filter(l => l.trim());
  stdoutBuf = stdoutBuf.endsWith('\n') ? '' : (lines.pop() || '');
  
  for (const line of lines) {
    lineCount++;
    console.log(`[LINE ${lineCount}] ${line}`);
  }
});

ps.stderr.on('data', (data) => {
  console.log('[STDERR]', data.toString('utf-8').trim());
});

ps.on('exit', (code) => {
  console.log(`Process exited with code ${code}, total lines: ${lineCount}`);
});

ps.on('error', (err) => {
  console.error('Process error:', err);
});

// Wait for ready, then send start, wait 10s, send stop
setTimeout(() => {
  console.log('\n>>> Sending start command...');
  ps.stdin.write('{"cmd":"start"}\n');
}, 3000);

setTimeout(() => {
  console.log('\n>>> Sending stop command...');
  ps.stdin.write('{"cmd":"stop"}\n');
}, 13000);

setTimeout(() => {
  console.log('\n>>> Killing process...');
  ps.kill();
  process.exit(0);
}, 15000);
