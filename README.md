# Typeness — 语音听写输入法

对着麦克风说一段话，AI 自动去除口语冗余、整理成通顺文字，直接输入到光标所在位置。基于本地语音识别（sherpa-onnx）+ 可配置的 LLM 文本整理，Windows 桌面端常驻使用。

## 功能特性

- **会话式听写**：按一下快捷键开始、再按一下结束（也支持静音超时自动结束）；期间说的全部内容一次性交给 AI 整理后输出，而不是逐句碎片上屏
- **实时滚动字幕**：说话过程中悬浮气泡实时滚动显示识别文字（灰色=正在说，白色=已定稿），结束后流式展示 AI 整理结果
- **双整理模式**：
  - 轻度清理——只删语气词/重复/自我纠正，尽量保留原句，适合当输入法
  - 整理总结——允许归纳重组、去除绕圈子的话，适合长内容听写
- **本地优先**：语音识别完全离线（SenseVoice 精转 + zipformer 流式字幕），断网时 LLM 自动降级为本地规则清理
- **双引擎兜底**：sherpa-onnx 初始化失败时自动回退 Windows SAPI
- **自动停止**：说完内容后持续静音达到设定秒数（默认 8s，可配）自动结束会话并输出
- **自动清理**：过期日志（14 天）与 portable 版残留解压目录自动回收

## 安装与使用

1. 下载 [Releases](https://github.com/kirk2023/typeness/releases) 中的 `Typeness-x.y.z-setup.exe` 安装（支持自选安装目录），或 `portable.exe` 免安装运行（便携版每次启动需解压，启动较慢，日常使用推荐安装版）
2. 启动后托盘图标常驻，默认快捷键 `Ctrl+Shift+Space`（可在设置中修改）
3. 在设置中填入你的 LLM API（兼容 OpenAI 协议：Agnes / DeepSeek / LongCat / Ollama 等，或本地 Ollama 无需 Key）
4. 光标点到任意输入框 → 按快捷键 → 说话 → 再按快捷键（或安静等待自动停止）→ 整理后的文字自动粘贴到光标位置

输出方式为"剪贴板粘贴"（对中文最可靠），粘贴后自动恢复你原来的剪贴板内容。

## 从源码构建

环境要求：Node.js 18+、Windows 10/11 x64。

```bash
npm install

# 放置识别模型到 models/ 目录（见下方说明）
# models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/
# models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/

npm run dev            # 开发调试
npm run build:portable # 构建 portable.exe + setup.exe（输出在 release/）
```

### 识别模型下载

模型文件不包含在仓库中，需从 [sherpa-onnx 官方发布页](https://github.com/k2-fsa/sherpa-onnx/releases) 下载（也可在[文档](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/)按名称检索）：

| 模型 | 用途 | 需要的文件 |
|---|---|---|
| `sherpa-onnx-sense-voice-zh-en-ja-ko-yue` | 精确转写（中英日韩粤） | `model.int8.onnx`、`tokens.txt` |
| `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` | 实时流式字幕 | `encoder/decoder/joiner-*.int8.onnx`、`tokens.txt` |

## 隐私说明

- 语音识别全部在本地完成，音频不会上传
- LLM 整理仅将识别出的文本发送到**你自己配置**的 API 地址
- API Key 等配置只保存在本机 `%APPDATA%\typeness\`，不会随安装包分发

## 技术栈

Electron + TypeScript + Vite · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（SenseVoice / zipformer）· Silero VAD（[@ricky0123/vad-web](https://github.com/ricky0123/vad-web)）· robotjs（键入模拟）
