import React from 'react'

const LOG = [
  {
    ver: 'v0.2.0',
    date: '2026-08-15',
    items: [
      '전역 모델 개념 제거 — 모델은 각 모델 노드에서 독립 선택',
      '헤더에서 모델명 제거',
      'CHANGELOG 페이지 (/changelog)',
      '빈 캔버스 우클릭 → 노드 종류 선택 → 그 위치에 생성',
      '모델 노드에서 모델 선택 즉시 반영',
    ]
  },
  {
    ver: 'v0.1.1',
    date: '2026-08-15',
    items: [
      '이미지 노드 비율 자동 맞춤 (1:1 고정 해제)',
      '브러시 에디트 (✎) — 원본 위 합성 그리기',
      'Ctrl+C/V 노드/그룹 복사·붙여넣기',
      '결과 노드 = 이미지 노드 완전 동일화',
      '모델 노드 직접 모델 변경 + 단가 표시',
      '캔버스 배경 드롭으로 이미지 업로드',
      '모델→이미지 연결 허용, SRC 태그 제거',
    ]
  },
  {
    ver: 'v0.1.0',
    date: '2026-08-15',
    items: [
      '노드 3종 (이미지/프롬프트/모델), 연쇄 편집',
      '노드 이름으로 캐릭터 지정 (제임스/존) — 프롬프트에서 이름만 언급',
      '다중 입력 전체 전달 (프롬프트 결합 + 참조 이미지 최대 10장)',
      '생성 실패 시 자동 재시도 3회',
      'OpenRouter 연동, 로컬 저장, 자체호스팅',
    ]
  },
]

export default function Changelog() {
  return (
    <div className="cl-page">
      <div className="cl-top">
        <a className="cl-back" href="/">← imagraph</a>
        <div className="cl-title">CHANGELOG</div>
      </div>
      <div className="cl-list">
        {LOG.map((e) => (
          <div key={e.ver} className="cl-entry">
            <div className="cl-head">
              <span className="cl-ver">{e.ver}</span>
              <span className="cl-date">{e.date}</span>
            </div>
            <ul>
              {e.items.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
