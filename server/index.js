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
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }
  catch { return {} }
}
function writeSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2))
}

app.get('/api/settings', (_req, res) => {
  const s = readSettings()
  const hasKey = Boolean(s.openrouterKey)
  res.json({ model: s.model || null, hasKey })
})

app.post('/api/settings', (req, res) => {
  const s = readSettings()
  if (typeof req.body.model === 'string') s.model = req.body.model
  if (typeof req.body.openrouterKey === 'string') s.openrouterKey = req.body.openrouterKey
  writeSettings(s)
  res.json({ ok: true, model: s.model || null, hasKey: Boolean(s.openrouterKey) })
})

// ---------- image models ----------
app.get('/api/models', async (_req, res) => {
  const s = readSettings()
  if (!s.openrouterKey) return res.status(400).json({ error: 'API 키가 설정되지 않았습니다' })
  try {
    const r = await fetch('https://openrouter.ai/api/v1/images/models', {
      headers: { Authorization: `Bearer ${s.openrouterKey}` }
    })
    if (!r.ok) return res.status(r.status).json({ error: `OpenRouter ${r.status}` })
    const j = await r.json()
    const models = (j.data || [])
      .filter(m => (m.architecture?.input_modalities || []).includes('image') || true)
      .map(m => ({ id: m.id, name: m.name, streaming: m.supports_streaming }))
    res.json({ models })
  } catch (e) {
    res.status(500).json({ error: String(e) })
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
  const s = readSettings()
  if (!s.openrouterKey) return res.status(400).json({ error: 'API 키가 설정되지 않았습니다' })
  if (!s.model) return res.status(400).json({ error: '모델이 선택되지 않았습니다' })
  const { prompt, referenceFile } = req.body
  if (!prompt) return res.status(400).json({ error: '프롬프트가 비었습니다' })

  let referenceUrl = null
  if (referenceFile) {
    const p = path.join(IMAGES_DIR, path.basename(referenceFile))
    if (fs.existsSync(p)) {
      const b64 = fs.readFileSync(p).toString('base64')
      const ext = p.endsWith('.png') ? 'png' : p.endsWith('.webp') ? 'webp' : 'jpeg'
      referenceUrl = `data:image/${ext};base64,${b64}`
    }
  }

  const body = {
    model: s.model,
    prompt,
    ...(referenceUrl ? { input_references: [{ type: 'image_url', image_url: { url: referenceUrl } }] } : {})
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

app.listen(PORT, () => console.log(`node/forge server on :${PORT}`))
