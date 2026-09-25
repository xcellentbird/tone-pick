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
import { useState } from "react";
import { HOME, NOTE, POLL, REVEAL, SEAT, STATUS } from "../../shared/copy.ts";
import type { EventSchedule, ParticipantState, PollChoice } from "../../shared/types.ts";
import { canNote, canPoke, roundOf } from "../../shared/phase.ts";
import { TICK_WINDOW, formatCountdown, formatDayHour, formatWhen } from "../../shared/time.ts";
import { noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { useTicker } from "../lib/useLoad.ts";
import type { Tab } from "./Participant.tsx";

/**
 * 이 단계에서 셀 수 있고 **아직 안 지난** 것 중 가장 가까운 것.
 *
 * 세는 것은 **다음에 일어날 일**이다 — 등록 중에는 매력 투표 시작, 매력 투표 중에는 파티 시작.
 * 매력 투표는 파티가 시작될 때 닫히므로(ADR-100) 매력 투표 중의 `파티까지` 가 곧 투표가 닫히는 때다.
 * 한동안 내내 파티만 셌는데, 등록 기간이 며칠이라 `1일 2시간` 만 계속 보였다.
 * 정작 참가자가 알고 싶은 건 **언제 콕을 찌를 수 있나** 였다.
 *
 * **발표는 세지 않는다.** 이제 시각은 있지만(ADR-43) 파티 중에 `발표까지 1시간 12분` 이 보이면
 * 남은 시간을 재며 서두르게 된다 — 이 앱이 만들려는 자리가 아니다.
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

export default function Home({
  state,
  onTab,
  onSeat,
  onHelp,
  onVote,
}: {
  state: ParticipantState;
  onTab: (tab: Tab) => void;
  /** 자리 카드를 누르면 확인 화면을 다시 연다 (슬라이스 12) */
  onSeat: () => void;
  /** 진행 방식을 다시 여는 길 (슬라이스 21). 등록 중에만 카드에 붙는다 */
  onHelp: () => void;
  /** 설문에 답한다 (슬라이스 27). 서버가 돌려준 그 설문 하나로 화면이 바뀐다 */
  onVote: (id: string, choice: PollChoice) => Promise<void>;
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
  const budget = state.poke.budget[roundOf(phase)];
  const left = budget.max - budget.used;
  /** 남은 익명 쪽지 (슬라이스 36). 이 회차에 없거나(0) 파티 중이 아니면 줄이 안 선다 */
  const noteLeft = canNote(phase) ? Math.max(0, state.note.budget.max - state.note.budget.used) : 0;
  /**
   * 콕을 다 썼으면 **다른 문장**이다. 남은 게 없는데 "찔러보세요" 라고 하면
   * 할 수 없는 일을 시키는 것이고, 그 아래 "콕 0회 남음" 은 0을 들이대는 일이다.
   */
  const poking = canPoke(phase);
  // 매력 투표는 파티 시작에 닫힌다 (ADR-100) — 단계 이름만으로 카드가 정해진다
  const todo = poking && left === 0 ? HOME.spent[phase as "prevote" | "party"] : HOME.todo[phase];

  return (
    <div className="stack">
      {/*
        **제 카드다. 할 일 카드 안에 두지 마라.**

        한동안 할 일 본문 바로 아래 `.kicker` 로 뒀었다 — `때가 되면 콕 찌르기가 열려요` 가
        말하고 이 줄이 *언제* 를 답하니 붙어 있어야 한다고 봤다. **등록 단계만 보고 정한 것이었다.**
        매력 투표부터는 같은 카드에 `콕 N회 남음` 이 서는데, 둘 다 `.kicker` 라 **같은 무게로
        연달아** 붙었다 — 하나는 시계고 하나는 예산인데 눈이 둘을 같은 종류로 읽었다.
        게다가 그 단계 카드는 제목·본문 두 줄·kicker 둘·버튼으로 다섯이 쌓였다.

        **세는 것이 없으면 카드째 사라진다** (파티·발표). 빈 상자를 남기지 마라.
      */}
      {mark && untilNext > 0 && (
        <div className="card countdownCard">
          {/* **라벨을 떼지 마라.** 숫자만 있는 타이머는 무엇을 세는지 알 수 없다 */}
          <span className="kicker">{mark.label}</span>
          <b className="countdown">
            {untilNext <= TICK_WINDOW ? formatCountdown(untilNext) : formatDayHour(untilNext)}
          </b>
        </div>
      )}

      <div className="card stack">
        <h2 className="cardTitle">{todo.title}</h2>
        <p className="dim small pre" style={{ margin: 0 }}>
          {todo.body}
        </p>

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
            {left > 0 && <div className="kicker">{STATUS.pokeLeft(roundOf(phase), left)}</div>}
            {/*
              익명 쪽지도 예산이라 콕 줄과 나란히 선다 (슬라이스 36).
              0 이면 줄이 없다 — 참가자에게 `0장` 을 들이대지 않는다 (`copy.ts` 규칙 3).
            */}
            {noteLeft > 0 && <div className="kicker">{NOTE.left(noteLeft)}</div>}
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
            <p className="small pre">{REVEAL.noMutual(state.poke.received.pre + state.poke.received.party)}</p>
          ) : (
            <>
              <div className="kicker">{HOME.matched(state.poke.matches.length)}</div>
              {/*
                **이름만 한 줄** (ADR-53). 발표 순간 가장 먼저 궁금한 건 *누구야* 인데
                지금까지는 숫자만 있고 이름은 탭을 옮겨야 나왔다.
                ⚠️ **카드를 여기 그리지 마라** — 프로필·같은 테이블·💘 배지는 참가자 탭 것이다 (ADR-18).
                여기 있는 건 그 탭으로 가기 전에 답하는 한 줄뿐이다.
              */}
              <p className="small">{state.poke.matches.map((m) => m.realName).join(" · ")}</p>
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
          <div className="table">{SEAT.banner(seat.table)}</div>
          <div className="small dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
        </button>
      ) : (
        !revealed && <p className="tiny dim center">{HOME.seatWaiting}</p>
      )}

      <Polls state={state} onVote={onVote} />
      <News state={state} />
    </div>
  );
}

/**
 * 운영자 설문 (슬라이스 27, ADR-88). **숫자가 없다** — 선택지 둘이 버튼이고, 고르면 그 버튼이 눌린 채로 남는다.
 * 몇 명이 무엇을 골랐는지는 운영자가 정하려고 묻는 것이라 참가자 화면에는 없다.
 * 열린 설문이 위, 마감된 설문은 내 답만 남긴 채 아래로 내려간다.
 */
function Polls({ state, onVote }: { state: ParticipantState; onVote: (id: string, choice: PollChoice) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const polls = state.announcements
    .filter((a) => a.poll)
    .sort((x, y) => Number(x.poll!.closed) - Number(y.poll!.closed));
  if (polls.length === 0) return null;

  async function pick(id: string, choice: PollChoice) {
    setBusy(id);
    try {
      await onVote(id, choice);
    } catch {
      // 그 사이 운영자가 마감했을 수 있다. 소켓이 "다시 읽어라" 를 이미 보냈으므로 여기서 더 할 일이 없다
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="kicker">{POLL.section}</div>
      <div className="stack">
        {polls.map((a) => {
          const poll = a.poll!;
          return (
            <div className="card stack" key={a.id}>
              <div className="name pre">{a.text}</div>
              {poll.closed ? (
                <div className="small dim">{poll.mine ? POLL.closedMine(poll[poll.mine]) : POLL.closed}</div>
              ) : (
                <div className="choice">
                  {(["a", "b"] as const).map((c) => (
                    <button key={c} type="button" aria-pressed={poll.mine === c} disabled={busy === a.id} onClick={() => pick(a.id, c)}>
                      {poll[c]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * 저장된 게 아니라 **회차 상태에서 매번 파생된다** (ADR-4) — `fired` 만이 아니다.
 * 그래서 읽음 플래그도 알림 테이블도 없다 — 상태가 바뀌면 목록이 그 자리에서 따라간다.
 *
 * **받은 익명 쪽지는 여기 없다** (ADR-98 후기 3) — 상단 바 ✉️ 의 익명 쪽지함에 있다.
 * 한동안 여기 한 줄씩 섰고, 그 본문을 덮으려고 이 목록에도 가리기 토글이 있었다. 둘 다 쪽지함으로 갔다.
 */
function News({ state }: { state: ParticipantState }) {
  // 설문은 위 카드가 그린다 — 소식 줄은 배너용이라 여기서는 건너뛴다 (`Notice.poll`)
  const list = noticesOf(state).filter((n) => !n.poll);
  if (list.length === 0) return null;

  return (
    <>
      <div className="kicker">{HOME.news}</div>
      <div className="stack">
        {list.map((n) => (
          <div className="banner" key={n.key}>
            <span className="icon">{n.icon}</span>
            <span className="grow">
              <span className="name">{n.title}</span>
              {/* 몸글이 빈 알림이 있다 (ADR-53). 빈 칸도 flex 항목이라 자리를 먹는다 */}
              {n.body && <div className="small dim pre">{n.body}</div>}
              {n.at > 0 && <div className="tiny dim">{formatWhen(n.at)}</div>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
