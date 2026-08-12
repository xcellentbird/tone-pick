/**
 * 단계에 따라 다른 것을 보여준다. 단계와 무관한 카운트다운을 띄우지 마라 (UI.md).
 * 남은 시간은 **서버 시각**에서 뺀다 — 폰 시계를 바꿔 결과를 먼저 보는 걸 막기 위해.
 */
import { STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { formatRemaining } from "../../shared/time.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";

export default function StatusCell({ state }: { state: ParticipantState }) {
  const { phase, playerCount, schedule } = state.event;
  const counting = phase === "prevote" || phase === "party";
  useTicker(counting);

  const [label, value] = pick();
  return (
    <div className="status">
      <span className="dim small">{label}</span>
      <span className="big">{value}</span>
    </div>
  );

  function pick(): [string, string] {
    if (phase === "done") return ["", STATUS.done];
    if (phase === "prevote") {
      return [STATUS.untilVoteClose, left(schedule.voteCloseAt) ?? STATUS.pokeClosed];
    }
    if (phase === "party") {
      return [STATUS.untilReveal, left(schedule.revealAt) ?? STATUS.revealSoon];
    }
    if (phase === "reg") return [STATUS.peopleHere, UNIT.people(playerCount)];
    return [STATUS.pokeSoon, UNIT.people(playerCount)];
  }

  function left(at?: number): string | null {
    if (!at) return null;
    const ms = at - now();
    return ms > 0 ? formatRemaining(ms) : null;
  }
}
