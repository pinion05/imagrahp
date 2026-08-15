import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'

export function ImageNode({ id, data, selected }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const [ratio, setRatio] = useState(1) // 입력 이미지 비율 (w/h)
  const [editMode, setEditMode] = useState(false)
  const [hasDraw, setHasDraw] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)

  // 이미지 비율 감지
  useEffect(() => {
    if (!data.url) { setRatio(1); return }
    const img = new Image()
    img.onload = () => setRatio(img.naturalWidth / img.naturalHeight || 1)
    img.src = data.url
  }, [data.url])

  const upload = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: reader.result })
      })
      const j = await r.json()
      if (j.url) {
        setEditMode(false)
        setHasDraw(false)
        window.dispatchEvent(new CustomEvent('nf:update-node', { detail: { id, patch: { file: j.file, url: j.url } } }))
      }
    }
    reader.readAsDataURL(file)
  }, [id])

  // 에디트 진입 시 배경(원본 이미지)을 캔버스에 로드
  useEffect(() => {
    if (!editMode || !data.url || !canvasRef.current) return
    const img = new Image()
    img.onload = () => {
      const c = canvasRef.current
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
    }
    img.src = data.url
  }, [editMode, data.url])

  // 브러시 그리기
  const pos = (e) => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const startDraw = (e) => {
    if (!editMode) return
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* synthetic event */ }
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 0.01, p.y + 0.01)
    ctx.stroke()
    setHasDraw(true)
  }
  const moveDraw = (e) => {
    if (!drawing.current || !editMode) return
    e.preventDefault()
    e.stopPropagation()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.lineWidth = 14
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#ff3366'
    ctx.globalAlpha = 0.75
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    setHasDraw(true)
  }
  const endDraw = (e) => {
    drawing.current = false
    e?.currentTarget?.releasePointerCapture?.(e.pointerId)
  }

  // 그린 내용을 새 이미지로 커밋 (합성)
  const commitDraw = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !hasDraw) { setEditMode(false); return }
    const dataUrl = canvas.toDataURL('image/png')
    const r = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    })
    const j = await r.json()
    if (j.url) {
      setEditMode(false)
      setHasDraw(false)
      window.dispatchEvent(new CustomEvent('nf:update-node', { detail: { id, patch: { file: j.file, url: j.url } } }))
    }
  }, [hasDraw, id])

  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-icon" />
        <input
          className="nodrag nf-title-input"
          value={data.title || ''}
          placeholder="이름 (예: 제임스)"
          onChange={(e) => window.dispatchEvent(new CustomEvent('nf:update-node', { detail: { id, patch: { title: e.target.value } } }))}
        />
        {data.url && (
          <button
            className={`nodrag nf-edit-btn ${editMode ? 'on' : ''}`}
            title={editMode ? '그리기 완료' : '브러시로 그리기'}
            onClick={() => (editMode ? commitDraw() : setEditMode(true))}
          >
            ✎
          </button>
        )}
        <div className="nf-tag">{data.status === 'err' ? (data.tag || '실패') : 'SRC'}</div>
      </div>
      <div
        className={`nf-thumb ${editMode ? 'editing' : ''}`}
        style={data.url ? { width: 180, height: Math.round(180 / ratio) } : undefined}
        onDragOver={(e) => { if (!editMode) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { if (!editMode) { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]) } }}
        onClick={() => { if (!editMode && !data.url) inputRef.current?.click() }}
      >
        {data.url
          ? <img src={data.url} alt="" draggable={false} />
          : data.status === 'running'
            ? <div className="dropzone">생성 중…</div>
            : <div className={`dropzone ${over ? 'over' : ''}`}>DROP IMAGE<br />또는 클릭해서 업로드</div>}
        {editMode && (
          <canvas
            ref={canvasRef}
            className="nf-draw-canvas nodrag nowheel nopan"
            width={Math.round(512)}
            height={Math.round(512 / ratio)}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
          />
        )}
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files[0])} />
      </div>
      {editMode && <div className="nf-edit-hint">✎ 브러시로 그린 후 ✎ 클릭 → 이미지에 합성</div>}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function PromptNode({ id, data, selected }) {
  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-title">프롬프트</div>
        <div className="nf-tag">TXT</div>
      </div>
      <div className="nf-prompt-body">
        <textarea
          className="nf-prompt-text"
          placeholder="프롬프트를 입력하세요…"
          value={data.prompt || ''}
          onChange={(e) => window.dispatchEvent(new CustomEvent('nf:update-node', { detail: { id, patch: { prompt: e.target.value } } }))}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function ModelNode({ id, data, selected }) {
  const onRun = useCallback(() => { data.run?.(id) }, [id, data])

  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-title">모델</div>
        <div className="nf-tag">GEN</div>
      </div>
      <div className="nf-model-body">
        {data.models && data.models.length > 0 ? (
          <select
            className="nf-model-select"
            value={data.model || ''}
            onChange={(e) => data.onModelChange?.(e.target.value)}
          >
            <option value="">— 모델 선택 —</option>
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}{m.price != null ? ` · ${m.priceUnit === 'token' ? `$${m.price}/1k tok` : `$${m.price}/img`}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <div className="nf-model-name" onClick={() => data.onOpenSettings?.()}>
            <span>{data.model || '(미설정)'}</span>
            <span className="lock">⚙ 설정</span>
          </div>
        )}
        <div className="nf-port-row"><span>in · image / prompt</span><span className="v">1</span></div>
        <div className="nf-port-row"><span>out · image</span><span className="v">→</span></div>
        <button className="nf-run" onClick={onRun} disabled={data.running}>
          {data.running ? <span className="sdot" style={{ background: '#fff', boxShadow: 'none' }} /> : <span className="tri" />}
          {data.running ? '생성 중…' : '실행'}
        </button>
      </div>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

// 결과 노드 = 이미지 노드와 동일 (생성 결과는 일반 이미지 노드 취급)
export function ResultNode(props) {
  return ImageNode(props)
}

export const nodeTypes = {
  image: ImageNode,
  prompt: PromptNode,
  model: ModelNode,
  result: ResultNode
}
