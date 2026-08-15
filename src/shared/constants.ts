import type { Defaults } from "./types.ts";

/**
 * 등록은 파티 **6일 전**에 연다. 한 주 전 주말에 알리고 평일 내내 모으는 리듬이다.
 * 사전 투표는 파티 **하루 전**에 열어, 참가자가 전날 저녁에 명단을 훑어볼 수 있게 한다.
 */
export const DEFAULTS: Defaults = {
  maxPre: 3,
  maxParty: 3,
  regOpenBeforeD: 6,
  prevoteBeforeH: 24,
};

export const LIMITS = {
  maxPre: { min: 1, max: 5 },
  maxParty: { min: 1, max: 10 },
  charms: 3,
  nicknameMax: 12,
  tableMax: 12,
  /** 테이블당 인원이 이 범위를 벗어나면 운영자에게 경고 */
  seatPerTable: { warnBelow: 2, warnAbove: 8 },
} as const;

/** 자리 배정 벌점 가중치. 상세는 문서 `자리배정-알고리즘.md` */
export const SEAT_W = {
  AGE: 30,          // 10살 이상 차이 — 가장 무겁다
  REP: 8,           // 재회 (라운드마다 증가, AGE*0.75 상한)
  IE: 4,            // I·E 쏠림
  POKE_MUTUAL: 12,  // 상호 매칭 동석 보너스
  POKE_ONE: 4,      // 단방향 콕 동석 보너스
} as const;

/**
 * 회차를 얼마나 들고 있을 것인가.
 *
 * 파티 뒤 며칠은 참가자가 결과를 다시 본다. 그 뒤로는 실명과 전화번호를 들고 있을 이유가 없다 —
 * 이 앱이 참가자에게 요구한 것 중 가장 무거운 게 그 둘이다.
 */
export const RETENTION_DAYS = 7;

export const AGE_GAP = 10;
export const REP_CAP_RATIO = 0.75;
export const FINAL_MUTUAL_BOOST = 2.5;

/** 닉네임 비교용 정규화 — 공백 제거 + 소문자 */
export function normalizeNickname(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 1인당 콕 k회일 때 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다. */
export function pokeEstimate(m: number, w: number, k: number) {
  const pairs = m * w;
  const exp = Math.min(pairs, k * k);
  const pct = pairs ? (exp / pairs) * 100 : 0;
  const tone = pct < 3 ? "rare" : pct > 15 ? "common" : "good";
  return { pairs, exp, pct, tone } as const;
}
