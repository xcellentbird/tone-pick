import type { Defaults } from './types.ts'

/**
 * 등록은 파티 **6일 전**에 연다. 한 주 전 주말에 알리고 평일 내내 모으는 리듬이다.
 * 사전 투표는 파티 **하루 전**에 열어, 참가자가 전날 저녁에 명단을 훑어볼 수 있게 한다.
 */
export const DEFAULTS: Defaults = {
  maxPre: 1,
  maxParty: 2,
  regOpenBeforeD: 6,
  prevoteBeforeH: 20,
}

/**
 * 저장된 기본값을 지금 모양으로 맞춰 읽는다.
 *
 * 저장된 자료는 코드보다 오래 산다. 일정 기준을 "만든 지 N시간 뒤"에서
 * "파티 N일 전"으로 바꿨을 때, 이미 저장돼 있던 옛 모양이 그대로 화면에 올라와
 * 숫자 칸이 **NaN** 이 됐다. 없는 항목은 조용히 기본값으로 채운다.
 *
 * 모르는 항목은 버린다 — 옛 키를 들고 다니면 다음 사람이 그게 쓰이는 줄 안다.
 */
export function withDefaults(
  saved: Partial<Defaults> | null | undefined,
): Defaults {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    maxPre: num(saved?.maxPre, DEFAULTS.maxPre),
    maxParty: num(saved?.maxParty, DEFAULTS.maxParty),
    regOpenBeforeD: num(saved?.regOpenBeforeD, DEFAULTS.regOpenBeforeD),
    prevoteBeforeH: num(saved?.prevoteBeforeH, DEFAULTS.prevoteBeforeH),
  }
}

export const LIMITS = {
  maxPre: { min: 1, max: 5 },
  maxParty: { min: 1, max: 10 },
  charms: 3,
  nicknameMin: 2,
  nicknameMax: 15,
  tableMax: 12,
  /** 한 회차 초대 명단 상한. 붙여넣기 사고로 수만 줄이 들어오는 걸 막는다 */
  inviteMax: 50,
  /** 시연에서 한 번에 넣을 수 있는 가짜 참가자 수 */
  demoSeedMax: 40,
  /** 테이블당 인원이 이 범위를 벗어나면 운영자에게 경고 */
  seatPerTable: { warnBelow: 2, warnAbove: 8 },
} as const

/** 자리 배정 벌점 가중치. 상세는 문서 `자리배정-알고리즘.md` */
export const SEAT_W = {
  AGE: 30, // 10살 이상 차이 — 가장 무겁다
  REP: 8, // 재회 (라운드마다 증가, AGE*0.75 상한)
  IE: 4, // I·E 쏠림
  POKE_MUTUAL: 12, // 상호 매칭 동석 보너스
  POKE_ONE: 4, // 단방향 콕 동석 보너스
} as const

/**
 * 회차를 얼마나 들고 있을 것인가.
 *
 * 파티 뒤 며칠은 참가자가 결과를 다시 본다. 그 뒤로는 실명과 전화번호를 들고 있을 이유가 없다 —
 * 이 앱이 참가자에게 요구한 것 중 가장 무거운 게 그 둘이다.
 */
export const RETENTION_DAYS = 3

export const AGE_GAP = 10
export const REP_CAP_RATIO = 0.75
export const FINAL_MUTUAL_BOOST = 2.5

/**
 * 입장 문을 두드리는 횟수 제한.
 *
 * 명단 확인은 인증 없이 열리는 문이라 **"이 번호가 이 파티에 있나"를 되묻는 창구**가 된다.
 * 참가 링크를 손에 넣은 사람이 주소록을 통째로 넣어보면 누가 소개팅 파티에 갔는지 알아낼 수 있다 —
 * 이 앱이 가장 막아야 하는 종류의 유출이다.
 *
 * 그래서 회차마다, 접속지마다 실패 횟수를 센다. 사람이 자기 번호를 잘못 치는 건 두세 번이다.
 */
export const ENTRY_TRIES = { max: 8, windowMs: 10 * 60_000 } as const

/** 초대 확인은 통과했지만 아직 등록하지 않은 상태의 수명. 등록 폼을 채울 시간이면 충분하다 */
export const INVITE_TTL = 60 * 60_000

/**
 * 전화번호 정규화 — 숫자만 남긴다.
 *
 * 운영자는 `010-1234-5678` 로 붙여넣고 참가자는 `01012345678` 로 친다.
 * 같은 번호가 다른 값으로 저장되면 명단에 있는 사람이 문 앞에서 막힌다.
 */
export function normalizePhone(s: string): string {
  return String(s ?? '').replace(/[^0-9]/g, '')
}

/**
 * 인스타 아이디 정규화 — 붙여넣은 껍데기를 벗긴다.
 *
 * 가장 흔한 "유효하지 않은 값"은 오타가 아니라 `@아이디` 나 프로필 URL 붙여넣기다.
 * 의도가 명백한 것을 오류로 돌려주지 않는다 — 오류 문구는 진짜 오타에만 쓴다.
 */
export function normalizeInstagram(raw: string): string {
  const s = String(raw ?? '').trim()
  const url = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i)
  return (url ? url[1] : s).replace(/^@+/, '')
}

/** 닉네임 비교용 정규화 — 공백 제거 + 소문자 */
export function normalizeNickname(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/**
 * 닉네임 규칙 — 한글·영문만. 숫자·공백·특수문자는 받지 않고, 길이는 LIMITS 가 정한다.
 * 화면과 서버가 이 함수 하나를 같이 본다. 화면은 반환 코드로 자리별 문구를 고른다.
 */
export function nicknameProblem(
  s: unknown,
): 'empty' | 'short' | 'long' | 'chars' | null {
  const t = String(s ?? '').trim()
  if (!t) return 'empty'
  if (t.length < LIMITS.nicknameMin) return 'short'
  if (t.length > LIMITS.nicknameMax) return 'long'
  // copy-ok
  return /^[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+$/.test(t) ? null : 'chars'
}

/** 실명 규칙 — 비어 있을 수 없고, 숫자를 넣을 수 없다 */
export function realNameProblem(s: unknown): 'empty' | 'digit' | null {
  const t = String(s ?? '').trim()
  if (!t) return 'empty'
  return /[0-9]/.test(t) ? 'digit' : null
}

/** 1인당 콕 k회일 때 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다. */
export function pokeEstimate(m: number, w: number, k: number) {
  const pairs = m * w
  const exp = Math.min(pairs, k * k)
  const pct = pairs ? (exp / pairs) * 100 : 0
  const tone = pct < 3 ? 'rare' : pct > 15 ? 'common' : 'good'
  return { pairs, exp, pct, tone } as const
}

/**
 * 아바타에 쓰는 동물 24마리 — **작은 원(30~62px)에서 읽히는 것만.**
 *
 * 40마리에서 줄였다. 🦙🦒🐢🦢🐿️ 같은 전신 동물은 21px 에서 형체가 안 읽혔다 —
 * 얼굴형 이모지는 애초에 작은 크기용 "큰 머리"로 그려져 있어 살아남는다.
 * 수가 줄어 같은 성별 안에서 겹칠 확률은 올라가지만, 알아볼 수 없는 40마리보다
 * 알아볼 수 있는 24마리가 낫다 — 아바타는 소프트 식별자다.
 *
 * 남긴 기준: 얼굴형이거나 실루엣이 굵을 것 · 귀여울 것 · 같은 종 두 번 금지 ·
 * 사람을 닮거나 표정이 강한 것 금지 (참가자를 특정 인상으로 대신 말하게 되면 안 된다).
 */
export const ANIMALS = [
  '🐶',
  '🐱',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🦄',
  '🦝',
  '🐔',
  '🐧',
  '🐥',
  '🦆',
  '🦉',
  '🐙',
  '🐬',
  '🐠',
  '🐢',
] as const
