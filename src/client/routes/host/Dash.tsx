/**
 * 현황 탭. 맨 위가 단계 컨트롤이다 — 이 화면에서 가장 자주 하는 일이라서.
 *
 * 모든 전환은 확인창을 거치고, 확인창은 **참가자 화면이 어떻게 바뀌는지** 항목으로 보여준다.
 * 예약이 있는 전환(등록 시작·사전 투표 시작)은 예약과의 차이가 한 줄 더 붙는다.
 *
 * 숫자는 둘만 보여준다.
 *   서로 찌른 커플 — 자리를 붙일지 말지를 여기서 판단한다
 *   사전 투표 1위  — 남녀 한 명씩. 진행 멘트에 쓴다
 * 성비는 참가자 탭 명단에 있고, '콕을 못 받은 사람'은 일부러 두지 않는다 —
 * 알면 그 사람을 다르게 대하게 되고, 그건 이 앱이 없애려던 경험이다.
 */
import {
  HOST,
  HOST_UI,
  UNIT,
  UNREVEAL,
  phaseAction,
  schedDiff,
  type ActionCopy,
} from "../../../shared/copy.ts";
import type { Phase } from "../../../shared/types.ts";
import { PHASE_ORDER } from "../../../shared/phase.ts";
import { formatGap, formatWhen } from "../../../shared/time.ts";
import { post } from "../../lib/api.ts";
import Avatar from "../../ui/Avatar.tsx";
import { now } from "../../lib/serverTime.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import { useConsole, type ConsoleState } from "./HostConsole.tsx";

export default function Dash() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const { meta, players, prevoteRank, mutual, received, seatings } = state;

  const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(meta.phase) + 1] as Phase | undefined;
  const lastSeating = seatings.filter((s) => s.status === "published").at(-1);
  const nick = (id: string) => players.find((p) => p.id === id)?.nickname ?? "";

  async function go(to: Phase) {
    await post(`/host/events/${meta.id}/phase`, { to });
    reload();
  }

  function ask(to: Phase) {
    const copy = phaseAction(to, {
      code: meta.code,
      maxPre: meta.config.maxPre,
      maxParty: meta.config.maxParty,
    });
    if (!copy) return;

    const facts = [...copy.facts];
    // 예약이 있는 전환은 둘뿐이다. 나머지는 비교할 시각 자체가 없다
    const scheduled = { reg: meta.schedule.regOpenAt, prevote: meta.schedule.prevoteAt }[to as "reg" | "prevote"];
    if (scheduled) {
      const gap = scheduled - now();
      const line = schedDiff(to, {
        atText: formatWhen(scheduled),
        gapText: formatGap(gap),
        direction: Math.abs(gap) < 60_000 ? "same" : gap > 0 ? "early" : "late",
      });
      if (line) facts.push(line);
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

      {/* 데모 뷰는 헤더로 옮겼다 — 어느 탭에 있든 바로 열 수 있어야 한다 */}
      <button
        className="btn ghost block"
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}/j/${meta.id}`);
          toast(HOST_UI.copied);
        }}
      >
        {HOST_UI.entryLink}
      </button>
      {/* 링크만 보내면 참가자가 문 앞에서 막힌다. 코드를 따로 알려야 한다는 걸 여기서 못 박는다 */}
      <p className="tiny dim">{HOST_UI.entryLinkNote}</p>

      {/* 👑 사전 투표 1위 — 진행 멘트에 쓰는 정보라 이름이 크게 읽혀야 한다 */}
      <div className="row between">
        <span className="kicker">{HOST_UI.dash.prevoteTop}</span>
        <span className="tiny dim">{HOST_UI.dash.live}</span>
      </div>
      {(["M", "F"] as const).map((g) => {
        // 공동 1위는 **함께** 보여준다. 한 명만 집으면 나머지가 조용히 가려진다
        const mine = prevoteRank.filter((r) => players.find((p) => p.id === r.id)?.gender === g && r.count > 0);
        const best = mine[0]?.count ?? 0;
        const tops = mine.filter((r) => r.count === best).map((r) => players.find((p) => p.id === r.id));
        if (tops.length === 0) {
          return (
            <div className="card" key={g}>
              <div className="kicker">{HOST_UI.dash.crown(g)}</div>
              <span className="small dim">{HOST_UI.dash.noVotes}</span>
            </div>
          );
        }
        return (
          <div className="crown stack" key={g}>
            <div className="kicker">{HOST_UI.dash.crown(g)}</div>
            {tops.map((p) => (
              <div className="row" key={p!.id}>
                <span className="ico">👑</span>
                <Avatar nickname={p!.nickname} />
                <span className="grow">
                  <span className="name">{p!.nickname}</span>
                  <div className="small dim">
                    {p!.realName} · {HOST_UI.dash.gotPokes(best)}
                  </div>
                </span>
              </div>
            ))}
          </div>
        );
      })}

      {/* 💘 상호 매칭 — 자리를 붙일지 판단하는 자리 */}
      <div className="card stack">
        <div className="kicker">{HOST_UI.dash.mutualTitle(mutual.length)}</div>
        {mutual.length === 0 ? (
          <span className="small dim">{HOST_UI.dash.mutualNone}</span>
        ) : (
          mutual.map(([a, b]) => (
            <div className="row pairRow" key={`${a}>${b}`}>
              <Avatar nickname={nick(a)} size="sm" />
              <span className="grow ellipsis">{nick(a)}</span>
              <span>💘</span>
              <span className="grow ellipsis" style={{ textAlign: "right" }}>
                {nick(b)}
              </span>
              <Avatar nickname={nick(b)} size="sm" />
            </div>
          ))
        )}
      </div>

      {/*
        🔥 받은 콕 순위. 현황 탭에서만 본다 (ADR-30) —
        참가자 탭의 개인 행에는 넣지 않는다. 명단을 훑으며 한 사람씩 볼 숫자가 아니다.
      */}
      <div className="row between">
        <span className="kicker">{HOST_UI.dash.rankTitle}</span>
        <span className="tiny dim">{HOST_UI.dash.rankNote}</span>
      </div>
      <Ranking players={players} received={received} />

      {lastSeating && (
        <div className="card stack">
          <div className="kicker">{HOST.ack.progress(lastSeating.acks.length, lastSeating.seats.length)}</div>
        </div>
      )}
    </div>
  );
}

/**
 * 받은 콕 순위. 바 길이는 1위 대비 비율이다 — 절대 수보다 "얼마나 몰렸나" 가 눈에 들어온다.
 *
 * 0회인 사람도 목록에 남긴다. 빼면 **빠진 사람이 곧 0회**라 감춘 게 감춰지지 않는다.
 */
function Ranking({
  players,
  received,
}: {
  players: ConsoleState["players"];
  received: Record<string, number>;
}) {
  const rows = players
    .map((p) => ({ p, n: received[p.id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.p.nickname.localeCompare(b.p.nickname));
  const top = Math.max(1, rows[0]?.n ?? 0);

  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div className="rank" key={r.p.id}>
          <span className={`no ${i === 0 && r.n > 0 ? "top" : ""}`}>{i + 1}</span>
          <Avatar nickname={r.p.nickname} size="sm" />
          <span className="who">
            <span className="name">{r.p.nickname}</span>
            <span className="small dim"> {r.p.realName}</span>
            <span className="bar">
              <i style={{ width: `${(r.n / top) * 100}%` }} />
            </span>
          </span>
          <span className="ct">{r.n}</span>
        </div>
      ))}
    </div>
  );
}
