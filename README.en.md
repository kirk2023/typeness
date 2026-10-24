# Typeness — Voice Dictation Input Method

> [English](README.en.md) | [简体中文](README.md)

Speak into your microphone; Typeness removes verbal filler and reorganizes your speech into clean written text, then types it directly at your cursor position. Built on fully local speech recognition (sherpa-onnx) plus a configurable LLM text polisher, it runs as a background tray app on Windows.

## Features

- **Session-based dictation**: Press the hotkey to start, press again to finish (or let auto-stop handle it). Everything you said is polished by the AI in one pass and output in a single action — not fragmented sentence by sentence
- **Live scrolling transcript**: While you speak, the floating bubble shows a rolling transcript (gray = in progress, white = finalized), then streams the polished result as the LLM works
- **Two polish modes**:
  - *Light cleanup* — strips filler words, repetitions and self-corrections while preserving your original sentences; ideal as an everyday input method
  - *Summarize & reorganize* — allowed to merge and restructure; ideal for long dictations
- **Local-first**: Speech recognition runs fully offline (SenseVoice for accuracy + zipformer for live captions). If the LLM is unreachable, it degrades to a local rule-based cleaner
- **Engine fallback**: Falls back to Windows SAPI automatically if sherpa-onnx fails to initialize
- **Auto-stop**: Ends the session automatically after a configurable silence timeout (default 8s) once you have said something
- **Self-maintenance**: Old logs (14 days) and leftover portable-exe extraction directories are cleaned up automatically

## Install & Use

1. Download `Typeness-x.y.z-setup.exe` from [Releases](https://github.com/kirk2023/typeness/releases) (installer — lets you choose the install directory), or the `portable.exe` for a no-install run (the portable build self-extracts on every launch, so it starts slower; the installer is recommended for daily use)
2. The app lives in your system tray. Default hotkey: `Ctrl+Shift+Space` (configurable in Settings)
3. In Settings, enter your LLM API credentials (any OpenAI-compatible endpoint: Agnes / DeepSeek / LongCat / local Ollama — no key needed for Ollama)
4. Click into any input box → press the hotkey → speak → press the hotkey again (or stay silent) → the polished text is pasted at your cursor

Output uses a clipboard-paste strategy (most reliable for CJK text); your original clipboard content is restored right after pasting.

## Building from Source

Requirements: Node.js 18+, Windows 10/11 x64.

```bash
npm install

# Place recognition models under models/ (see below)
# models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/
# models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/

npm run dev            # development
npm run build:portable # builds portable.exe + setup.exe into release/
```

### Downloading recognition models

Model files are not included in this repository. Download them from the [sherpa-onnx releases page](https://github.com/k2-fsa/sherpa-onnx/releases) (or look them up by name in the [docs](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/)):

| Model | Purpose | Required files |
|---|---|---|
| `sherpa-onnx-sense-voice-zh-en-ja-ko-yue` | Accurate offline transcription (zh/en/ja/ko/yue) | `model.int8.onnx`, `tokens.txt` |
| `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` | Live streaming captions | `encoder/decoder/joiner-*.int8.onnx`, `tokens.txt` |

## Privacy

- Speech recognition runs entirely on your machine; audio is never uploaded
- The LLM step only sends recognized *text* to the API endpoint **you** configure
- Your API key and settings live only in `%APPDATA%\typeness\` on your machine and are never bundled into the installer

## Tech Stack

Electron + TypeScript + Vite · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (SenseVoice / zipformer) · Silero VAD ([@ricky0123/vad-web](https://github.com/ricky0123/vad-web)) · robotjs (input simulation)
