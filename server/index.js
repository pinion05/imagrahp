import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = process.env.PORT || 7837
const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, '.data')
const IMAGES_DIR = path.join(DATA_DIR, 'images')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
fs.mkdirSync(IMAGES_DIR, { recursive: true })

const app = express()
app.use(express.json({ limit: '64mb' }))
app.use(express.static(path.join(ROOT, 'dist')))

// ---------- settings ----------
function readStored() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }
  catch { return {} }
}
function writeStored(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2))
}
// 배포 시 환경변수로 키 사전 삽입 가능 (UI 저장값이 우선)
function effectiveSettings() {
  const s = readStored()
  return {
    ...s,
    openrouterKey: s.openrouterKey || process.env.OPENROUTER_API_KEY || null
  }
}

app.get('/api/settings', (_req, res) => {
  const s = effectiveSettings()
  res.json({ hasKey: Boolean(s.openrouterKey) })
})

app.post('/api/settings', (req, res) => {
  const s = readStored()
  if (typeof req.body.openrouterKey === 'string') s.openrouterKey = req.body.openrouterKey
  writeStored(s)
  const e = effectiveSettings()
  res.json({ ok: true, hasKey: Boolean(e.openrouterKey) })
})

// ---------- image models (with pricing) ----------
app.get('/api/models', async (_req, res) => {
  const s = effectiveSettings()
  if (!s.openrouterKey) return res.status(400).json({ error: 'API 키가 설정되지 않았습니다' })
  try {
    const [modelsRes] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/images/models', {
        headers: { Authorization: `Bearer ${s.openrouterKey}` }
      })
    ])
    if (!modelsRes.ok) return res.status(modelsRes.status).json({ error: `OpenRouter ${modelsRes.status}` })
    const j = await modelsRes.json()
    const models = await Promise.all((j.data || []).map(async (m) => {
      // fetch per-endpoint pricing (cheapest output price wins)
      let price = null
      let priceUnit = null
      try {
        const er = await fetch(`https://openrouter.ai${m.endpoints}`, {
          headers: { Authorization: `Bearer ${s.openrouterKey}` }
        })
        if (er.ok) {
          const ej = await er.json()
          const outs = (ej.endpoints || [])
            .flatMap((e) => e.pricing || [])
            .filter((p) => p.billable === 'output_image' && typeof p.cost_usd === 'number' && p.cost_usd > 0)
          if (outs.length) {
            const min = outs.reduce((a, b) => (a.cost_usd < b.cost_usd ? a : b))
            price = min.cost_usd
            priceUnit = min.unit
          }
        }
      } catch { /* pricing optional */ }
      return {
        id: m.id,
        name: m.name,
        streaming: m.supports_streaming,
        price,
        priceUnit,
        inputModalities: m.architecture?.input_modalities || []
      }
    }))
    // cheapest first
    models.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    res.json({ models })
  } catch (e) {
    res.status(500).json({ error: String(e) }
    )
  }
})

// ---------- image upload ----------
app.post('/api/upload', (req, res) => {
  try {
    const { dataUrl } = req.body
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '')
    if (!m) return res.status(400).json({ error: 'invalid dataUrl' })
    const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'
    const id = crypto.randomUUID()
    fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), Buffer.from(m[2], 'base64'))
    res.json({ id, file: `${id}.${ext}`, url: `/files/${id}.${ext}` })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
app.get('/files/:name', (req, res) => {
  const p = path.join(IMAGES_DIR, path.basename(req.params.name))
  if (!fs.existsSync(p)) return res.status(404).end()
  res.sendFile(p)
})

// ---------- generate (retry 3, save local) ----------
const MAX_RETRIES = 3

app.post('/api/generate', async (req, res) => {
  const s = effectiveSettings()
  if (!s.openrouterKey) return res.status(400).json({ error: 'API 키가 설정되지 않았습니다' })
  const { prompt, referenceFiles, model } = req.body
  if (!model) return res.status(400).json({ error: '모델 노드에서 모델을 선택하세요' })
  if (!prompt) return res.status(400).json({ error: '프롬프트가 비었습니다' })

  const referenceUrls = (Array.isArray(referenceFiles) ? referenceFiles : referenceFiles ? [referenceFiles] : [])
    .slice(0, 10)
    .flatMap((f) => {
      const p = path.join(IMAGES_DIR, path.basename(String(f)))
      if (!fs.existsSync(p)) return []
      const b64 = fs.readFileSync(p).toString('base64')
      const ext = p.endsWith('.png') ? 'png' : p.endsWith('.webp') ? 'webp' : 'jpeg'
      return [{ type: 'image_url', image_url: { url: `data:image/${ext};base64,${b64}` } }]
    })
  console.log(`[generate] prompt ${prompt.length}자 · 참조 ${referenceUrls.length}장 → ${model}`)

  const body = {
    model,
    prompt,
    ...(referenceUrls.length > 0 ? { input_references: referenceUrls } : {})
  }

  let lastErr = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${s.openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!r.ok) {
        lastErr = `OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`
        if (r.status >= 400 && r.status < 500 && r.status !== 429) break // non-retryable
        continue
      }
      const j = await r.json()
      const item = j.data?.[0]
      if (!item?.b64_json) { lastErr = '응답에 이미지가 없습니다'; continue }
      const media = item.media_type || 'image/png'
      const ext = media.includes('jpeg') ? 'jpg' : media.includes('webp') ? 'webp' : media.includes('svg') ? 'svg' : 'png'
      const id = crypto.randomUUID()
      fs.writeFileSync(path.join(IMAGES_DIR, `${id}.${ext}`), Buffer.from(item.b64_json, 'base64'))
      return res.json({
        ok: true,
        file: `${id}.${ext}`,
        url: `/files/${id}.${ext}`,
        usage: j.usage || null,
        attempts: attempt
      })
    } catch (e) {
      lastErr = String(e)
    }
  }
  res.status(502).json({ ok: false, error: `자동 재시도 ${MAX_RETRIES}회 소진 — ${lastErr}`, attempts: MAX_RETRIES })
})

app.listen(PORT, () => console.log(`imagraph server on :${PORT}`))
