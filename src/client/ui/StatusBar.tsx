/**
 * 화면 맨 위 **두 줄.**  왼쪽에 회차 이름과 단계, 오른쪽에 카운트다운.
 *
 * 한 줄이던 것을 나눈 이유 — 회차 이름이 길면(`108th TONE PARTY🔥 …`) 옆의 것들이
 * 다 같이 쪼그라들어 `1명` 도 `파티까지` 도 두 줄로 접혔다.
 * **줄어드는 건 이름 하나뿐이어야 한다.** 나머지는 `flex: none` 으로 제 폭을 지킨다.
 *
 * **숫자만 있는 타이머는 무엇을 세는지 알 수 없다.** 그래서 왼쪽에 무엇까지인지를 붙인다.
 *
 * 세는 것은 **다음에 일어날 일**이다 — 등록 중에는 사전 투표 시작, 사전 투표 중에는 파티 시작.
 * 한동안 내내 파티만 셌는데, 등록 기간이 며칠이라 `1일 2시간` 만 계속 보였다.
 * 정작 참가자가 알고 싶은 건 **언제 콕을 찌를 수 있나** 였다.
 *
 * 사전 투표 마감과 발표는 세지 않는다. 운영자가 손으로 누르는 것이라 셀 수 있는 시각이 없다 —
 * 없는 마감을 세어 보여주면 참가자가 그 숫자를 믿는다 (ADR-14).
 * 하루 넘게 남았으면 초를 세지 않는다. `144:00:00` 은 읽는 사람이 다시 나눠야 한다.
 * 남은 콕은 여기 두지 않는다 — 콕을 찌르는 화면(참가자 탭)에 이미 있고, 두 곳에 같은 숫자가
 * 있으면 어느 쪽이 맞는지 눈이 한 번 더 확인하게 된다.
 * 헤더는 스크롤되지 않으므로(.screen 이 flex 라 .body 만 흐른다) 목록을 내려도 계속 보인다.
 *
 * 회차 이름은 **여기 하나뿐이다.** 한동안 '내 정보' 탭에 뒀었는데(상단은 세로 공간이 비싸다),
 * 정작 "내가 지금 어느 파티에 있나" 는 아무 때나 확인하고 싶은 것이라 탭을 옮겨야 하는 게 불편했다.
 * 길면 **이름만** 말줄임한다.
 *
 * 인원 수는 여기 없다 — 참가자 탭의 `전체` 옆으로 옮겼다. 세는 대상이 거기 있다.
 *
 * 남은 시간은 **서버 시각**에서 뺀다. 폰 시계를 바꿔 결과를 먼저 보는 걸 막기 위해.
 */
import { PHASE_LABEL, STATUS } from "../../shared/copy.ts";
import type { EventSchedule, ParticipantState } from "../../shared/types.ts";
import { TICK_WINDOW, formatCountdown, formatDayHour } from "../../shared/time.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";

/**
 * 이 단계에서 셀 수 있고 **아직 안 지난** 것 중 가장 가까운 것.
 *
 * 예약 시각이 지났는데 운영자가 아직 안 넘겼을 수도 있다 — 그때는 그 다음 것을 센다.
 * 지나간 시각을 세면 음수가 뜨고, 사람은 그 숫자를 자기 시계가 틀린 걸로 읽는다.
 */
function nextMark(phase: ParticipantState["event"]["phase"], schedule: EventSchedule, at: number) {
  return [
    { on: ["prep", "reg"], at: schedule.prevoteAt, label: STATUS.untilPrevote },
    { on: ["prep", "reg", "prevote"], at: schedule.partyAt, label: STATUS.untilParty },
  ].find((m) => m.on.includes(phase) && m.at && m.at > at);
}

export default function StatusBar({ state }: { state: ParticipantState }) {
  const { name, phase, schedule } = state.event;
  // 파티가 시작되면 셀 것이 없다. 그 뒤로는 단계 이름만 남는다
  const mark = nextMark(phase, schedule, now());
  const left = mark?.at ? mark.at - now() : 0;
  // 하루 넘게 남았으면 1초마다 다시 그릴 이유가 없다
  useTicker(left > 0 && left <= TICK_WINDOW);

  return (
    <div className={`statusbar phase-${phase}`}>
      {/* 여기만 줄어든다. 길면 이름이 잘리고, 오른쪽 카운트다운은 제 폭을 지킨다 */}
      <span className="where">
        <span className="event">{name}</span>
        <span className="phase">{PHASE_LABEL[phase]}</span>
      </span>

      {left > 0 && (
        <span className="until">
          <span className="tiny dim">{mark?.label}</span>
          {left <= TICK_WINDOW ? (
            /* 초가 바뀌어도 줄이 들썩이지 않게 고정폭 숫자로 */
            <span className="countdown">{formatCountdown(left)}</span>
          ) : (
            <span className="small">{formatDayHour(left)}</span>
          )}
        </span>
      )}
    </div>
  );
}
