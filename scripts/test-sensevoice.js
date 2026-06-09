/**
 * Standalone SenseVoice test script.
 * Usage: node scripts/test-sensevoice.js [path-to-wav-file]
 *
 * If no WAV file is provided, generates a 3-second silent audio to verify model loading.
 */
const path = require('path')
const fs = require('fs')

const MODEL_DIR = path.join(__dirname, '..', 'models', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue')
const MODEL_FILE = path.join(MODEL_DIR, 'model.int8.onnx')
const TOKENS_FILE = path.join(MODEL_DIR, 'tokens.txt')

console.log('=== SenseVoice 独立测试 ===')
console.log(`模型目录: ${MODEL_DIR}`)
console.log(`模型文件: ${MODEL_FILE} (存在: ${fs.existsSync(MODEL_FILE)})`)
console.log(`Tokens:   ${TOKENS_FILE} (存在: ${fs.existsSync(TOKENS_FILE)})`)

// Check model file size
if (fs.existsSync(MODEL_FILE)) {
  const stat = fs.statSync(MODEL_FILE)
  console.log(`模型大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`)
}

let sherpaOnnx
try {
  sherpaOnnx = require('sherpa-onnx-node')
  console.log('sherpa-onnx-node 加载成功 ✅')
} catch (err) {
  console.error('sherpa-onnx-node 加载失败 ❌:', err.message)
  process.exit(1)
}

// Create offline recognizer
console.log('\n--- 创建 OfflineRecognizer ---')
let recognizer
try {
  const config = {
    modelConfig: {
      senseVoice: {
        model: MODEL_FILE,
        language: '',
        useInverseTextNormalization: 1,
      },
      tokens: TOKENS_FILE,
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
  }
  console.log('配置:', JSON.stringify(config, null, 2))
  recognizer = new sherpaOnnx.OfflineRecognizer(config)
  console.log('OfflineRecognizer 创建成功 ✅')
} catch (err) {
  console.error('OfflineRecognizer 创建失败 ❌:', err.message)
  process.exit(1)
}

// Read WAV file or generate silent audio
const wavFile = process.argv[2]
let samples, sampleRate

if (wavFile) {
  console.log(`\n--- 读取 WAV 文件: ${wavFile} ---`)
  try {
    const wave = sherpaOnnx.readWave(wavFile)
    samples = wave.samples
    sampleRate = wave.sampleRate
    const duration = samples.length / sampleRate
    console.log(`采样率: ${sampleRate} Hz`)
    console.log(`采样数: ${samples.length}`)
    console.log(`时长: ${duration.toFixed(2)} 秒`)
  } catch (err) {
    console.error('WAV 读取失败 ❌:', err.message)
    process.exit(1)
  }
} else {
  console.log('\n--- 无 WAV 文件，使用静音测试 ---')
  console.log('(静音不会产生识别结果，仅验证模型加载和推理流程)')
  sampleRate = 16000
  const duration = 3  // seconds
  samples = new Float32Array(sampleRate * duration)
  // Fill with very small random noise to avoid all-zero input
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (Math.random() - 0.5) * 0.001
  }
  console.log(`生成 ${duration} 秒静音音频 (${sampleRate} Hz)`)
}

// Run recognition
console.log('\n--- 运行识别 ---')
try {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate: sampleRate })

  console.log('开始 decode...')
  const start = Date.now()
  recognizer.decode(stream)
  const elapsed = Date.now() - start

  const result = recognizer.getResult(stream)
  console.log(`耗时: ${elapsed} ms`)
  console.log(`\n识别结果: "${result.text}"`)
  console.log(`结果长度: ${(result.text || '').trim().length} 字符`)

  if (result.text && result.text.trim().length > 0) {
    console.log('\n✅ SenseVoice 识别成功！')
  } else if (!wavFile) {
    console.log('\n(静音无结果是正常的)')
  } else {
    console.log('\n⚠️ 有音频但无识别结果')
  }
} catch (err) {
  console.error('识别失败 ❌:', err.message)
  console.error(err.stack)
}
