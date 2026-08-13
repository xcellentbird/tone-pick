/**
 * 화면 맨 위 한 줄.  단계 · 남은 콕 · 카운트다운.
 *
 * 셋을 한 줄에 모은 이유는 이게 참가자가 반복해서 확인하는 전부이기 때문이다.
 * 헤더는 스크롤되지 않으므로(.screen 이 flex 라 .body 만 흐른다) 목록을 내려도 계속 보인다.
 *
 * 회차 이름은 여기 두지 않는다 — 입장·등록에서 이미 확인했고, 파티 중에 다시 볼 일이 없다.
 * '내 정보' 탭으로 옮겼다.
 *
 * 남은 시간은 **서버 시각**에서 뺀다. 폰 시계를 바꿔 결과를 먼저 보는 걸 막기 위해.
 */
import { PHASE_LABEL, STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { formatCountdown } from "../../shared/time.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";

export default function StatusBar({ state }: { state: ParticipantState }) {
  const { phase, playerCount, schedule } = state.event;
  const counting = phase === "prevote" || phase === "party";
  useTicker(counting);

  const budget = state.poke.budget[phase === "prevote" ? "pre" : "party"];
  const deadline = phase === "prevote" ? schedule.voteCloseAt : schedule.revealAt;
  const left = deadline ? deadline - now() : 0;

  return (
    <div className={`statusbar phase-${phase}`}>
      <span className="phase">{PHASE_LABEL[phase]}</span>

      {canPoke(phase) && <span className="small dim">{STATUS.pokeLeft(budget.max - budget.used)}</span>}
      {phase === "reg" && <span className="small dim">{UNIT.people(playerCount)}</span>}

      <span className="grow" />

      {counting &&
        (left > 0 ? (
          // 초가 바뀌어도 줄이 들썩이지 않게 고정폭 숫자로
          <span className="countdown">{formatCountdown(left)}</span>
        ) : (
          <span className="small dim">{phase === "prevote" ? STATUS.pokeClosed : STATUS.revealSoon}</span>
        ))}
      {phase === "done" && <span className="small">{STATUS.done}</span>}
    </div>
  );
}
