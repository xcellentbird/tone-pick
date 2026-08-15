/**
 * 홈 탭 — "지금 무슨 일이고 내가 뭘 하면 되나".
 *
 * 단계 이름("사전 투표")은 운영자 용어다. 참가자에게는 할 일을 문장으로 준다.
 *
 * 다른 탭과 겹치지 않게 여기만 갖는 것:
 *   · 단계별 할 일 한 줄
 *   · **내 자리** — 파티 중 가장 자주 보는 정보라 '내 정보' 에서 여기로 옮겼다
 *   · 결과 **요약**(몇 명인지). 상대가 누구인지는 '내 정보' 에서 본다
 *   · **지금까지의 소식** — 알림 탭을 없애고 여기로 합쳤다.
 *     `fired` 에서 파생되는 것뿐이라 파티 한 번에 많아야 네 개고, 읽음 상태도 없다.
 *     받은편지함이 아니라 타임라인이고, 그건 "지금 무슨 일인가"의 과거형이다 (ADR-4)
 */
import { HOME, POKE, REVEAL, SEAT, STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { formatWhen } from "../../shared/time.ts";
import { noticesOf } from "../lib/notices.ts";
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

        {revealed &&
          /**
           * 서로 찌른 상대가 없으면 **숫자를 꺼내지 않는다.** "0명"은 그 자체로 상처다.
           * 이 앱이 없애려는 게 거절당하는 경험이라, 결과가 비었을 때의 문장이 가장 중요하다.
           */
          (state.poke.matches.length === 0 ? (
            <p className="small pre">{REVEAL.noMutual(state.poke.receivedCount)}</p>
          ) : (
            <>
              <div className="kicker">{HOME.matched(state.poke.matches.length)}</div>
              {/* 결과는 그 사람이 있는 자리에 있다 — 참가자 탭 맨 위 (ADR-18) */}
              <button className="btn primary block" onClick={() => onTab("people")}>
                {HOME.goResult}
              </button>
            </>
          ))}
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

      <News state={state} />
    </div>
  );
}

/**
 * 저장된 게 아니라 `fired` 에서 매번 파생된다 (ADR-4).
 * 그래서 운영자가 발표를 되돌리면 이 목록도 그 자리에서 "되돌렸어요"로 바뀐다.
 */
function News({ state }: { state: ParticipantState }) {
  const list = noticesOf(state);
  if (list.length === 0) return null;

  return (
    <>
      <div className="kicker">{HOME.news}</div>
      <div className="stack">
        {list.map((n) => (
          <div className={`banner ${n.warn ? "warn" : ""}`} key={n.key}>
            <span className="icon">{n.icon}</span>
            <span className="grow">
              <span className="name">{n.title}</span>
              <div className="small dim pre">{n.body}</div>
              {n.at > 0 && <div className="tiny dim">{formatWhen(n.at)}</div>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
