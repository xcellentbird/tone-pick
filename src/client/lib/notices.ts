/**
 * 참가자 알림은 저장하지 않고 상태에서 파생시킨다 (ADR-4).
 *
 * 읽음 플래그도, 알림 테이블도 만들지 않는다. 저장하면 "발표를 되돌렸을 때
 * 이미 보낸 알림을 어떻게 할 것인가"가 곧바로 생긴다. 파생시키면 상태가 하나뿐이라
 * 되돌리기만 해도 알림이 알아서 "되돌렸어요"로 바뀐다.
 */
import { NOTICE, POKE } from "../../shared/copy.ts";
import type { ParticipantState, PokeRound } from "../../shared/types.ts";

/**
 * 받은 줄들이 **어느 라운드에서 왔을 수 있나.** 가를 수 없으면 `null` 이다.
 *
 * ⚠️ 줄마다 따로 답하지 않는다 (ADR-46) — `receivedCount` 는 알림이 켜진 라운드를 합친
 * **한 수**이고, 거기서 라운드를 가르면 *어느 단계에서 받았나* 가 드러나 발신자가 좁혀진다.
 * 여기서 답하는 건 목록 **전체**를 무엇이라 부를지 하나이고, 그 답은
 * 참가자가 이미 아는 것(지금 단계·이 회차의 알림 설정)만으로 나온다.
 *
 * 세는 규칙은 서버의 `visibleReceived` 와 **짝이다** — 알림이 켜진 라운드만 센다.
 * 발표 뒤에는 전부 세므로(ADR-43) 가를 수 없다.
 */
function receivedRound(state: ParticipantState): PokeRound | null {
  const { phase, config } = state.event;
  if (phase === "done") return null;
  // 파티 콕은 파티가 시작돼야 생긴다 — 그전에 쌓인 것은 전부 매력 투표다
  if (phase !== "party") return "pre";
  const on = ([["pre", config.preNotify], ["party", config.pokeNotify]] as const).filter(([, v]) => v);
  return on.length === 1 ? on[0][0] : null;
}

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
  /*
   * 이름은 **목록 전체가 같다.** 한 줄만 다르게 부르면 그 줄이 어느 라운드였는지 말하는 셈이다.
   * 단계가 바뀌어 이름이 바뀔 때도 전부 함께 바뀌므로 여전히 아무것도 가리키지 않는다.
   */
  const round = receivedRound(state);
  for (let i = 0; i < state.poke.receivedCount; i++) {
    list.push({
      key: `poked:${i}`,
      icon: "💘",
      title: POKE.received(round),
      body: POKE.receivedNote,
      at: 0,
      bannerable: false,
      tab: "home",
    });
  }

  return list.sort((a, b) => b.at - a.at);
}

export function bannerOf(list: Notice[], now: number): Notice | null {
  const fresh = list.filter((n) => n.bannerable && now - n.at <= BANNER_WINDOW);
  return fresh[0] ?? null;
}
