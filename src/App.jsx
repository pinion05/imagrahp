import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes.jsx'
import { ReactFlowProvider } from '@xyflow/react'

let nextId = 100
const nid = (p) => `${p}_${nextId++}`

const fmtPrice = (p) => (p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(3) : p.toFixed(5))

// 제외할 data 키 (함수/리소스는 새 노드에 재주입됨)
const cloneData = (d) => {
  const { run, models, onModelChange, onOpenSettings, ...rest } = d || {}
  return structuredClone(rest)
}

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
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  )
}

function AppInner() {
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [settings, setSettings] = useState({ model: null, hasKey: false })
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null) // {x, y, flowX, flowY}
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
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  // ---------- run (model node) ----------
  const run = useCallback(async (modelNodeId) => {
    const { nodes: ns, edges: es } = stateRef.current
    const modelNode = ns.find((n) => n.id === modelNodeId)
    if (!modelNode || modelNode.type !== 'model') return

    // upstream prompts: ALL prompt nodes connected into this model (순서 유지, 결합)
    const inEdges = es.filter((e) => e.target === modelNode.id)
    const sources = inEdges.map((e) => ns.find((n) => n.id === e.source)).filter(Boolean)
    const promptNodes = sources.filter((n) => n.type === 'prompt')
    if (promptNodes.length === 0) { toast(false, '프롬프트 노드가 연결되지 않았습니다'); return }
    const filled = promptNodes.filter((n) => (n.data.prompt || '').trim())
    if (filled.length === 0) { toast(false, '프롬프트가 비었습니다'); return }
    const prompt = filled.map((n) => n.data.prompt.trim()).join('\n')

    // reference images: ALL image/result nodes with files connected INTO the model
    const imgSources = sources.filter((n) => (n.type === 'image' || n.type === 'result') && n.data.file)
    // 이름 언급 순서로 정렬: 프롬프트에 먼저 언급된 캐릭터가 첫 참조가 되도록
    const named = imgSources.filter((n) => (n.data.title || '').trim())
    const sorted = [...imgSources].sort((a, b) => {
      const ia = prompt.indexOf((a.data.title || '').trim())
      const ib = prompt.indexOf((b.data.title || '').trim())
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    const referenceFiles = sorted.slice(0, 10).map((n) => n.data.file)
    if (imgSources.length > 10) toast(false, `참조 이미지 ${imgSources.length}개 중 첫 10개만 전송됩니다`)

    // 이름 매핑 안내: 모델이 참조 이미지와 이름을 연결하도록 프롬프트 뒤에 부가 (이름 있는 노드가 있을 때만)
    let finalPrompt = prompt
    const refCount = referenceFiles.length
    const namedOrdered = sorted.slice(0, 10).filter((n) => (n.data.title || '').trim())
    if (namedOrdered.length > 0) {
      const lines = namedOrdered.map((n, i) => `참조 이미지 ${i + 1}: "${(n.data.title || '').trim()}"`)
      finalPrompt = `${prompt}\n\n[참조 이미지 안내 — 입력 순서대로]\n${lines.join('\n')}`
    }

    // create result node hooked to model output
    const resultId = nid('result')
    const modelPos = modelNode.position
    // 결과 노드 배치: 모델 노드 기준 고정 영역(3열 × 2행 그리드)에서 빈 자리 찾기
    // — 같은 모델에서 반복 생성해도 화면 밖으로 내려가지 않음
    const COLS = 3, GAP_X = 240, GAP_Y = 300, TOP = 120
    const occupied = new Set(
      ns.map((n) => `${Math.round((n.position.x - (modelPos.x + 380)) / GAP_X)}:${Math.round((n.position.y - TOP) / GAP_Y)}`)
    )
    let slot = 0
    while (occupied.has(`${Math.floor(slot % COLS)}:${Math.floor(slot / COLS)}`) && slot < COLS * 8) slot++
    const slotX = modelPos.x + 380 + (slot % COLS) * GAP_X
    const slotY = TOP + Math.floor(slot / COLS) * GAP_Y
    const resultNode = {
      id: resultId,
      type: 'result',
      position: { x: slotX, y: slotY },
      data: { status: 'running' }
    }
    setNodes((cur) => [...cur, resultNode])
    setEdges((cur) => [...cur, { id: `e_${resultId}`, source: modelNode.id, sourceHandle: 'out', target: resultId, targetHandle: 'in' }])
    patchNode(modelNode.id, { running: true })

    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, referenceFiles, model: modelNode.data.model })
      })
      const j = await r.json()
      if (j.ok) {
        patchNode(resultId, { url: j.url, file: j.file, status: null })
        toast(true, `생성 완료 — ${j.attempts > 1 ? `재시도 ${j.attempts - 1}회 후 성공` : '1회 성공'}`)
      } else {
        patchNode(resultId, { status: 'err', tag: '실패' })
        toast(false, j.error || '생성 실패')
      }
    } catch (e) {
      patchNode(resultId, { status: 'err', tag: '실패' })
      toast(false, '서버 오류')
    } finally {
      patchNode(modelNode.id, { running: false })
    }
  }, [patchNode, setNodes, setEdges, toast])

  // ---------- add nodes ----------
  const addNode = useCallback((type, x, y) => {
    const id = nid(type === 'image' ? 'img' : type === 'prompt' ? 'prompt' : 'model')
    const dataMap = {
      image: {},
      prompt: { prompt: '' },
      model: { model: null, run, models, onModelChange: (m) => patchNode(id, { model: m }), onOpenSettings: () => setPanelOpen(true) }
    }
    setNodes((ns) => [...ns, {
      id, type,
      position: { x: x ?? 200 + Math.random() * 200, y: y ?? 200 + Math.random() * 200 },
      data: dataMap[type]
    }])
  }, [setNodes, run, models, patchNode])
  const addNodeAt = addNode

  // ---------- 우클릭 컨텍스트 메뉴 ----------
  const onPaneContextMenu = useCallback((e) => {
    e.preventDefault()
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect()
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setCtxMenu({ x: e.clientX - wrap.left, y: e.clientY - wrap.top, flowX: flow.x, flowY: flow.y })
  }, [screenToFlowPosition])

  useEffect(() => {
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [])

  // ---------- connect (유효 연결만) ----------
  const isValidConnection = useCallback((conn) => {
    const { nodes: ns } = stateRef.current
    const src = ns.find((n) => n.id === conn.source)
    const tgt = ns.find((n) => n.id === conn.target)
    if (!src || !tgt) return false
    // 허용: (이미지|프롬프트|결과)→모델, 모델→결과
    if (src.type === 'model') return tgt.type === 'result' || tgt.type === 'image'
    if (tgt.type === 'model') return ['image', 'prompt', 'result'].includes(src.type)
    return false
  }, [])

  const onConnect = useCallback((params) => {
    if (!isValidConnection(params)) return
    setEdges((es) => addEdge({ ...params }, es))
  }, [setEdges, isValidConnection])

  // ---------- delete single node (no cascade) ----------
  // React Flow default: deleting node keeps its edges? No — it removes connected edges.
  // We keep domain rule "단일 삭제, 연쇄 없음": we intercept via onNodesDelete to keep other nodes.
  // Edges attached to the deleted node are removed (they must be — they point at nothing), but no OTHER nodes are deleted.

  // 설정이 비어있으면(키/모델 없음) 패널 자동 오픈 — 호스팅 시 키 먼저 삽입 유도
  useEffect(() => {
    if (settings.loaded && !settings.hasKey) setPanelOpen(true)
  }, [settings.loaded, settings.hasKey])

  // ---------- settings ----------
  // 모델은 노드 단위 — 전역 설정 아님. 노드에서 onChange 시 patchNode로 해당 노드만 갱신.

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

  // 키가 있으면 패널 안 열어도 모델 목록 미리 로드 (노드 드롭다운용) — 선언 후 호출
  const preloadedRef = useRef(false)
  useEffect(() => {
    if (settings.loaded && settings.hasKey && !preloadedRef.current) {
      preloadedRef.current = true
      loadModels()
    }
  }, [settings.loaded, settings.hasKey]) // eslint-disable-line

  // inject run + model list/handlers into model nodes (선언 이후 위치)
  const nodeModelHandler = useCallback((nodeId, m) => patchNode(nodeId, { model: m }), [patchNode])
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'model' ? { ...n, data: { ...n.data, run, models, onModelChange: (m) => nodeModelHandler(n.id, m), onOpenSettings: () => setPanelOpen(true) } } : n)))
  }, [run, models, nodeModelHandler, setNodes])

  // ---------- canvas background drop → image node ----------
  const onDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const onDrop = useCallback(async (e) => {
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()

    // 스크린 좌표 → 캔버스 좌표
    const bounds = e.currentTarget.getBoundingClientRect()
    const dropX = e.clientX - bounds.left
    const dropY = e.clientY - bounds.top

    for (const [i, file] of files.entries()) {
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader()
        fr.onload = () => res(fr.result)
        fr.readAsDataURL(file)
      })
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      })
      const j = await r.json()
      if (!j.url) continue
      const id = nid('img')
      setNodes((ns) => [...ns, {
        id,
        type: 'image',
        position: { x: dropX + i * 240, y: dropY },
        data: { file: j.file, url: j.url }
      }])
    }
  }, [setNodes])

  // ---------- Ctrl+C / Ctrl+V 노드 복붙 ----------
  const clipboardRef = useRef(null) // { nodes: [...], edges: [...] }

  const onCopy = useCallback(() => {
    const { nodes: ns, edges: es } = stateRef.current
    const sel = ns.filter((n) => n.selected)
    if (sel.length === 0) return
    const ids = new Set(sel.map((n) => n.id))
    const innerEdges = es.filter((e) => ids.has(e.source) && ids.has(e.target))
    clipboardRef.current = {
      nodes: sel.map((n) => ({ id: n.id, type: n.type, position: { ...n.position }, data: cloneData(n.data) })),
      edges: innerEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }))
    }
  }, [])

  const onPaste = useCallback(() => {
    const clip = clipboardRef.current
    if (!clip || clip.nodes.length === 0) return
    const idMap = {}
    const newNodes = clip.nodes.map((n) => {
      const id = nid(n.type === 'image' ? 'img' : n.type === 'prompt' ? 'prompt' : n.type === 'model' ? 'model' : 'result')
      idMap[n.id] = id
      return {
        id,
        type: n.type,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        data: { ...n.data },
        selected: true
      }
    })
    const newEdges = clip.edges.map((e) => ({
      id: `e_${idMap[e.source]}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      source: idMap[e.source],
      target: idMap[e.target],
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }))
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes])
    setEdges((es) => [...es, ...newEdges])
  }, [setNodes, setEdges])

  // 전역 키보드 핸들러 (입력 필드 포커스 시 제외)
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      const tag = document.activeElement?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable
      if (key === 'c' && !inField) { onCopy() }
      else if (key === 'v' && !inField) { onPaste() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCopy, onPaste])

  // 붙여넣은 모델 노드에 run/handlers 재주입 (노드 수 변화 감지)
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'model' && !n.data.run ? { ...n, data: { ...n.data, run, models, onModelChange: (m) => patchNode(n.id, { model: m }), onOpenSettings: () => setPanelOpen(true) } } : n)))
  }, [nodes.length]) // eslint-disable-line

  return (
    <>
      <div className="topbar">
        <div className="logo">imagraph</div>
        <div className="tb-sep" />
        <div className="tb-item">node {nodes.length} · edge {edges.length}</div>
        <div className="tb-right">
          <div className="tb-item tb-click" onClick={() => setLogOpen((o) => !o)}>CHANGELOG</div>
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
          onDragOver={onDragOver}
          onDrop={onDrop}
          onPaneContextMenu={onPaneContextMenu}
          deleteKeyCode={['Delete', 'Backspace']}
          multiSelectionKeyCode={['Shift', 'Meta']}
          selectionOnDrag
          panOnDrag={[1, 2]}
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
            <div className="hint">
              // 키는 로컬(.data/settings.json)에만 저장 · 환경변수 OPENROUTER_API_KEY로 사전 설정 가능<br />
              // 모델은 각 모델 노드에서 직접 선택
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

        {logOpen && (
          <div className="panel changelog-panel">
            <div className="panel-head">
              <div className="t">CHANGELOG</div>
              <div className="x" onClick={() => setLogOpen(false)}>✕</div>
            </div>
            <div className="log-body">
              <div className="log-entry">
                <div className="log-ver">v0.1.0</div>
                <ul>
                  <li>노드 3종 (이미지/프롬프트/모델), 연쇄 편집</li>
                  <li>노드 이름으로 캐릭터 지정 (제임스/존)</li>
                  <li>캔버스 배경 드롭 업로드</li>
                  <li>다중 입력 전체 전달</li>
                  <li>Ctrl+C/V 노드 복붙</li>
                  <li>브러시 에디트 (✎)</li>
                  <li>이미지 비율 자동 맞춤</li>
                  <li>결과 노드 = 이미지 노드 통일</li>
                  <li>모델 노드 단위 선택 (전역 모델 제거)</li>
                  <li>우클릭 컨텍스트 메뉴로 노드 생성</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {ctxMenu && (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="ctx-item" onClick={() => { addNodeAt('image', ctxMenu.flowX, ctxMenu.flowY); setCtxMenu(null) }}>이미지 노드</div>
            <div className="ctx-item" onClick={() => { addNodeAt('prompt', ctxMenu.flowX, ctxMenu.flowY); setCtxMenu(null) }}>프롬프트 노드</div>
            <div className="ctx-item" onClick={() => { addNodeAt('model', ctxMenu.flowX, ctxMenu.flowY); setCtxMenu(null) }}>모델 노드</div>
          </div>
        )}
      </div>
    </>
  )
}
