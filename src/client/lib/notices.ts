/**
 * 참가자 알림은 저장하지 않고 상태에서 파생시킨다 (ADR-4).
 *
 * 읽음 플래그도, 알림 테이블도 만들지 않는다. 저장하면 "발표를 되돌렸을 때
 * 이미 보낸 알림을 어떻게 할 것인가"가 곧바로 생긴다. 파생시키면 상태가 하나뿐이라
 * 되돌리기만 해도 알림이 알아서 "되돌렸어요"로 바뀐다.
 */
import { NOTICE, POKE } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";

export interface Notice {
  key: string;
  icon: string;
  title: string;
  body: string;
  warn?: boolean;
  at: number;
  /** 배너로 띄울 수 있는가. 익명 콕 카운터는 시각이 없어 배너로 쓰지 않는다 */
  bannerable: boolean;
}

/** 최근 3분 안의 변화만 배너로 띄운다. 그보다 오래된 건 알림 탭에만 (UI.md) */
export const BANNER_WINDOW = 3 * 60_000;

export function noticesOf(state: ParticipantState): Notice[] {
  const { fired, config, phase } = state.event;
  const list: Notice[] = [];

  if (fired.prevote) {
    list.push({ key: "prevote", ...NOTICE.prevote(config.maxPre), at: fired.prevote, bannerable: true });
  }
  if (fired.party) {
    list.push({ key: "party", ...NOTICE.party(config.maxParty), at: fired.party, bannerable: true });
  }
  if (fired.done) {
    // 되돌렸으면 같은 자리에 다른 문장이 온다. 상태가 하나뿐이라 모순이 없다
    const copy = phase === "done" ? NOTICE.done : NOTICE.unrevealed;
    list.push({ key: `done:${phase}`, ...copy, at: fired.done, bannerable: true });
  }
  /**
   * 받은 콕은 **한 번에 하나씩** 쌓인다. 합쳐서 "지금까지 N회" 로 세어 주면
   * 숫자만 늘어날 뿐, 한 사람이 마음을 낸 일이 한 줄로 남지 않는다.
   *
   * 시각은 넣지 않는다 (`at: 0`). "21:03에 왔다"를 알면 그때 누가 화면을 보고 있었는지와
   * 맞춰 발신자를 좁힐 수 있다 — 익명은 이름을 가리는 것만으로는 지켜지지 않는다.
   * 그래서 배너로도 띄우지 않는다. 배너는 최근 3분을 재는 물건이다.
   */
  for (let i = 0; i < state.poke.receivedCount; i++) {
    list.push({
      key: `poked:${i}`,
      icon: "💘",
      title: POKE.received,
      body: POKE.receivedNote,
      at: 0,
      bannerable: false,
    });
  }

  return list.sort((a, b) => b.at - a.at);
}

export function bannerOf(list: Notice[], now: number): Notice | null {
  const fresh = list.filter((n) => n.bannerable && now - n.at <= BANNER_WINDOW);
  return fresh[0] ?? null;
}
