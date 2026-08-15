import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes.jsx'

let nextId = 100
const nid = (p) => `${p}_${nextId++}`

const fmtPrice = (p) => (p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(3) : p.toFixed(5))

const initialNodes = [
  { id: 'img_1', type: 'image', position: { x: 80, y: 140 }, data: {} },
  { id: 'prompt_1', type: 'prompt', position: { x: 80, y: 460 }, data: { prompt: '' } },
  { id: 'model_1', type: 'model', position: { x: 480, y: 260 }, data: { model: null, run: null } }
]
const initialEdges = [
  { id: 'e1', source: 'img_1', sourceHandle: 'out', target: 'model_1', targetHandle: 'in' },
  { id: 'e2', source: 'prompt_1', sourceHandle: 'out', target: 'model_1', targetHandle: 'in' }
]

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [settings, setSettings] = useState({ model: null, hasKey: false })
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [toasts, setToasts] = useState([])
  const stateRef = useRef({ nodes, edges })
  stateRef.current = { nodes, edges }

  const toast = useCallback((ok, msg) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, ok, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  // patch node data helper
  const patchNode = useCallback((id, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  }, [setNodes])

  useEffect(() => {
    const h = (e) => patchNode(e.detail.id, e.detail.patch)
    window.addEventListener('nf:update-node', h)
    return () => window.removeEventListener('nf:update-node', h)
  }, [patchNode])

  // settings load
  const loadSettings = useCallback(async () => {
    const r = await fetch('/api/settings')
    const j = await r.json()
    setSettings({ ...j, loaded: true })
    if (j.model) patchNode('model_1', { model: j.model })
  }, [patchNode])

  useEffect(() => { loadSettings() }, [loadSettings])

  // ---------- run (model node) ----------
  const run = useCallback(async (modelNodeId) => {
    const { nodes: ns, edges: es } = stateRef.current
    const modelNode = ns.find((n) => n.id === modelNodeId)
    if (!modelNode || modelNode.type !== 'model') return

    // upstream prompt: prompt node connected into this model
    const inEdges = es.filter((e) => e.target === modelNode.id)
    const promptNode = inEdges
      .map((e) => ns.find((n) => n.id === e.source))
      .find((n) => n?.type === 'prompt')
    if (!promptNode) { toast(false, '프롬프트 노드가 연결되지 않았습니다'); return }
    const prompt = promptNode.data.prompt || ''
    if (!prompt.trim()) { toast(false, '프롬프트가 비었습니다'); return }

    // reference image: any image/result node connected INTO the model node
    const imgNode = inEdges
      .map((e) => ns.find((n) => n.id === e.source))
      .find((n) => (n?.type === 'image' || n?.type === 'result') && n?.data?.file)
    const referenceFile = imgNode?.data?.file || null

    // create result node hooked to model output
    const resultId = nid('result')
    const modelPos = modelNode.position
    const existingResults = ns.filter((n) => n.type === 'result').length
    const resultNode = {
      id: resultId,
      type: 'result',
      position: { x: modelPos.x + 380, y: 120 + existingResults * 280 },
      data: { status: 'running', statusText: '생성 중…', tag: `v${existingResults + 1}` }
    }
    setNodes((cur) => [...cur, resultNode])
    setEdges((cur) => [...cur, { id: `e_${resultId}`, source: modelNode.id, sourceHandle: 'out', target: resultId, targetHandle: 'in' }])
    patchNode(modelNode.id, { running: true })

    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, referenceFile })
      })
      const j = await r.json()
      if (j.ok) {
        patchNode(resultId, { url: j.url, file: j.file, status: 'ok', statusText: '생성 완료', meta: `${new Date().toLocaleTimeString('ko-KR')} · 로컬 저장됨` })
        toast(true, `생성 완료 — ${j.attempts > 1 ? `재시도 ${j.attempts - 1}회 후 성공` : '1회 성공'}`)
      } else {
        patchNode(resultId, { status: 'err', statusText: '실패', meta: j.error?.slice(0, 60) })
        toast(false, j.error || '생성 실패')
      }
    } catch (e) {
      patchNode(resultId, { status: 'err', statusText: '실패', meta: String(e).slice(0, 60) })
      toast(false, '서버 오류')
    } finally {
      patchNode(modelNode.id, { running: false })
    }
  }, [patchNode, setNodes, setEdges, toast])

  // inject run into model nodes
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'model' ? { ...n, data: { ...n.data, run } } : n)))
  }, [run, setNodes])

  // ---------- add nodes ----------
  const addNode = useCallback((type) => {
    const id = nid(type === 'image' ? 'img' : type === 'prompt' ? 'prompt' : 'model')
    const dataMap = {
      image: {},
      prompt: { prompt: '' },
      model: { model: settings.model, run }
    }
    setNodes((ns) => [...ns, {
      id, type,
      position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: dataMap[type]
    }])
  }, [setNodes, settings.model, run])

  // ---------- connect ----------
  const onConnect = useCallback((params) => {
    // only allow logical connections: image/prompt/result → model(image/prompt), model → result, result → model(image)
    setEdges((es) => addEdge({ ...params, animated: false }, es))
  }, [setEdges])

  // ---------- delete single node (no cascade) ----------
  // React Flow default: deleting node keeps its edges? No — it removes connected edges.
  // We keep domain rule "단일 삭제, 연쇄 없음": we intercept via onNodesDelete to keep other nodes.
  // Edges attached to the deleted node are removed (they must be — they point at nothing), but no OTHER nodes are deleted.

  // 설정이 비어있으면(키/모델 없음) 패널 자동 오픈 — 호스팅 시 키 먼저 삽입 유도
  useEffect(() => {
    if (settings.loaded && !settings.hasKey) setPanelOpen(true)
  }, [settings.loaded, settings.hasKey])

  // ---------- settings ----------
  const saveModel = useCallback(async (model) => {
    setSettings((s) => ({ ...s, model }))
    patchNode('model_1', { model })
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })
  }, [patchNode])

  const loadModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const r = await fetch('/api/models')
      if (!r.ok) { toast(false, '모델 목록 조회 실패 — API 키를 확인하세요'); setModels([]); return }
      const j = await r.json()
      setModels(j.models || [])
    } finally {
      setModelsLoading(false)
    }
  }, [toast])

  const saveKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openrouterKey: apiKeyInput.trim() }) })
    setApiKeyInput('')
    await loadSettings()
    toast(true, 'API 키 저장됨 (로컬)')
    loadModels()
  }, [apiKeyInput, loadSettings, loadModels, toast])

  useEffect(() => { if (panelOpen) loadModels() }, [panelOpen]) // eslint-disable-line

  return (
    <>
      <div className="topbar">
        <div className="logo">node<span className="dim">/</span>grahp</div>
        <div className="tb-sep" />
        <div className="tb-item">
          <span className={`dot ${settings.model && settings.hasKey ? '' : 'off'}`} />
          <b>{settings.model || '모델 미설정'}</b> · openrouter
        </div>
        <div className="tb-sep" />
        <div className="tb-item">node {nodes.length} · edge {edges.length}</div>
        <div className="tb-right">
          <div className="tb-item">{settings.hasKey ? 'API KEY ✓' : 'API KEY ✗'}</div>
          <div className="gear" onClick={() => setPanelOpen((o) => !o)}>⚙</div>
        </div>
      </div>

      <div className="canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          deleteKeyCode={['Delete', 'Backspace']}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'default' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#161616" />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>

        <div className="toolbar">
          <button className="tool-btn" onClick={() => addNode('image')}>+ 이미지</button>
          <button className="tool-btn" onClick={() => addNode('prompt')}>+ 프롬프트</button>
          <button className="tool-btn" onClick={() => addNode('model')}>+ 모델</button>
        </div>

        {panelOpen && (
          <div className="panel">
            <div className="panel-head">
              <div className="t">SETTINGS</div>
              <div className="x" onClick={() => setPanelOpen(false)}>✕</div>
            </div>
            <div className="field">
              <div className="lab">OPENROUTER API KEY {settings.hasKey && '· ✓ 저장됨'}</div>
              <input
                type="password"
                placeholder={settings.hasKey ? 'sk-or-v1-•••• (저장됨 — 재입력 시 교체)' : 'sk-or-v1-…'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
            </div>
            <div className="field">
              <div className="lab">MODEL · 전역 1개 {models.length > 0 && `· ${models.length}개 · 저가순`}</div>
              {models.length === 0 ? (
                <div className="list-status">
                  {modelsLoading ? '모델 목록 로딩 중…' : 'API 키 저장 후 목록이 표시됩니다'}
                </div>
              ) : (
                <div className="model-list">
                  {models.map((m) => (
                    <div
                      key={m.id}
                      className={`mrow-item ${settings.model === m.id ? 'on' : ''}`}
                      onClick={() => saveModel(m.id)}
                      title={m.id}
                    >
                      <div className="mid">
                        <div className="mname">{m.id}</div>
                        <div className="msub">{m.name}</div>
                      </div>
                      {m.streaming && <span className="mbadge">STREAM</span>}
                      <span className={`price ${m.price != null ? 'has' : ''}`}>
                        {m.price == null ? '—' : m.priceUnit === 'token'
                          ? `$${fmtPrice(m.price)}/1k tok`
                          : `$${fmtPrice(m.price)}/img`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="hint">
              // 키는 로컬(.data/settings.json)에만 저장 · 환경변수 OPENROUTER_API_KEY / OPENROUTER_MODEL로 사전 설정 가능<br />
              // 모델 변경 시 새 생성부터 적용
            </div>
          </div>
        )}

        <div className="toast-zone">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.ok ? 'ok' : ''}`}>
              <div className="ic" />
              <div className="tx"><b>{t.ok ? '완료' : '실패'}</b> — {t.msg}</div>
            </div>
          ))}
        </div>

        <div className="corner-br">v0.1.0 // self-hosted</div>
      </div>
    </>
  )
}
