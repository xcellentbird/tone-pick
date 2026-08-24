/**
 * 참가자 알림은 저장하지 않고 상태에서 파생시킨다 (ADR-4).
 *
 * 읽음 플래그도, 알림 테이블도 만들지 않는다. 저장하면 "발표를 되돌렸을 때
 * 이미 보낸 알림을 어떻게 할 것인가"가 곧바로 생긴다. 파생시키면 상태가 하나뿐이라
 * 되돌리기만 해도 알림이 알아서 "되돌렸어요"로 바뀐다.
 */
import { ACT, NOTICE, POKE } from "../../shared/copy.ts";
import type { ParticipantState, PokeRound } from "../../shared/types.ts";

/**
 * 받은 줄은 **라운드마다 따로 쌓인다** (ADR-46 후기).
 *
 * 매력 투표에서 받은 것은 표고, 파티에서 받은 것은 콕이다 — 참가자가 겪은 일이 다르므로
 * 화면도 다르게 부른다. 한 수로 합쳐 두던 시절에는 매력 투표 중에도 `콕! 찔렀어요` 가 떴다.
 *
 * **어느 줄이 어느 라운드인지가 드러나는 것이 이 결정의 대가다** — 그 판단과 대가는
 * ADR-46 후기에 적혀 있다. 여기서 새로 정하지 마라.
 */
const ROUNDS: PokeRound[] = ["pre", "party"];

/**
 * 배너를 눌렀을 때 갈 곳. **알림마다 다르다** —
 * 단계 알림은 소식 목록이 있는 홈이고, 발표는 결과가 실제로 있는 참가자 탭이다 (ADR-18).
 * 하나로 묶어 홈으로만 보내면 "홈으로 가라 → 참가자 탭으로 가라" 가 서로를 가리킨다.
 */
export type NoticeTab = "home" | "people";

export interface Notice {
  key: string;
  icon: string;
  title: string;
  body: string;
  warn?: boolean;
  at: number;
  /** 배너로 띄울 수 있는가. 익명 콕 카운터는 시각이 없어 배너로 쓰지 않는다 */
  bannerable: boolean;
  tab: NoticeTab;
}

/** 최근 3분 안의 변화만 배너로 띄운다. 그보다 오래된 건 알림 탭에만 (UI.md) */
export const BANNER_WINDOW = 3 * 60_000;

export function noticesOf(state: ParticipantState): Notice[] {
  const { fired, config, phase } = state.event;
  const list: Notice[] = [];

  if (fired.prevote) {
    list.push({ key: "prevote", ...NOTICE.prevote(config.maxPre), at: fired.prevote, bannerable: true, tab: "home" });
  }
  if (fired.party) {
    list.push({ key: "party", ...NOTICE.party(config.maxParty), at: fired.party, bannerable: true, tab: "home" });
  }
  if (fired.done) {
    // 되돌렸으면 같은 자리에 다른 문장이 온다. 상태가 하나뿐이라 모순이 없다
    const copy = phase === "done" ? NOTICE.done : NOTICE.unrevealed;
    // 발표됐으면 결과가 있는 참가자 탭으로, 되돌렸으면 볼 게 없으니 홈으로
    const tab = phase === "done" ? "people" : "home";
    list.push({ key: `done:${phase}`, ...copy, at: fired.done, bannerable: true, tab });
  }
  /**
   * 받은 콕은 **한 번에 하나씩** 쌓인다. 합쳐서 "지금까지 N회" 로 세어 주면
   * 숫자만 늘어날 뿐, 한 사람이 마음을 낸 일이 한 줄로 남지 않는다.
   *
   * 시각은 넣지 않는다 (`at: 0`). "21:03에 왔다"를 알면 그때 누가 화면을 보고 있었는지와
   * 맞춰 발신자를 좁힐 수 있다 — 익명은 이름을 가리는 것만으로는 지켜지지 않는다.
   * 그래서 배너로도 띄우지 않는다. 배너는 최근 3분을 재는 물건이다.
   */
  for (const round of ROUNDS) {
    for (let i = 0; i < state.poke.received[round]; i++) {
      list.push({
        key: `poked:${round}:${i}`,
        /*
         * **버튼과 같은 이모지다** (`ACT.emoji`) — 매력 투표 ✨ · 파티 콕 👉.
         *
         * 하트 하나를 둘에 같이 쓰던 자리다. 참가자가 누른 버튼과 받은 줄이 같은 그림이면
         * *내가 한 그 일을 누군가 나에게 했다* 가 글자 없이도 읽힌다.
         * **여기서 이모지를 새로 고르지 마라** — 버튼이 바뀌면 이 줄도 함께 바뀌어야 한다.
         */
        icon: ACT.emoji(round),
        title: POKE.received(round),
        body: POKE.receivedNote,
        at: 0,
        bannerable: false,
        tab: "home",
      });
    }
  }

  return list.sort((a, b) => b.at - a.at);
}

export function bannerOf(list: Notice[], now: number): Notice | null {
  const fresh = list.filter((n) => n.bannerable && now - n.at <= BANNER_WINDOW);
  return fresh[0] ?? null;
}
