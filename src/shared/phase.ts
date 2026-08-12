import type { EventMeta, FiredMap, Phase } from "./types.ts";

export const PHASE_ORDER: Phase[] = ["prep", "reg", "prevote", "party", "done"];

// 단계 이름을 포함해 화면에 나가는 모든 문구는 `copy.ts` 에 있다. 이 파일은 로직만 담는다.

/** 어떤 예약 시각이 어떤 전환을 울리는가 */
export const SCHED_OF = {
  reg: "regOpenAt",
  party: "voteCloseAt",
  done: "revealAt",
} as const;

/**
 * 예약은 '한 번만 울리는 알람'이다. (ADR-2)
 * 되돌리기를 해도 fired 가 남아 있으므로 즉시 다시 앞으로 밀리지 않는다.
 * 서버(EventDO)에서만 호출할 것 — 클라이언트 시계를 기준으로 단계를 바꾸면 안 된다.
 */
export function dueTransition(ev: EventMeta, now: number): Phase | null {
  const { phase, fired, schedule } = ev;
  if (phase === "prep" && schedule.regOpenAt && !fired.reg && now >= schedule.regOpenAt) return "reg";
  if (phase === "prevote" && schedule.voteCloseAt && !fired.party && now >= schedule.voteCloseAt) return "party";
  if (phase === "party" && schedule.revealAt && !fired.done && now >= schedule.revealAt) return "done";
  return null;
}

/** 이미 지나온 전환만 잠근다. 등록이 시작됐어도 발표 시각은 아직 수정 가능하다. */
export function schedLocked(fired: FiredMap, key: keyof typeof SCHED_OF | string): boolean {
  if (key === "regOpenAt") return !!fired.reg;
  if (key === "voteCloseAt") return !!fired.party;
  if (key === "revealAt") return !!fired.done;
  return false;
}

export function canPoke(phase: Phase): boolean {
  return phase === "prevote" || phase === "party";
}
