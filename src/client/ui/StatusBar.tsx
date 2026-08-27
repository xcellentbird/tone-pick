/**
 * 화면 맨 위 **두 줄.** 왼쪽에 회차 이름과 단계, 오른쪽에 도움말.
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
import { HELP, PHASE_LABEL, STATUS } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";

export default function StatusBar({
  state,
  onHome,
  onHelp,
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
}) {
  const { name, phase } = state.event;

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
        **모든 탭에서 항상 보이는 자리는 여기뿐이다.** 운영자가 "여기 눌러보세요" 라고
        말할 수 있으려면 찾아 들어가지 않아도 되는 곳에 있어야 한다.
        등록을 마치면 한 번 저절로 열리지만(슬라이스 21), 그 뒤에 다시 찾는 길은 이것뿐이다.
      */}
      <button type="button" className="helpBtn" aria-label={HELP.open} onClick={onHelp}>
        <span aria-hidden>?</span>
      </button>
    </div>
  );
}
