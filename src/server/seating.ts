/**
 * 자리 배정. 상세 설계와 측정치는 문서 `자리배정-알고리즘.md`.
 *
 * 핵심 불변식: 성비는 소프트 제약이 아니다.
 *   ① tableCaps() 로 테이블별 남/여 정원을 먼저 고정하고
 *   ② 개선 단계에서는 **같은 성별끼리만 맞바꾼다**
 * 따라서 성비는 "지켜지도록 노력"하는 게 아니라 깨질 수 없다.
 *
 * ⚠️ 무료 플랜은 요청당 CPU 10ms. iterations 를 인원 수에 맞춰 제한하고,
 *    배포 전에 실제 인원으로 CPU 시간을 측정할 것.
 */
import type { Player, Seat } from "../shared/types.ts";

export function spread(n: number, t: number): number[] {
  const base = Math.floor(n / t);
  const rest = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < rest ? 1 : 0));
}

/** 총원을 고르게 나눈 뒤, 각 테이블 정원 안에서 전체 성비대로 남/여를 쪼갠다. */
export function tableCaps(t: number, m: number, w: number): Array<{ m: number; w: number }> {
  const total = spread(m + w, t);
  const n = m + w;
  let usedM = 0;
  return total.map((cap, i) => {
    const capM = i === t - 1 ? m - usedM : Math.round((cap * m) / n);
    usedM += capM;
    return { m: capM, w: cap - capM };
  });
}

export interface SeatingInput {
  players: Player[];
  tableCount: number;
  round: number;
  final: boolean;
  /** 이전 라운드들의 좌석. 재회 회피에 쓴다. */
  history: Seat[][];
  mutual: Array<[string, string]>;
  oneWay: Array<[string, string]>;
}

export function buildSeating(_input: SeatingInput): Seat[] {
  // TODO: ① 정원 만족 그리디 초기 배치 (상호 매칭 클러스터 우선, canFit 은 테이블별로 검사)
  //       ② 같은 성별 2인 스왑 로컬 서치
  throw new Error("not implemented");
}
