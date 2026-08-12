/**
 * 현황 탭. 맨 위가 단계 컨트롤이다 — 이 화면에서 가장 자주 하는 일이라서.
 *
 * 모든 전환은 확인창을 거치고, 확인창은 **참가자 화면이 어떻게 바뀌는지** 항목으로 보여준다.
 * 예약과 어긋나면 그 차이가 한 줄 더 붙고, 사전 투표 마감이 이미 지났으면 경고가 붙는다.
 */
import { useNavigate } from "react-router";
import {
  HOST,
  HOST_UI,
  PREVOTE_ALREADY_CLOSED,
  UNIT,
  UNREVEAL,
  phaseAction,
  schedDiff,
  type ActionCopy,
} from "../../../shared/copy.ts";
import type { Phase } from "../../../shared/types.ts";
import { PHASE_ORDER } from "../../../shared/phase.ts";
import { formatClock, formatGap, formatWhen } from "../../../shared/time.ts";
import { post } from "../../lib/api.ts";
import { now } from "../../lib/serverTime.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Dash() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const navigate = useNavigate();
  const { meta, players, received, prevoteRank, pokeCount, mutual, seatings } = state;

  const men = players.filter((p) => p.gender === "M").length;
  const women = players.length - men;
  const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(meta.phase) + 1] as Phase | undefined;
  const notPoked = players.filter((p) => (received[p.id] ?? 0) === 0);
  const lastSeating = seatings.filter((s) => s.status === "published").at(-1);

  async function go(to: Phase) {
    await post(`/host/events/${meta.id}/phase`, { to });
    reload();
  }

  function ask(to: Phase) {
    const copy = phaseAction(to, {
      code: meta.code,
      maxPre: meta.config.maxPre,
      maxParty: meta.config.maxParty,
      voteCloseAtText: meta.schedule.voteCloseAt ? formatClock(meta.schedule.voteCloseAt) : undefined,
    });
    if (!copy) return;

    const facts = [...copy.facts];
    const scheduled = { reg: meta.schedule.regOpenAt, party: meta.schedule.voteCloseAt, done: meta.schedule.revealAt }[
      to as "reg" | "party" | "done"
    ];
    if (scheduled) {
      const gap = scheduled - now();
      const line = schedDiff(to, {
        atText: formatWhen(scheduled),
        gapText: formatGap(gap),
        direction: Math.abs(gap) < 60_000 ? "same" : gap > 0 ? "early" : "late",
      });
      if (line) facts.push(line);
    }
    // 시작하자마자 마감되는 상황은 미리 알려준다
    if (to === "prevote" && meta.schedule.voteCloseAt && meta.schedule.voteCloseAt <= now()) {
      facts.push(PREVOTE_ALREADY_CLOSED(formatWhen(meta.schedule.voteCloseAt)));
    }
    run({ ...copy, facts }, to);
  }

  function run(copy: ActionCopy, to: Phase) {
    confirm(copy, async () => {
      await go(to);
      toast(copy.btn);
    });
  }

  return (
    <div className="stack">
      {nextPhase && (
        <button className="btn primary block" onClick={() => ask(nextPhase)}>
          {phaseAction(nextPhase, { code: meta.code, maxPre: meta.config.maxPre, maxParty: meta.config.maxParty })?.btn}
        </button>
      )}
      {meta.phase === "done" && (
        <button className="btn danger block" onClick={() => run(UNREVEAL, "party")}>
          {UNREVEAL.btn}
        </button>
      )}

      <div className="row">
        <button className="btn ghost wide" onClick={() => navigate(`/demo/${meta.id}`)}>
          {HOST_UI.openDemo}
        </button>
        <button
          className="btn ghost wide"
          onClick={() => {
            void navigator.clipboard?.writeText(`${location.origin}/j/${meta.code}`);
            toast(HOST_UI.copied);
          }}
        >
          {HOST_UI.entryLink}
        </button>
      </div>

      <div className="card stack">
        <div className="kicker">{HOST_UI.dash.balance}</div>
        <div>{HOST_UI.dash.registered(players.length)}</div>
        <p className="small pre">{balanceText(men, women)}</p>
      </div>

      <div className="card stack">
        <div className="kicker">{HOST_UI.dash.notPoked}</div>
        {notPoked.length === 0 ? (
          <span className="small dim">{HOST_UI.dash.notPokedNone}</span>
        ) : (
          <span className="small">{notPoked.map((p) => p.nickname).join(", ")}</span>
        )}
      </div>

      <div className="card stack">
        <div className="kicker">{HOST_UI.dash.pokeStat}</div>
        <span>{HOST_UI.dash.pokeCount(pokeCount.pre, pokeCount.party)}</span>
        <span className="small dim">{HOST_UI.dash.mutual(mutual.length)}</span>
      </div>

      <div className="card stack">
        <div className="kicker">{HOST_UI.dash.prevoteTop}</div>
        {(["M", "F"] as const).map((g) => {
          const top = prevoteRank.find((r) => players.find((p) => p.id === r.id)?.gender === g && r.count > 0);
          const person = players.find((p) => p.id === top?.id);
          return (
            <span className="small" key={g}>
              {person ? `${person.nickname} · ${UNIT.times(top!.count)}` : HOST_UI.dash.noVotes}
            </span>
          );
        })}
      </div>

      {lastSeating && (
        <div className="card stack">
          <div className="kicker">{HOST.ack.progress(lastSeating.acks.length, lastSeating.seats.length)}</div>
        </div>
      )}
    </div>
  );
}

/** 성비는 등록 단계에서 미리 알아야 현장에서 대응할 수 있다 */
function balanceText(m: number, w: number): string {
  if (m === 0 && w === 0) return HOST.balance.ok(0, 0);
  if (m === 0 || w === 0) return HOST.balance.oneSided(m === 0 ? "F" : "M", m || w);
  const ratio = Math.max(m, w) / Math.min(m, w);
  if (ratio >= 1.6) return HOST.balance.bad(m, w);
  if (ratio >= 1.2) return HOST.balance.warn(m, w);
  return HOST.balance.ok(m, w);
}
