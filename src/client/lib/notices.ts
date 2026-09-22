/**
 * 참가자 알림은 저장하지 않고 상태에서 파생시킨다 (ADR-4).
 *
 * 읽음 플래그도, 알림 테이블도 만들지 않는다. 저장하면 "단계를 되돌렸을 때
 * 이미 보낸 알림을 어떻게 할 것인가"가 곧바로 생긴다. 파생시키면 상태가 하나뿐이라
 * 단계가 바뀌면 목록이 그 자리에서 따라간다.
 */
import { ACT, NOTE, NOTICE, POKE } from "../../shared/copy.ts";
import type { ParticipantState, PokeRound } from "../../shared/types.ts";
import { voteClosed } from "../../shared/phase.ts";

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
  /** **보여줄 시각.** `0` 이면 안 보여준다 — 받은 콕이 그렇다 (ADR-48) */
  at: number;
  /**
   * **세울 차례** (ADR-48). 큰 것이 위로 온다.
   *
   * 시각 있는 알림은 `at` 과 같다. 받은 콕은 `at` 이 0 이지만 차례는 있어야 해서 —
   * 그 라운드가 시작된 순간을 쓴다. **시각을 보여주지 않으면서 제자리에 서는 방법**이다.
   *
   * ⚠️ 이 값을 화면에 그리지 마라. 그리는 건 `at` 이고, 콕의 `at` 은 0 이다.
   */
  order: number;
  /** 배너로 띄울 수 있는가. 익명 콕은 시각이 없어 배너로 쓰지 않는다 */
  bannerable: boolean;
  tab: NoticeTab;
  /**
   * 설문이면 참 (슬라이스 27). 설문은 홈에 **카드로 따로 그리므로** 소식 목록은 이 줄을 건너뛴다 —
   * 이 줄이 있는 이유는 배너 하나다. 같은 설문이 카드와 소식 줄에 두 번 서면 안 된다. 아이디는 `key` 에 있다.
   */
  poll?: true;
  /**
   * 받은 익명 쪽지면 그 줄의 아이디 (슬라이스 36). **지우기 버튼이 이 값으로 선다** —
   * 다른 소식에는 없어서, 이 칸이 곧 *지울 수 있는 줄인가* 다.
   */
  noteId?: string;
}

/** 최근 3분 안의 변화만 배너로 띄운다. 그보다 오래된 건 알림 탭에만 (UI.md) */
export const BANNER_WINDOW = 3 * 60_000;

/**
 * `now` 를 받는 이유는 **매력 투표 마감 때문**이다 (ADR-55).
 * 단계 셋은 `fired` 에 시각이 찍혀 있어 지금이 언제든 상관없는데,
 * 마감은 예약대로 닫히는 쪽이 **시각과 지금을 견줘야** 알 수 있다.
 *
 * ⚠️ **`Date.now()` 를 여기서 부르지 마라** (CLAUDE.md 3번). 폰 시계를 바꿔
 * 마감을 먼저 넘길 수 있다 — 부르는 쪽이 서버 보정된 `now()` 를 넘긴다.
 */
export function noticesOf(state: ParticipantState, now: number): Notice[] {
  const { fired, config, phase, schedule } = state.event;
  const list: Notice[] = [];

  if (fired.prevote) {
    list.push({ key: "prevote", ...NOTICE.prevote(config.maxPre), at: fired.prevote, order: fired.prevote, bannerable: true, tab: "home" });
  }
  /*
   * 매력 투표 마감 (ADR-55). **닫는 길이 둘이라 시각도 둘이다** (ADR-39 후기) —
   * 운영자가 앞당겨 닫았으면 `fired.voteEnd`, 예약대로면 `schedule.voteEndAt` 이다.
   * 실제로 닫힌 순간을 쓴다.
   *
   * ⚠️ **`fired.prevote` 를 함께 본다.** 투표가 열린 적도 없는데 지나간 예약 시각만으로
   * `마감됐어요` 가 뜨면, 아무 일도 없었던 회차에 없던 일이 적힌다.
   */
  const closedAt = fired.voteEnd ?? schedule.voteEndAt;
  if (fired.prevote && closedAt && voteClosed(schedule, fired, now)) {
    /*
     * **목적지는 참가자 탭이다.** 단계 알림 셋은 홈을 가리키는데 이것만 다르다 —
     * `tab` 은 *소식 그 자체가 있는 화면*이고, 마감이 실제로 보이는 곳은 거기다.
     * 콕 버튼이 잠기고 `매력 투표가 마감됐어요` 가 명단 위에 선다.
     *
     * 홈으로 두면 **참가자 탭에서 같은 문장이 두 줄 연달아** 뜬다. 배너는
     * `tab !== banner.tab` 일 때만 뜨므로, 목적지가 그 화면이면 저절로 안 뜬다.
     */
    list.push({ key: "voteEnd", ...NOTICE.voteEnd, at: closedAt, order: closedAt, bannerable: true, tab: "people" });
  }
  if (fired.party) {
    // 익명 쪽지가 있는 회차면 몸글에 둘째 줄이 붙는다 (슬라이스 36). **과거형이다** — 이 줄은 발표 뒤에도 남는다
    list.push({
      key: "party",
      ...NOTICE.party(config.maxParty, config.maxNotes ?? 0),
      at: fired.party,
      order: fired.party,
      bannerable: true,
      tab: "home",
    });
  }
  /*
   * **발표는 되돌릴 수 없다** (ADR-50). 그래서 되돌린 자리에 놓던 문장(`unrevealed`)이 없다.
   *
   * 그래도 `phase` 를 함께 본다 — 이 결정 **전에** 되돌려둔 옛 회차는 `fired.done` 이 선 채로
   * 파티 진행에 서 있다. 그 화면에 `결과가 발표됐어요` 를 띄우면 참가자 탭에는 아무것도 없다.
   */
  if (fired.done && phase === "done") {
    /*
     * **매칭이 없으면 참가자 탭으로 보내지 않는다** (ADR-53).
     *
     * 거기서 할 일이 **💘 없는 것을 훑는 일**이 된다 — 이 앱이 없애려던 경험 그대로다.
     * 그 사람의 답은 이미 홈 카드에 문장으로 다 있다.
     *
     * 몸글도 비운다. 여기에 무슨 말을 넣든 홈이 조심스럽게 한 말을 **소식 목록에서 한 번 더**
     * 하는 것이고, 그 목록은 계속 남는다. 일어난 일만 적고 길 안내는 하지 않는다.
     *
     * `tab` 이 배너가 갈 곳도 정한다 — 배너는 `tab !== banner.tab` 일 때만 뜨므로,
     * 매칭 없는 사람은 홈에서 배너를 보지 않는다. 답이 그 화면에 이미 있으니 맞다.
     */
    const matched = state.poke.matches.length > 0;
    list.push({
      key: "done",
      ...NOTICE.done,
      body: matched ? NOTICE.done.body : "",
      at: fired.done,
      order: fired.done,
      bannerable: true,
      tab: matched ? "people" : "home",
    });
  }
  /*
   * 운영자가 보낸 것 (슬라이스 14·27). 저장된 것에서 파생시키므로 지우면 여기서도 사라진다 (ADR-4).
   * 설문은 닫히면 배너로 안 뜬다 — 답할 수 없는 것을 3분 동안 위에 세워두지 않는다.
   */
  for (const a of state.announcements) {
    const kind = a.poll ? NOTICE.poll : NOTICE.announce;
    list.push({
      key: `${a.poll ? "poll" : "announce"}:${a.id}`, icon: kind.icon, title: kind.title, body: a.text,
      at: a.at, order: a.at, bannerable: !a.poll?.closed, tab: "home", ...(a.poll ? { poll: true as const } : {}),
    });
  }
  /**
   * 받은 콕은 **한 번에 하나씩** 쌓인다. 합쳐서 "지금까지 N회" 로 세어 주면
   * 숫자만 늘어날 뿐, 한 사람이 마음을 낸 일이 한 줄로 남지 않는다.
   *
   * **시각은 여전히 안 보여준다** (`at: 0`). "21:03에 왔다"를 알면 그때 누가 화면을
   * 보고 있었는지와 맞춰 발신자를 좁힐 수 있다 — 익명은 이름을 가리는 것만으로는 안 지켜진다.
   * 그래서 배너로도 띄우지 않는다. 배너는 최근 3분을 재는 물건이다.
   *
   * **다만 제자리에는 선다** (ADR-48). 차례를 그 라운드가 시작된 순간으로 잡아
   * 매력 투표 콕은 `매력 투표가 시작됐어요` 바로 위에, 파티 콕은 `파티가 시작됐어요`
   * 바로 위에 온다. 그래서 소식 칸은 **위가 늘 최신**이다.
   *
   * ⚠️ 여기에 **진짜 도착 시각을 쓰지 마라.** 그러면 단계 알림 사이의 자리가
   * 곧 분 단위 시각이 되어, 보여주지 않아도 읽어낼 수 있다. 라운드까지가 전부다.
   */
  for (const round of ROUNDS) {
    // 그 라운드가 열린 순간. `+1` 이라 같은 라운드의 시작 알림보다 **위**에 선다
    const base = (round === "pre" ? fired.prevote : fired.party) ?? 0;
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
        order: base + 1,
        bannerable: false,
        tab: "home",
      });
    }
  }

  /**
   * 받은 익명 쪽지 (슬라이스 36, ADR-98). **한 장에 한 줄이고 본문이 그대로 선다.**
   *
   * 받은 콕과 같은 자리다 — 시각 없음(`at: 0`), 배너 없음, 움직임 없음. 다른 것은 둘이다:
   * **몸글이 곁설명이 아니라 내용**이고(그래서 `dim` 이 아니다), **지울 수 있다.**
   *
   * ⚠️ **`누구인지는 비밀이에요` 를 붙이지 마라** — 제목이 `익명` 을 이미 말한다.
   * 받은 콕 줄에서 그 문장을 가져오면 같은 말을 두 번 한다.
   *
   * 차례는 파티가 열린 순간 `+2` 다 — 받은 콕(`+1`) **위**, 파티 시작 알림 위다.
   * **진짜 도착 시각을 쓰지 마라** (위 경고 그대로).
   */
  for (const [i, note] of state.note.received.entries()) {
    list.push({
      key: `note:${note.id}`,
      icon: "✉️",
      title: NOTE.received,
      body: note.text,
      at: 0,
      // 최신이 앞이다 — 서버가 준 차례를 그대로 쓴다 (`received` 는 이미 최신 순이다)
      order: (fired.party ?? 0) + 2 + (state.note.received.length - i),
      bannerable: false,
      tab: "home",
      noteId: note.id,
    });
  }

  return list.sort((a, b) => b.order - a.order);
}

export function bannerOf(list: Notice[], now: number): Notice | null {
  const fresh = list.filter((n) => n.bannerable && now - n.at <= BANNER_WINDOW);
  return fresh[0] ?? null;
}
