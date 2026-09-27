/**
 * 화면 맨 위 **두 줄.** 왼쪽에 회차 이름과 단계, 오른쪽에 익명 쪽지함 ✉️ 과 도움말.
 *
 * 답하는 질문은 하나다 — **"내가 지금 어느 파티의 어느 단계에 있나."**
 * 그것만 두는 게 이 줄의 일이다. 헤더는 스크롤되지 않으므로(.screen 이 flex 라 .body 만 흐른다)
 * 여기 있는 것은 어느 탭에서든 계속 보인다. 그래서 **자리값이 비싸다.**
 *
 * 회차 이름은 **여기 하나뿐이다.** 한동안 '내 정보' 탭에 뒀었는데(상단은 세로 공간이 비싸다),
 * 정작 "내가 지금 어느 파티에 있나" 는 아무 때나 확인하고 싶은 것이라 탭을 옮겨야 하는 게 불편했다.
 * 길면 **이름만** 말줄임한다.
 *
 * 그 이름 칸이 **홈으로 가는 길이기도 하다.** 어느 탭에 있든 늘 같은 자리에 있어서,
 * 하단 홈 탭까지 손을 내리지 않아도 되는 지름길이 된다 (로고를 눌러 처음으로 가는 그것이다).
 * **홈 탭에서는 버튼이 아니다** — 갈 곳이 없는데 버튼으로 서 있으면 눌러본 사람이 고장으로 읽는다.
 * 보이는 것은 아무것도 더하지 않는다. 표시를 하나 붙이는 순간 이 줄이 답하는 질문이 둘이 된다.
 *
 * ⚠️ **카운트다운을 여기로 되돌리지 마라.** 홈의 할 일 카드로 옮겼다 —
 * 카운트다운이 세는 건 늘 *다음에 일어날 일*이고, 그건 "지금 무슨 일이고 내가 뭘 하면 되나"
 * 에 답하는 홈의 질문이다. 거기서 제 카드로 선다 (`.countdownCard`).
 *
 * 여기 있던 시절의 대가는 **회차 이름**이 치렀다. 오른쪽 열이 제 폭(약 85px)을 붙들고 있어서
 * 390px 폰에서 이름 칸이 219px 뿐이었다 — 조금만 긴 이름이면 늘 말줄임됐다. 지금은 304px 다.
 *
 * 인원 수도, 남은 콕도 여기 없다. 남은 콕은 콕을 찌르는 화면(참가자 탭)이 맡고,
 * **인원 수는 참가자 화면 어디에도 없다** (ADR-21).
 */
import { HELP, NOTE, PHASE_LABEL, STATUS } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { useOverlay } from "./Overlays.tsx";

export default function StatusBar({
  state,
  onHome,
  onHelp,
  inbox,
}: {
  state: ParticipantState;
  /**
   * 회차 이름을 누르면 홈 탭. **홈 탭에서는 주지 않는다** — 갈 곳이 없으면 누를 것도 없다.
   *
   * 하단 홈 탭과 같은 길을 쓴다(`onTab("home")`). 여기서 `navigate` 를 직접 부르면
   * 히스토리 규칙(ROUTES.md 의 push/replace 표)이 두 곳에 생기고, 한쪽만 고쳐진다.
   */
  onHome?: () => void;
  onHelp: () => void;
  /**
   * 익명 쪽지함 ✉️ (ADR-98 후기 3). **늘 선다** — 단계도 장 수도 안 본다 (ADR-111 · 후기 1).
   *
   * 여기 서는 이유는 하나다: 받은 쪽지는 어느 탭에 있든 오고, 모든 탭에서 보이는 자리는
   * 이 줄과 탭바뿐이다. 탭바는 더 비싸다 — 다섯 칸이면 칸마다 78px 이다.
   * 이 줄에서는 회차 이름 하나만 줄어든다. 없다가 생기면 그 칸이 그 순간 줄어들어서 처음부터 선다.
   *
   * `off` 는 **자리는 지키고 꺼져 있다**는 뜻이고, 그 값이 누를 때 말할 한 줄이다 — 매력 투표 전이거나,
   * 쪽지를 0장으로 둔 회차다. 어느 쪽인지는 `Participant` 가 안다.
   */
  inbox: { unread: number; off?: string; onOpen: () => void };
}) {
  const { name, phase } = state.event;
  const { toast } = useOverlay();

  const where = (
    <>
      <span className="event">{name}</span>
      <span className="phase">{PHASE_LABEL[phase]}</span>
    </>
  );

  return (
    <div className={`statusbar phase-${phase}`}>
      {/* 여기만 줄어든다. 길면 이름이 잘리고, 도움말 버튼은 제 폭을 지킨다 */}
      {onHome ? (
        <button type="button" className="where" onClick={onHome}>
          {where}
          {/* 어디로 가는지는 글자로 말한다. 이름을 `aria-label` 로 덮으면 그게 사라진다 */}
          <span className="srOnly">{STATUS.toHome}</span>
        </button>
      ) : (
        <span className="where">{where}</span>
      )}

      {/*
        오른쪽 버튼들은 **한 묶음**이다 (`.barActions`). 쪽지함이 처음 들어왔을 때 두 버튼이 각자
        `.statusbar` 의 간격(10px)을 받아 원과 원 사이가 26px 로 벌어졌고, ✉️ 만 컬러 그림이라
        옆의 `?` 와 다른 물건으로 읽혔다 (운영자가 짚었다). 이제 둘이 **알약 하나** 안에 가는 칸막이를 두고
        선다(`.pair`) — 둘 다 같은 색 글리프다. 탭 영역은 저마다 44px 그대로다.
        쪽지함은 늘 서므로(ADR-111 후기 1) `?` 가 혼자 서는 일은 없다.
      */}
      <div className="barActions pair">
        <button
          type="button"
          className="helpBtn inboxBtn"
          aria-label={inbox.unread > 0 ? `${NOTE.inbox.open} ${NOTE.inbox.unread(inbox.unread)}` : NOTE.inbox.open}
          /*
            꺼진 쪽지함은 **죽은 버튼이 아니다** — 꺼진 재미 탭과 같은 수다(`Participant` 의 `Tabs`).
            `disabled` 로 두면 누른 것 자체가 안 와서 왜 꺼져 있는지 말할 수 없다.
          */
          aria-disabled={!!inbox.off || undefined}
          onClick={() => (inbox.off ? toast(inbox.off) : inbox.onOpen())}
        >
          {/*
            **그림이 아니라 선이다.** 컬러 이모지(✉️)는 `?` 옆에서 혼자 튀었다 —
            회차 이름보다 먼저 읽히면 안 되는 자리다. 색은 `?` 와 같은 `currentColor`.
          */}
          <span aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="m4 7 8 6 8-6" />
            </svg>
          </span>
          {/*
            배지는 **안 읽은 수**다. 움직이지 않고(ADR-64) 경보 빨강도 아니다 —
            남이 일으킨 변화라 옆 사람의 눈을 끌면 안 된다. 쪽지함을 열면 사라진다.
          */}
          {inbox.unread > 0 && (
            <b className="count" aria-hidden>
              {inbox.unread}
            </b>
          )}
        </button>

        {/*
          **모든 탭에서 항상 보이는 자리는 여기뿐이다.** 운영자가 "여기 눌러보세요" 라고
          말할 수 있으려면 찾아 들어가지 않아도 되는 곳에 있어야 한다.
          등록을 마치면 한 번 저절로 열리지만(슬라이스 21), 그 뒤에 다시 찾는 길은 이것뿐이다.
        */}
        <button type="button" className="helpBtn" aria-label={HELP.open} onClick={onHelp}>
          <span aria-hidden>?</span>
        </button>
      </div>
    </div>
  );
}
