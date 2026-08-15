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

const initialNodes = [
  { id: 'img_1', type: 'image', position: { x: 80, y: 140 }, data: {} },
  { id: 'prompt_1', type: 'prompt', position: { x: 80, y: 460 }, data: { prompt: '' } },
  { id: 'model_1', type: 'model', position: { x: 480, y: 260 }, data: { model: null } }
]
const initialEdges = [
  { id: 'e1', source: 'img_1', sourceHandle: 'out', target: 'model_1', targetHandle: 'image' },
  { id: 'e2', source: 'prompt_1', sourceHandle: 'out', target: 'model_1', targetHandle: 'prompt' }
]

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [settings, setSettings] = useState({ model: null, hasKey: false })
  const [models, setModels] = useState([])
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
    setSettings(j)
    if (j.model) patchNode('model_1', { model: j.model })
  }, [patchNode])

  useEffect(() => { loadSettings() }, [loadSettings])

  // ---------- run (prompt node) ----------
  const run = useCallback(async (promptNodeId) => {
    const { nodes: ns, edges: es } = stateRef.current
    const promptNode = ns.find((n) => n.id === promptNodeId)
    if (!promptNode) return
    const prompt = promptNode.data.prompt || ''
    if (!prompt.trim()) { toast(false, '프롬프트가 비었습니다'); return }

    // find edge prompt → model
    const edge = es.find((e) => e.source === promptNodeId)
    if (!edge) { toast(false, '모델 노드에 연결되지 않았습니다'); return }
    const modelNode = ns.find((n) => n.id === edge.target)
    if (!modelNode || modelNode.type !== 'model') { toast(false, '연결 대상이 모델 노드가 아닙니다'); return }

    // find reference image: model node ← image node
    const imgEdge = es.find((e) => e.target === modelNode.id && e.targetHandle === 'image')
    const imgNode = imgEdge ? ns.find((n) => n.id === imgEdge.source) : null
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
    patchNode(promptNodeId, { running: true })

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
      patchNode(promptNodeId, { running: false })
    }
  }, [patchNode, setNodes, setEdges, toast])

  // inject run into prompt nodes
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'prompt' ? { ...n, data: { ...n.data, run } } : n)))
  }, [run, setNodes])

  // ---------- add nodes ----------
  const addNode = useCallback((type) => {
    const id = nid(type === 'image' ? 'img' : type === 'prompt' ? 'prompt' : 'model')
    const dataMap = {
      image: {},
      prompt: { prompt: '', run },
      model: { model: settings.model }
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

  // ---------- settings ----------
  const saveModel = useCallback(async (model) => {
    setSettings((s) => ({ ...s, model }))
    patchNode('model_1', { model })
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })
  }, [patchNode])

  const saveKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openrouterKey: apiKeyInput.trim() }) })
    setApiKeyInput('')
    await loadSettings()
    toast(true, 'API 키 저장됨 (로컬)')
  }, [apiKeyInput, loadSettings, toast])

  const loadModels = useCallback(async () => {
    const r = await fetch('/api/models')
    if (!r.ok) { toast(false, '모델 목록 조회 실패 — API 키를 확인하세요'); return }
    const j = await r.json()
    setModels(j.models || [])
  }, [toast])

  useEffect(() => { if (panelOpen && models.length === 0) loadModels() }, [panelOpen]) // eslint-disable-line

  return (
    <>
      <div className="topbar">
        <div className="logo">node<span className="dim">/</span>forge</div>
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
              <div className="lab">MODEL · 전역 1개</div>
              <select value={settings.model || ''} onChange={(e) => saveModel(e.target.value)}>
                <option value="">— 선택 —</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
            </div>
            <div className="field">
              <div className="lab">OPENROUTER API KEY</div>
              <input
                type="password"
                placeholder={settings.hasKey ? 'sk-or-v1-•••• (저장됨)' : 'sk-or-v1-…'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
            </div>
            <div className="hint">
              // 키는 로컬(.data/settings.json)에만 저장됩니다<br />
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
