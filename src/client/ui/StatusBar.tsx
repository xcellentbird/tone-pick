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
 * ⚠️ **카운트다운을 여기로 되돌리지 마라.** 홈의 할 일 카드로 옮겼다 —
 * 카운트다운이 세는 건 늘 *다음에 일어날 일*이지 **지금 하는 일의 마감이 아니다**
 * (사전 투표 마감은 운영자가 눌러서 셀 수 있는 시각이 없다 — ADR-14).
 * 그건 "지금 무슨 일이고 내가 뭘 하면 되나" 에 답하는 홈의 질문이고,
 * 거기서 제 카드로 선다 (`.countdownCard`).
 *
 * 여기 있던 시절의 대가는 **회차 이름**이 치렀다. 오른쪽 열이 제 폭(약 85px)을 붙들고 있어서
 * 390px 폰에서 이름 칸이 219px 뿐이었다 — 조금만 긴 이름이면 늘 말줄임됐다. 지금은 304px 다.
 *
 * 인원 수도, 남은 콕도 여기 없다. 남은 콕은 콕을 찌르는 화면(참가자 탭)이 맡고,
 * **인원 수는 참가자 화면 어디에도 없다** (ADR-21).
 */
import { HELP, PHASE_LABEL } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";

export default function StatusBar({ state, onHelp }: { state: ParticipantState; onHelp: () => void }) {
  const { name, phase } = state.event;

  return (
    <div className={`statusbar phase-${phase}`}>
      {/* 여기만 줄어든다. 길면 이름이 잘리고, 도움말 버튼은 제 폭을 지킨다 */}
      <span className="where">
        <span className="event">{name}</span>
        <span className="phase">{PHASE_LABEL[phase]}</span>
      </span>

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
