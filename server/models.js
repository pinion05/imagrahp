// 큐레이션 모델 화이트리스트 (v0.2.1, 2026-09-08 기준)
// 선정 기준: Artificial Analysis 이미지 아레나 엘로 + 1k장당 가격 + 최신성(2026년 출시) 교차 검증.
// OpenRouter 카탈로그 전체(~50개) 중 구형·과잉가격·중복 세대 모델을 걷어내고 세대 대표만 남긴다.
// 새 최신 모델 확인: https://artificialanalysis.ai/image/leaderboard/text-to-image
export const CURATED_MODELS = [
  // ── 저가 ($10~20/1k) ──
  { id: 'microsoft/mai-image-2.6-flash', elo: 1099, cost1k: 19.5 },
  // ── $30~40/1k ──
  { id: 'qwen/qwen-image-3', elo: 1078, cost1k: 30 },
  { id: 'google/gemini-3.1-flash-lite-image', elo: 1089, cost1k: 33.6 },
  { id: 'bytedance-seed/seedream-5-0-lite', elo: 1000, cost1k: 35 },
  { id: 'microsoft/mai-image-2.6', elo: 1149, cost1k: 38.9 },   // 편집 1위
  { id: 'qwen/qwen-image-3-pro', elo: 1086, cost1k: 40 },
  // ── $60~90/1k ──
  { id: 'google/gemini-3.1-flash-image', elo: 1121, cost1k: 67 },
  { id: 'bytedance-seed/seedream-5-0-pro', elo: 1083, cost1k: 90 },
  // ── 프리미엄 ($130+) ──
  { id: 'google/gemini-3-pro-image', elo: 1099, cost1k: 134 },
  { id: 'openai/gpt-image-2', elo: 1178, cost1k: 211 },          // 텍2이미지 1위 (high 기준)
]
