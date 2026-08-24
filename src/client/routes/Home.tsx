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
import { HOME, REVEAL, SEAT, STATUS } from "../../shared/copy.ts";
import type { EventSchedule, ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { TICK_WINDOW, formatCountdown, formatDayHour, formatWhen } from "../../shared/time.ts";
import { noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";
import type { Tab } from "./Participant.tsx";

/**
 * 이 단계에서 셀 수 있고 **아직 안 지난** 것 중 가장 가까운 것.
 *
 * 세는 것은 **다음에 일어날 일**이다 — 등록 중에는 매력 투표 시작, 매력 투표 중에는 파티 시작.
 * 한동안 내내 파티만 셌는데, 등록 기간이 며칠이라 `1일 2시간` 만 계속 보였다.
 * 정작 참가자가 알고 싶은 건 **언제 콕을 찌를 수 있나** 였다.
 *
 * **발표는 세지 않는다.** 운영자가 손으로 누르는 것이라 셀 수 있는 시각이 없다 —
 * 없는 마감을 세어 보여주면 참가자가 그 숫자를 믿는다 (ADR-14).
 * 매력 투표 마감은 셌다 안 셌다 하지 않는다 — 일정에 적힌 시각이 생겼다 (ADR-37).
 *
 * 예약 시각이 지났는데 운영자가 아직 안 넘겼을 수도 있다 — 그때는 그 다음 것을 센다.
 * 지나간 시각을 세면 음수가 뜨고, 사람은 그 숫자를 자기 시계가 틀린 걸로 읽는다.
 */
function nextMark(phase: ParticipantState["event"]["phase"], schedule: EventSchedule, at: number) {
  return [
    { on: ["prep", "reg"], at: schedule.prevoteAt, label: STATUS.untilPrevote },
    // 매력 투표 마감은 **셀 수 있는 시각이 생겼다** (ADR-37). 발표는 여전히 세지 않는다
    { on: ["prevote"], at: schedule.voteEndAt, label: STATUS.untilVoteEnd },
    { on: ["prep", "reg", "prevote"], at: schedule.partyAt, label: STATUS.untilParty },
  ].find((m) => m.on.includes(phase) && m.at && m.at > at);
}

export default function Home({
  state,
  onTab,
  onSeat,
  onHelp,
}: {
  state: ParticipantState;
  onTab: (tab: Tab) => void;
  /** 자리 카드를 누르면 확인 화면을 다시 연다 (슬라이스 12) */
  onSeat: () => void;
  /** 진행 방식을 다시 여는 길 (슬라이스 21). 등록 중에만 카드에 붙는다 */
  onHelp: () => void;
}) {
  const { phase, schedule } = state.event;
  const seat = state.seat;
  /*
   * 남은 시간은 **서버 시각**에서 뺀다. 폰 시계를 바꿔 결과를 먼저 보는 걸 막기 위해.
   * 하루 넘게 남았으면 1초마다 다시 그릴 이유가 없다 — `144:00:00` 은 읽는 사람이 다시 나눈다.
   */
  const mark = nextMark(phase, schedule, now());
  const untilNext = mark?.at ? mark.at - now() : 0;
  useTicker(untilNext > 0 && untilNext <= TICK_WINDOW);
  const revealed = phase === "done";
  const budget = state.poke.budget[phase === "prevote" ? "pre" : "party"];
  const left = budget.max - budget.used;
  /**
   * 콕을 다 썼으면 **다른 문장**이다. 남은 게 없는데 "찔러보세요" 라고 하면
   * 할 수 없는 일을 시키는 것이고, 그 아래 "콕 0회 남음" 은 0을 들이대는 일이다.
   */
  const poking = canPoke(phase, now(), schedule);
  /*
   * **매력 투표가 닫힌 뒤와 파티 사이가 새 구간이다** (ADR-37).
   * 단계는 아직 `prevote` 지만 할 일이 다르다 — 투표는 끝났고 자리를 기다린다.
   * 그래서 단계 이름만으로는 이 카드를 고를 수 없다.
   */
  const todo =
    phase === "prevote" && !poking
      ? HOME.todo.voteClosed
      : poking && left === 0
        ? HOME.spent[phase as "prevote" | "party"]
        : HOME.todo[phase];

  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0, fontSize: 18 }}>{todo.title}</h2>
        <p className="dim small pre" style={{ margin: 0 }}>
          {todo.body}
        </p>

        {/*
          **본문 바로 아래다.** 위 문장이 `때가 되면 콕 찌르기가 열려요` 라고 말하고
          이 줄이 *언제* 를 답한다 — 둘이 붙어 있어야 한 생각으로 읽힌다.

          **숫자를 키우지 마라.** 1초마다 바뀌는 큰 숫자는 화면의 주인이 되고,
          그러면 카드가 답하려던 "내가 뭘 하면 되나" 가 조급함에 밀린다.
          상단 바에 있던 시절 20px 을 13px 로 줄인 것도 같은 이유였다.

          **라벨을 떼지 마라.** 숫자만 있는 타이머는 무엇을 세는지 알 수 없다.
        */}
        {mark && untilNext > 0 && (
          <div className="kicker countdownLine">
            <span>{mark.label}</span>
            <b className="countdown">
              {untilNext <= TICK_WINDOW ? formatCountdown(untilNext) : formatDayHour(untilNext)}
            </b>
          </div>
        )}

        {/*
          등록 직후 도움말이 저절로 뜨는데, **덮치는 화면은 반사적으로 닫힌다** —
          자리 확인창에서 이미 겪었고 그때도 홈 카드가 다시 여는 길이 됐다 (슬라이스 12).

          **등록 중에만이다.** 사전 콕 찌르기부터는 이 카드에 `참가자 보러 가기` 가 서고,
          한 카드에 버튼이 둘이면 어느 것이 지금 할 일인지 갈린다. 그 뒤로는 상단 물음표가 맡는다.
          `ghost` 인 이유도 같다 — 이 단계에서 참가자가 할 일은 기다리는 것이지 누르는 게 아니다.
        */}
        {phase === "reg" && (
          <button className="btn ghost block" onClick={onHelp}>
            {HOME.guide}
          </button>
        )}

        {poking && (
          <>
            {/* 남은 게 있을 때만 센다. 0 은 제목이 이미 말했다 */}
            {left > 0 && <div className="kicker">{STATUS.pokeLeft(phase === "prevote" ? "pre" : "party", left)}</div>}
            {/* 다 썼어도 명단 구경은 된다 — 버튼은 그대로 */}
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

      {/*
        자리는 파티장에서 몸을 움직이게 하는 정보다. 숫자를 크게.

        **눌러서 전체 화면을 다시 연다** (슬라이스 12) — 확인창을 실수로 눌러 넘긴 사람이
        테이블 번호를 다시 볼 자리가 여기뿐이다.
      */}
      {seat ? (
        <button className="card stack seatCard" onClick={onSeat}>
          <div className="kicker">{SEAT.sectionTitle}</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{SEAT.banner(seat.table)}</div>
          <div className="small dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
        </button>
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
