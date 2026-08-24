/**
 * 현황 탭. 맨 위가 단계 컨트롤이다 — 이 화면에서 가장 자주 하는 일이라서.
 *
 * 모든 전환은 확인창을 거치고, 확인창은 **참가자 화면이 어떻게 바뀌는지** 항목으로 보여준다.
 * 예약이 있는 전환(매력 투표 시작)은 예약과의 차이가 한 줄 더 붙는다.
 *
 * 그 아래는 **지금 쓰이는 것이 위로 온다** (ADR-45).
 *
 *   파티 전 — ✨ 매력 투표 TOP 5 하나뿐. 매칭도 파티 콕도 아직 **있을 수가 없다** (ADR-34),
 *             그 자리에 `아직 없어요` 를 두면 운영자가 뭔가 잘못됐나 하고 한 번 더 본다
 *   파티 후 — 💘 매칭 · 🔥 받은 콕 TOP 5 · ✨ 매력 투표 TOP 5.
 *             매칭이 맨 위다 — 자리를 붙일지 판단하는 게 그 시점의 일이라서.
 *             매력 투표는 끝난 라운드라 기록으로 맨 아래에 남는다
 *
 * ⚠️ **두 순위를 한 수로 합치지 마라** (ADR-45). 쓰임이 다르고, 합치면 파티 30분 치 콕이
 * 며칠 치 표에 묻혀 `콕 TOP` 이 *파티에서 몇 번 받았나* 를 말하지 못한다.
 *
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
  const { meta, players, mutual, received } = state;

  const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(meta.phase) + 1] as Phase | undefined;
  const who = (id: string) => players.find((p) => p.id === id);

  /**
   * 파티가 시작됐나. **매칭과 파티 콕이 존재할 수 있는 시점**이 여기서부터다 (ADR-34).
   * 발표(`done`)도 포함이다 — 파티가 끝나도 그 결과를 계속 본다.
   */
  const started = PHASE_ORDER.indexOf(meta.phase) >= PHASE_ORDER.indexOf("party");

  /**
   * 매력 투표 마감은 **시각이 답한다** (ADR-39). 확인창 두 개가 이걸 읽는다 —
   * 매력 투표 시작은 "언제 닫히나", 파티 시작은 "이미 닫혔나".
   * 서버 시각으로 잰다. 운영자 폰이 빠르면 아직 열려 있는 걸 닫혔다고 말한다.
   */
  const voteEnd = {
    voteEndText: meta.schedule.voteEndAt ? formatWhen(meta.schedule.voteEndAt) : undefined,
    voteClosed: !!meta.schedule.voteEndAt && meta.schedule.voteEndAt <= now(),
  };

  async function go(to: Phase) {
    await post(`/host/events/${meta.id}/phase`, { to });
    reload();
  }

  function ask(to: Phase) {
    // 마지막으로 발행한 라운드에 몇 명이 앉아 있나. 초안은 아직 참가자에게 안 나갔으므로 세지 않는다
    const published = state.seatings.filter((s) => s.status === "published");
    const copy = phaseAction(to, {
      maxPre: meta.config.maxPre,
      maxParty: meta.config.maxParty,
      seated: published.at(-1)?.seats.length ?? 0,
      players: players.length,
      ...voteEnd,
    });
    if (!copy) return;

    const facts = [...copy.facts];
    // 예약이 걸리는 전환은 매력 투표 시작 하나뿐이다 (ADR-36). 나머지는 비교할 시각이 없다
    const scheduled = to === "prevote" ? meta.schedule.prevoteAt : undefined;
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
          {phaseAction(nextPhase, { maxPre: meta.config.maxPre, maxParty: meta.config.maxParty })?.btn}
        </button>
      )}
      {meta.phase === "done" && (
        <button className="btn danger block" onClick={() => run(UNREVEAL, "party")}>
          {UNREVEAL.btn}
        </button>
      )}

      {/*
        **파티가 시작돼야 나오는 둘.** 매칭도 파티 콕도 그전에는 있을 수가 없다 (ADR-34) —
        빈 카드를 미리 세워두면 자리만 차지하고, 운영자는 매번 그게 정상인지 확인하게 된다.
      */}
      {started && (
        <>
          {/* 💘 상호 매칭 — 자리를 붙일지 판단하는 자리. 그래서 파티 중에는 맨 위다 */}
          <div className="row between">
            <span className="kicker">{HOST_UI.dash.mutualTitle(mutual.length)}</span>
            <span className="tiny dim">{HOST_UI.dash.live}</span>
          </div>
          {/*
            **갈래를 나누지 않는다** (ADR-34). 매칭은 이제 파티 콕만 세므로
            사전·엇갈림 같은 갈래가 나올 수 없다 — 매력 투표를 서로 했다는 건
            붙일 의미가 없는 사실이라, 죽은 값을 그리는 대신 걷어냈다.
          */}
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
            순위는 **현황 탭에서만** 본다 (ADR-30) —
            참가자 탭의 개인 행에는 넣지 않는다. 명단을 훑으며 한 사람씩 볼 숫자가 아니다.
          */}
          <Ranking
            players={players}
            received={received.party}
            title={HOST_UI.dash.rankTitle}
            empty={HOST_UI.dash.rankEmpty}
          />
        </>
      )}

      {/* ✨ 매력 투표 — 파티 전에는 이것 하나, 파티가 시작되면 기록으로 맨 아래에 남는다 */}
      <Ranking
        players={players}
        received={received.pre}
        title={HOST_UI.dash.preRankTitle}
        empty={HOST_UI.dash.preRankEmpty}
      />
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
  title,
  empty,
}: {
  players: ConsoleState["players"];
  received: Record<string, number>;
  /** 어느 라운드인지 제목이 말한다. 아래 `rankNote` 는 둘이 함께 쓴다 */
  title: (n: number) => string;
  /** 아무도 못 받았을 때. 라운드마다 낱말이 다르다 (ADR-34) — 매력 투표는 `표`, 파티는 `콕` */
  empty: string;
}) {
  const rows = topRanks(players, received);
  const top = Math.max(1, rows[0]?.n ?? 0);

  return (
    <>
      <div className="row between">
        {/* 비어 있을 때 "TOP 0" 이라 쓰지 않는다 — 이 자리가 담을 수 있는 수(5)를 말한다 */}
        <span className="kicker">{title(rows.length || TOP_RANKS)}</span>
        <span className="tiny dim">{HOST_UI.dash.rankNote}</span>
      </div>
      {rows.length === 0 && (
        <div className="card">
          <span className="small dim">{empty}</span>
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
