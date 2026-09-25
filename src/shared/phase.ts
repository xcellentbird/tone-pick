import type { EventMeta, EventSchedule, FiredMap, Phase, PokeRound } from "./types.ts";

export const PHASE_ORDER: Phase[] = ["prep", "reg", "prevote", "party", "done"];

/** 이 단계의 콕이 어느 라운드에 쌓이나. 매력 투표만 `pre` 다 — 화면과 서버가 같은 답을 낸다 */
export const roundOf = (phase: Phase): PokeRound => (phase === "prevote" ? "pre" : "party");

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
  /*
   * 파티 시작 (ADR-93). **`phase === "prevote"` 에서만 울린다** — 등록 중에 파티 일시가
   * 지났다고 뛰면 매력 투표가 통째로 사라진다. 예약은 저마다 *바로 앞 단계*에서만 운다.
   *
   * ADR-14 는 이걸 운영자의 버튼으로 뒀었다. 걷어낸 이유는 ADR-93 에 있다 —
   * 요약하면 **시각을 적어두고도 그 시각에 폰을 꺼내야 하는** 쪽이 더 자주 걸렸다.
   * 버튼은 남아 있고, 미룰 일이면 `partyAt` 을 고친다 (`schedLocked` 이 열어 둔다).
   */
  if (phase === "prevote" && schedule.partyAt && !fired.party && now >= schedule.partyAt) return "party";
  /*
   * 커플 발표 (ADR-43). **`phase === "party"` 인 것이 이 줄의 전부다.**
   *
   * 막으려던 건 아무도 안 온 자리에서 발표가 뜨는 것이다. 파티가 시작된 뒤에만 울리게 하면
   * 그 일이 일어나지 않는다 — 위의 파티 예약과 이어져야 여기까지 온다.
   *
   * ⚠️ **`phase === "prevote"` 를 여기 더하지 마라.** 파티를 건너뛰고 발표가 뜬다.
   */
  if (phase === "party" && schedule.revealAt && !fired.done && now >= schedule.revealAt) return "done";
  return null;
}

/**
 * 그 전환이 **언제** 걸려 있나. 예약이 없으면 `null`.
 *
 * `dueTransition` 과 **같은 표를 본다** — 저기가 "넘길 때가 됐나" 를 판정하고,
 * 여기가 "언제 넘어가나" 를 답한다. 조건이 갈라지면 알람이 안 울리거나 울려도 아무 일이 없다.
 * 한동안 서버(`nextDue`)와 여기가 같은 세 줄을 따로 적고 있었고, 그게 그 사고의 자리였다.
 * **조건을 고칠 일이 생기면 두 함수를 나란히 놓고 함께 고쳐라.**
 *
 * 서버는 알람을 걸 때, 운영자 화면은 단계 버튼 옆 카운트다운에 쓴다 —
 * 그 버튼이 하는 일이 **이 시각을 앞당기는 것**이라 옆에 남은 시간이 함께 서야 말이 된다.
 *
 * 넷이 다 여기 있다 (ADR-93). 매력 투표 마감(`voteEndAt`)만 없는데, 그건 전환이 아니라
 * **판정**이라서다 (ADR-39) — 단계가 안 바뀌니 걸 알람도 없다.
 */
export function dueAt(ev: EventMeta): number | null {
  const { phase, fired, schedule } = ev;
  if (phase === "prep" && schedule.regOpenAt && !fired.reg) return schedule.regOpenAt;
  if (phase === "reg" && schedule.prevoteAt && !fired.prevote) return schedule.prevoteAt;
  if (phase === "prevote" && schedule.partyAt && !fired.party) return schedule.partyAt;
  if (phase === "party" && schedule.revealAt && !fired.done) return schedule.revealAt;
  return null;
}

/**
 * **규칙과 일정은 콕이 오갈 수 있게 된 뒤로는 굳는다** (ADR-35).
 *
 * 굳는 것: 콕 대상(`allowSameGender`) · 알림 둘(`preNotify`·`pokeNotify`) · 일정.
 * 파티 도중에 이것들이 바뀌면 참가자가 겪는 규칙이 도중에 갈린다 — 특히 알림을 켜면
 * 그때까지 쌓인 콕이 한꺼번에 나타나서, "한 번에 하나씩" 이 통째로 깨진다.
 *
 * **되돌리기는 여기 없다** (ADR-95) — 설정 자체가 없어졌다. 언제나 되돌릴 수 있다.
 *
 * 열려 있는 것: 이름 · 장소 · 콕 횟수. **콕 횟수는 일부러 남긴다** —
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
 * 일정은 **지나온 것씩** 잠근다 (ADR-39). 파티가 시작되면 남은 일정이 없으니 전부 잠근다.
 *
 * ADR-35 는 규칙과 일정을 한 잠금으로 묶었는데 그러면 **파티가 늦어질 때 파티 일시를 못 미룬다** —
 * `fired.prevote` 하나로 일정 전체를 잠그면 손쓸 방법이 없다. 규칙 셋(`rulesLocked` — 대상·알림 둘)은
 * 그대로 묶여 있다. (매력 투표 마감 시각은 ADR-100 이 걷었다.)
 */
export function schedLocked(fired: FiredMap, key: string): boolean {
  /*
   * **발표 시각만 파티가 시작된 뒤에도 열려 있다** (ADR-43).
   * 파티가 길어지면 미뤄야 하는데, 파티 시작에 잠그면 손쓸 방법이 없다 —
   * 파티 일시가 파티 전까지 열려 있는 것과 같은 자리다. 이 줄이 `fired.party` 보다 **먼저** 온다.
   */
  if (key === "revealAt") return !!fired.done;
  if (fired.party || fired.done) return true;
  if (key === "regOpenAt") return !!fired.reg;
  if (key === "prevoteAt") return !!fired.prevote;
  // partyAt — 파티가 시작될 때까지 고칠 수 있다
  return false;
}

/** 시계가 단계를 넘기는 셋, 일어나는 순서대로 (ADR-93) */
export const TRANSITION_KEYS = ["prevoteAt", "partyAt", "revealAt"] as const;

/**
 * 아직 오지 않은 예약 전환끼리 순서가 맞나 — 매력 투표 시작 → 파티 시작 → 커플 발표 (ADR-93 후기).
 * 셋 다 시계가 따라가는 예약이라 어긋난 채 저장되면 그대로 일어난다: 파티가 매력 투표보다 앞이면 매력 투표가
 * 열리는 그 시각에 파티까지 한 번에 넘어가 투표가 통째로 사라지고, 발표가 파티보다 앞이면 파티가 열리는 순간
 * 발표까지 간다. 회차를 만들 때(`fired` 가 비어 셋 다 산다)와 고칠 때가 **같은 함수**를 쓴다.
 *
 * **지난 것은 견주지 않는다** (`schedLocked` 이 잠근 키). 앞당겨 연 예약의 시각은 기록이라, 그 앞으로
 * 다음 것을 옮기는 건 정당하다 — 한때 등록 시각까지 통째로 견주다가 *매력 투표를 지금 열려는* 조작이 거절당했다.
 */
export function scheduleInOrder(schedule: EventSchedule, fired: FiredMap): boolean {
  const live = TRANSITION_KEYS.filter((k) => !schedLocked(fired, k)).map((k) => schedule[k]);
  for (let i = 1; i < live.length; i++) {
    const [before, after] = [live[i - 1], live[i]];
    if (before !== undefined && after !== undefined && after <= before) return false;
  }
  return true;
}

const HOUR = 3_600_000;

/**
 * 순서가 어긋난 일정을 **파티 시작을 기준으로** 바로잡는다. 어긋나지 않았으면 `null` (ADR-93 후기 2).
 *
 * 설정 탭은 2026-09-18 전까지 순서를 보지 않았다 — 그 사이 파티를 미루고 발표를 그대로 두었거나, 파티를 당기고
 * 매력 투표 시작을 그대로 둔 회차가 남아 있을 수 있다. 그대로 두면 시계가 따라가서 **파티가 열리는 순간 매칭 확인까지
 * 가거나** 매력 투표가 통째로 사라진다. 지금 API 로는 만들 수 없는 모양이라 옛 회차에만 있다.
 *
 * **파티 시작은 옮기지 않는다** — 나머지가 거기서 재어지는 기준이다. 옮기는 쪽은 `gaps` 만큼 떨어뜨린다 —
 * 회차를 새로 만들 때와 같은 셈이다. **지난 것은 건드리지 않는다** (`scheduleInOrder` 가 견주지 않는 것과 같다).
 */
export function reorderSchedule(
  schedule: EventSchedule,
  fired: FiredMap,
  gaps: { prevoteBeforeH: number; revealAfterH: number },
): EventSchedule | null {
  const { partyAt } = schedule;
  if (partyAt === undefined || scheduleInOrder(schedule, fired)) return null;
  const next: EventSchedule = { ...schedule };
  const live = (k: (typeof TRANSITION_KEYS)[number]) => next[k] !== undefined && !schedLocked(fired, k);
  if (live("prevoteAt") && next.prevoteAt! >= partyAt) next.prevoteAt = partyAt - gaps.prevoteBeforeH * HOUR;
  if (live("revealAt") && next.revealAt! <= partyAt) next.revealAt = partyAt + gaps.revealAfterH * HOUR;
  return scheduleInOrder(next, fired) ? next : null;
}

/**
 * 지금 콕(또는 매력 투표)을 찌를 수 있나. **단계가 곧 기간이다.**
 *
 * 매력 투표는 `prevote` 동안 열려 있고 **파티가 시작되면 닫힌다** (ADR-100) — 파티 시작이 그대로
 * 파티 콕을 연다. 한때 마감 시각(`voteEndAt`, ADR-39)이 따로 있었다. 표가 자리 배정의 재료라
 * 자리를 짤 시간을 벌어야 했기 때문인데, 표가 자리에서 빠지면서 그 시간이 필요 없어졌다.
 * **마감 시각이 적힌 옛 회차도 그 시각에 닫지 않는다** — 설정 화면에 칸이 없어 고칠 수 없는 마감이 된다.
 *
 * 파티 콕은 발표(`revealAt`, ADR-43)가 단계를 넘기며 닫는다.
 */
export function canPoke(phase: Phase): boolean {
  return phase === "prevote" || phase === "party";
}

/**
 * 지금 익명 쪽지를 보낼 수 있나 (ADR-98). **파티 콕과 같은 창이다** — 파티 시작부터 발표까지.
 *
 * `canPoke` 를 그대로 쓰지 않는 이유는 **매력 투표 때문**이다. 콕은 `prevote` 에서도 열려 있고
 * (거기서는 표를 내는 것이다 — ADR-34), 익명 쪽지는 **직접 만나본 뒤에** 쓰는 것이라
 * 그 단계에는 없다. 한 함수로 묶으면 매력 투표 화면에 익명 쪽지가 열린다.
 *
 * 장 수(`maxNotes`)는 여기서 안 본다 — 단계는 단계고 예산은 예산이다.
 */
export function canNote(phase: Phase): boolean {
  return phase === "party";
}

/**
 * 오늘의 연애운은 **매력 투표가 시작되면** 열린다 (ADR-20 후기).
 * 발표 뒤에도 그대로 남는다 — 오늘 하루의 것이라 파티가 끝났다고 사라질 이유가 없다.
 *
 * 그 전에도 **탭은 자리를 지킨다** — 없다가 생기는 게 아니라 비활성으로 서 있다가 켜진다.
 * 탭이 도중에 생기면 손가락이 기억한 자리가 어긋난다.
 */
export function canOpenFortune(phase: Phase): boolean {
  return phase === "prevote" || phase === "party" || phase === "done";
}

/**
 * **미션만은 파티가 시작돼야 열린다** (ADR-20 후기).
 *
 * 미션은 "30분 안에 되고 실패해도 티가 나지 않는 것" 이고, 그 문장에는 **언제 할지**가
 * 들어간다 — "자리를 옮기고 막 앉았을 때" 처럼 파티장에서만 성립하는 상황이다.
 * 매력 투표는 파티 스무 시간 전에 열리므로, 그때 뒤집으면 할 수 없는 미션이
 * **한 번 열면 그대로** 남는다 (ADR-20). 운세는 읽는 것이라 미리 열려도 잃을 게 없다.
 */
export function canOpenMission(phase: Phase): boolean {
  return phase === "party" || phase === "done";
}
