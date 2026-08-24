import type { EventMeta, EventSchedule, FiredMap, Phase } from "./types.ts";

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

/**
 * **규칙과 일정은 콕이 오갈 수 있게 된 뒤로는 굳는다** (ADR-35).
 *
 * 굳는 것: 콕 대상(`allowSameGender`) · 되돌리기 둘(`allowUndoPre`·`allowUndo`) ·
 * 알림(`pokeNotify`) · 일정 셋. 파티 도중에 이것들이 바뀌면 참가자가 겪는 규칙이
 * 도중에 갈린다 — 특히 알림을 켜면 그때까지 쌓인 콕이 한꺼번에 나타나서,
 * "한 번에 하나씩" 이 통째로 깨진다.
 *
 * 열려 있는 것: 이름 · 장소 · 콕 횟수 · 파기 일수. **콕 횟수는 일부러 남긴다** —
 * 파티 중에 올리는 것이 매칭이 모자랄 때의 손잡이다 (ADR-34).
 *
 * 기준을 `phase` 가 아니라 `fired` 로 잡는다. 되돌리기로 단계를 뒤로 물려도
 * 이미 오간 콕은 남아 있어서, 그때 잠금이 풀리면 같은 구멍이 다시 열린다.
 * 매력 투표를 건너뛰고 파티로 바로 간 회차도 있어서 셋을 다 본다.
 */
export function rulesLocked(fired: FiredMap): boolean {
  return !!(fired.prevote || fired.party || fired.done);
}

/**
 * 일정은 **지나온 것씩** 잠근다 (ADR-37). 파티가 시작되면 남은 일정이 없으니 전부 잠근다.
 *
 * ADR-35 는 규칙과 일정을 한 잠금으로 묶었는데, 매력 투표 마감에 시각이 생기면서
 * 그 묶음이 깨졌다 — **파티가 늦어지면 마감도 미뤄야 하는데** `fired.prevote` 하나로
 * 일정 전체를 잠그면 손쓸 방법이 없다. 규칙 넷(`rulesLocked`)은 그대로 묶여 있다.
 */
export function schedLocked(fired: FiredMap, key: string): boolean {
  if (fired.party || fired.done) return true;
  if (key === "regOpenAt") return !!fired.reg;
  if (key === "prevoteAt") return !!fired.prevote;
  // voteEndAt · partyAt — 파티가 시작될 때까지 고칠 수 있다
  return false;
}

/**
 * 지금 콕(또는 매력 투표)을 찌를 수 있나.
 *
 * **매력 투표는 시각으로 닫힌다** (ADR-37) — `voteEndAt` 이 지나면 `prevote` 단계인 채로
 * 투표만 닫힌다. 단계는 그대로라 명단도 프로필도 그대로 보인다. 파티 콕은 시각을 보지 않는다 —
 * 파티 시작과 발표는 운영자가 누르는 것이고, 그 사이에 마감할 시각이 없다 (ADR-14).
 *
 * `voteEndAt` 이 없는 옛 회차는 **닫히지 않는다.** 없는 마감을 만들어 조용히 막지 않는다.
 */
export function canPoke(phase: Phase, now: number, schedule: EventSchedule): boolean {
  if (phase === "party") return true;
  if (phase !== "prevote") return false;
  return !schedule.voteEndAt || now < schedule.voteEndAt;
}

/**
 * 오늘의 연애운은 **파티가 시작돼야** 열린다 (ADR-20).
 * 발표 뒤에도 그대로 남는다 — 오늘 하루의 것이라 파티가 끝났다고 사라질 이유가 없다.
 */
export function canOpenFortune(phase: Phase): boolean {
  return phase === "party" || phase === "done";
}

/**
 * 이 회차를 지워도 되는 시각. 넘으면 회차 DO 를 통째로 버린다.
 *
 * 기준을 **가장 나중 시각**으로 잡는 게 핵심이다. 만든 날만 보면
 * 3주 뒤로 예약한 파티가 파티 전에 지워진다. 실제로 그럴 뻔한 계산이었다.
 */
export function purgeDueAt(meta: Pick<EventMeta, "createdAt" | "fired" | "schedule">, retentionDays: number): number {
  const marks = [
    meta.createdAt,
    ...Object.values(meta.fired),
    ...Object.values(meta.schedule),
  ].filter((t): t is number => typeof t === "number");
  return Math.max(...marks) + retentionDays * 86400_000;
}
