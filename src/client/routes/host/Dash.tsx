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
  HOST_UI,
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
  const { meta, players, prevoteRank, mutual, received } = state;

  const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(meta.phase) + 1] as Phase | undefined;
  const who = (id: string) => players.find((p) => p.id === id);

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
                <Avatar nickname={p!.nickname} gender={p!.gender} />
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

      {/* 💘 상호 매칭 — 자리를 붙일지 판단하는 자리. 제목은 다른 섹션처럼 카드 밖 헤더 행에 */}
      <div className="row between">
        <span className="kicker">{HOST_UI.dash.mutualTitle(mutual.length)}</span>
        <span className="tiny dim">{HOST_UI.dash.live}</span>
      </div>
      <div className="card stack mutualCard">
        {mutual.length === 0 ? (
          <span className="small dim">{HOST_UI.dash.mutualNone}</span>
        ) : (
          mutual.flatMap(([a, b]) => {
            // 두 사람이 다 있어야 그린다. 없는 사람의 성별을 지어내 칠하면 색이 거짓말을 한다
            const [pa, pb] = [who(a), who(b)];
            if (!pa || !pb) return [];
            return (
              <div className="row pairRow" key={`${a}>${b}`}>
                <Avatar nickname={pa.nickname} gender={pa.gender} size="sm" />
                <span className="grow ellipsis">{pa.nickname}</span>
                <span>💘</span>
                <span className="grow ellipsis" style={{ textAlign: "right" }}>
                  {pb.nickname}
                </span>
                <Avatar nickname={pb.nickname} gender={pb.gender} size="sm" />
              </div>
            );
          })
        )}
      </div>

      {/*
        🔥 받은 콕 순위. 현황 탭에서만 본다 (ADR-30) —
        참가자 탭의 개인 행에는 넣지 않는다. 명단을 훑으며 한 사람씩 볼 숫자가 아니다.
      */}
      <Ranking players={players} received={received} />
      {/* 자리 이동 확인율은 여기 두지 않는다 — 자리를 보낸 직후에 보는 숫자라 자리 탭 라운드 카드에 있다 */}
    </div>
  );
}

/**
 * 받은 콕 순위 — **TOP 5, 동점이면 그만큼 늘어난다.**
 *
 * 5위와 같은 수를 받은 사람을 자르면 순위가 거짓말이 된다. 제목의 N 이 실제 수를 말한다.
 * 동점자는 같은 번호를 단다 (5,4,2,2,2 → 1·2·3·3·3위).
 *
 * 0회는 목록에 없다. 전원을 보여주던 때는 "빠짐 = 0회" 가 드러나는 문제가 있었지만,
 * TOP 5 로 자르면 빠짐은 "상위권 아님" 만 말한다 — 오히려 하위권이 가려진다.
 * 바 길이는 1위 대비 비율 — 절대 수보다 "얼마나 몰렸나" 가 눈에 들어온다.
 */
const TOP_RANKS = 5;

export function topRanks(players: ConsoleState["players"], received: Record<string, number>) {
  const ranked = players
    .map((p) => ({ p, n: received[p.id] ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.p.nickname.localeCompare(b.p.nickname));
  const cutoff = ranked[TOP_RANKS - 1]?.n;
  const rows = cutoff === undefined ? ranked : ranked.filter((r) => r.n >= cutoff);
  // 공동 순위: 같은 수 = 같은 번호
  return rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.n === r.n) + 1 }));
}

function Ranking({
  players,
  received,
}: {
  players: ConsoleState["players"];
  received: Record<string, number>;
}) {
  const rows = topRanks(players, received);
  const top = Math.max(1, rows[0]?.n ?? 0);

  return (
    <>
      <div className="row between">
        {/* 비어 있을 때 "TOP 0" 이라 쓰지 않는다 — 이 자리가 담을 수 있는 수(5)를 말한다 */}
        <span className="kicker">{HOST_UI.dash.rankTitle(rows.length || TOP_RANKS)}</span>
        <span className="tiny dim">{HOST_UI.dash.rankNote}</span>
      </div>
      {rows.length === 0 && (
        <div className="card">
          <span className="small dim">{HOST_UI.dash.noVotes}</span>
        </div>
      )}
      <div className="stack">
        {rows.map((r) => (
          <div className="rank" key={r.p.id}>
            {/* 상위 셋만 금색 — 전부 칠하면 아무도 돋보이지 않는다 */}
            <span className={`no ${r.rank <= 3 ? "top" : ""}`}>{r.rank}</span>
            <Avatar nickname={r.p.nickname} gender={r.p.gender} size="sm" />
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
    </>
  );
}
