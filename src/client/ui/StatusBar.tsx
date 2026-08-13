/**
 * 화면 맨 위 한 줄.  단계 · 무엇까지 · 카운트다운.
 *
 * **숫자만 있는 타이머는 무엇을 세는지 알 수 없다.** 그래서 왼쪽에 "투표 마감까지"를 붙인다.
 * 남은 콕은 여기 두지 않는다 — 콕을 찌르는 화면(참가자 탭)에 이미 있고, 두 곳에 같은 숫자가
 * 있으면 어느 쪽이 맞는지 눈이 한 번 더 확인하게 된다.
 * 헤더는 스크롤되지 않으므로(.screen 이 flex 라 .body 만 흐른다) 목록을 내려도 계속 보인다.
 *
 * 회차 이름은 여기 두지 않는다 — 입장·등록에서 이미 확인했고, 파티 중에 다시 볼 일이 없다.
 * '내 정보' 탭으로 옮겼다.
 *
 * 남은 시간은 **서버 시각**에서 뺀다. 폰 시계를 바꿔 결과를 먼저 보는 걸 막기 위해.
 */
import { PHASE_LABEL, STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { formatCountdown } from "../../shared/time.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";

export default function StatusBar({ state }: { state: ParticipantState }) {
  const { phase, playerCount, schedule } = state.event;
  const counting = phase === "prevote" || phase === "party";
  useTicker(counting);

  const deadline = phase === "prevote" ? schedule.voteCloseAt : schedule.revealAt;
  const left = deadline ? deadline - now() : 0;
  const untilLabel = phase === "prevote" ? STATUS.untilVoteClose : STATUS.untilReveal;

  return (
    <div className={`statusbar phase-${phase}`}>
      <span className="phase">{PHASE_LABEL[phase]}</span>

      {phase === "reg" && <span className="small dim">{UNIT.people(playerCount)}</span>}

      <span className="grow" />

      {counting &&
        (left > 0 ? (
          <>
            <span className="tiny dim">{untilLabel}</span>
            {/* 초가 바뀌어도 줄이 들썩이지 않게 고정폭 숫자로 */}
            <span className="countdown">{formatCountdown(left)}</span>
          </>
        ) : (
          <span className="small dim">{phase === "prevote" ? STATUS.pokeClosed : STATUS.revealSoon}</span>
        ))}
      {phase === "done" && <span className="small">{STATUS.done}</span>}
    </div>
  );
}
