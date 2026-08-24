import type { EventMeta, FiredMap, Phase } from "./types.ts";

export const PHASE_ORDER: Phase[] = ["prep", "reg", "prevote", "party", "done"];

// 단계 이름을 포함해 화면에 나가는 모든 문구는 `copy.ts` 에 있다. 이 파일은 로직만 담는다.

/**
 * 예약은 '한 번만 울리는 알람'이다. (ADR-2)
 * 되돌리기를 해도 fired 가 남아 있으므로 즉시 다시 앞으로 밀리지 않는다.
 * 서버(EventDO)에서만 호출할 것 — 클라이언트 시계를 기준으로 단계를 바꾸면 안 된다.
 */
export function dueTransition(ev: EventMeta, now: number): Phase | null {
  const { phase, fired, schedule } = ev;
  if (phase === "prep" && schedule.regOpenAt && !fired.reg && now >= schedule.regOpenAt) return "reg";
  if (phase === "reg" && schedule.prevoteAt && !fired.prevote && now >= schedule.prevoteAt) return "prevote";
  return null;
}

/** 이미 지나온 전환만 잠근다. 파티 일시는 잠그지 않는다 — 장소가 바뀌면 시각도 바뀐다. */
export function schedLocked(fired: FiredMap, key: string): boolean {
  if (key === "regOpenAt") return !!fired.reg;
  if (key === "prevoteAt") return !!fired.prevote;
  return false;
}

export function canPoke(phase: Phase): boolean {
  return phase === "prevote" || phase === "party";
}

/**
 * 오늘의 연애운은 **파티가 시작돼야** 열린다 (ADR-20).
 * 발표 뒤에도 그대로 남는다 — 오늘 하루의 것이라 파티가 끝났다고 사라질 이유가 없다.
 */
export function canOpenFortune(phase: Phase): boolean {
  return phase === "party" || phase === "done";
}
