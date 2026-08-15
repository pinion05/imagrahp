import React, { useCallback, useRef, useState } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'

export function ImageNode({ id, data, selected }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

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
      if (j.url) window.dispatchEvent(new CustomEvent('nf:update-node', { detail: { id, patch: { file: j.file, url: j.url } } }))
    }
    reader.readAsDataURL(file)
  }, [id])

  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-icon" />
        <div className="nf-title">{data.title || '이미지'}</div>
        <div className="nf-tag">{data.tag || 'SRC'}</div>
      </div>
      <div
        className="nf-thumb"
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
      >
        {data.url
          ? <img src={data.url} alt="" draggable={false} />
          : <div className={`dropzone ${over ? 'over' : ''}`}>DROP IMAGE<br />또는 클릭해서 업로드</div>}
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files[0])} />
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function PromptNode({ id, data, selected }) {
  const { getNode } = useReactFlow()
  const { run } = data

  const onRun = useCallback(() => {
    // find model node connected from this prompt
    run(id)
  }, [id, run])

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
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRun() }}
        />
        <button className="nf-run" onClick={onRun} disabled={data.running}>
          {data.running ? <span className="sdot" style={{ background: '#fff', boxShadow: 'none' }} /> : <span className="tri" />}
          {data.running ? '생성 중…' : '실행'}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function ModelNode({ id, data, selected }) {
  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-title">모델</div>
        <div className="nf-tag">GEN</div>
      </div>
      <div className="nf-model-body">
        <div className="nf-model-name">
          <span>{data.model || '(미설정)'}</span>
          <span className="lock">⚿ 전역</span>
        </div>
        <div className="nf-port-row"><span>in · image</span><span className="v">1</span></div>
        <div className="nf-port-row"><span>in · prompt</span><span className="v">1</span></div>
        <div className="nf-port-row"><span>out · image</span><span className="v">→</span></div>
      </div>
      <Handle type="target" position={Position.Left} id="image" style={{ top: 38 }} />
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: 92 }} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function ResultNode({ id, data, selected }) {
  return (
    <div className={`nf-node ${selected ? 'selected' : ''}`}>
      <div className="nf-head">
        <div className="nf-icon" />
        <div className="nf-title">결과</div>
        <div className="nf-tag">{data.tag || ''}</div>
      </div>
      <div className="nf-thumb">
        {data.status === 'running' && <div className="dropzone">생성 중…</div>}
        {data.url && <img src={data.url} alt="" draggable={false} />}
      </div>
      {data.status && (
        <div className={`nf-status ${data.status === 'ok' ? 'ok' : data.status === 'err' ? 'err' : 'warn'}`}>
          <span className="sdot" />
          {data.statusText}
        </div>
      )}
      {data.meta && <div className="nf-meta">{data.meta}</div>}
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export const nodeTypes = {
  image: ImageNode,
  prompt: PromptNode,
  model: ModelNode,
  result: ResultNode
}
