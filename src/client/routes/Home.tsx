/**
 * 홈 탭 — "지금 무슨 일이고 내가 뭘 하면 되나".
 *
 * 단계 이름("사전 투표")은 운영자 용어다. 참가자에게는 할 일을 문장으로 준다.
 *
 * 다른 탭과 겹치지 않게 여기만 갖는 것:
 *   · 단계별 할 일 한 줄
 *   · **내 자리** — 파티 중 가장 자주 보는 정보라 '내 정보' 에서 여기로 옮겼다
 *   · 결과 **요약**(몇 명인지). 상대가 누구인지는 '내 정보' 에서 본다
 */
import { HOME, SEAT, STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import type { Tab } from "./Participant.tsx";

export default function Home({ state, onTab }: { state: ParticipantState; onTab: (tab: Tab) => void }) {
  const { phase, playerCount } = state.event;
  const todo = HOME.todo[phase];
  const seat = state.seat;
  const revealed = phase === "done";
  const budget = state.poke.budget[phase === "prevote" ? "pre" : "party"];

  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0, fontSize: 18 }}>{todo.title}</h2>
        <p className="dim small pre" style={{ margin: 0 }}>
          {todo.body}
        </p>

        {phase === "reg" && <div className="kicker">{`${STATUS.peopleHere} · ${UNIT.people(playerCount)}`}</div>}

        {canPoke(phase) && (
          <>
            <div className="kicker">{STATUS.pokeLeft(budget.max - budget.used)}</div>
            <button className="btn primary block" onClick={() => onTab("people")}>
              {HOME.goPeople}
            </button>
          </>
        )}

        {revealed && (
          <>
            <div className="kicker">{HOME.matched(state.poke.matches.length)}</div>
            <button className="btn primary block" onClick={() => onTab("me")}>
              {HOME.goResult}
            </button>
          </>
        )}
      </div>

      {/* 자리는 파티장에서 몸을 움직이게 하는 정보다. 숫자를 크게 */}
      {seat ? (
        <div className="card stack">
          <div className="kicker">{SEAT.sectionTitle}</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{SEAT.banner(seat.table)}</div>
          <div className="small dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
        </div>
      ) : (
        !revealed && <p className="tiny dim center">{HOME.seatWaiting}</p>
      )}
    </div>
  );
}
