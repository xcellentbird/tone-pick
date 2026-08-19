/**
 * 자리 탭.  테이블 수 선택 → 초안 → 검토·고치기 → 📣 알림 발송
 *
 * · 테이블 수는 **배정할 때마다** 고른다. 설정값이 아니다 (ADR-5)
 * · 초안 생성에는 확인을 붙이지 않는다 — 참가자에게 안 보이고 몇 번이든 다시 만들 수 있다
 * · 발송에는 확인을 붙인다 — 참가자 화면을 덮는 확인 화면이 뜬다
 * · 좌석 **변경**은 맞교환 하나뿐이다. 한 명만 옮기는 버튼을 만들면 테이블 인원이 어긋난다
 * · 남녀를 맞바꾸는 것도 된다 — 바뀐 성비는 테이블 머리의 `남 N / 여 M` 에 바로 보인다
 *
 * **발행된 라운드도 고칠 수 있다** (슬라이스 11). 초안과 같은 조작 셋이 붙는다 —
 * 맞교환 · 앉히기 · 자리 비우기. 예전에는 발행하면 손댈 수 없어서, 한 명이 늦게 왔을 때
 * 쓸 수 있는 게 새 라운드 발행뿐이었다 (전원이 옮기고 전원이 확인 화면을 다시 받았다).
 * 고친 자리에는 **알림이 가지 않는다** — 운영자가 그 사람 앞에서 하는 일이라
 * 앱이 대신 말할 게 없다. 화면은 방송으로 다시 읽는다 (ADR-26).
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { HOST, HOST_UI, SEAT, UNIT } from "../../../shared/copy.ts";
import type { SeatingRound } from "../../../shared/types.ts";
import { LIMITS } from "../../../shared/constants.ts";
import { ApiError, del, post } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import Avatar from "../../ui/Avatar.tsx";
import Sheet from "../../ui/Sheet.tsx";
import { Num } from "./HostDefaults.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Seats() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const navigate = useNavigate();
  // 테이블 수를 고르는 시트도 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md)
  const { mode } = useParams();
  const here = `/host/${state.meta.id}/seats`;
  /**
   * 고르는 중인 사람. **라운드까지 함께 기억한다** — 카드가 여럿이라
   * 초안에서 고른 사람이 발행된 라운드의 다음 클릭과 짝지어지면 엉뚱한 맞교환이 된다.
   */
  const [picked, setPicked] = useState<{ round: number; playerId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 두 번째 라운드에서는 같은 테이블 수를 다시 고르는 일이 흔하다. 지난번 값에서 시작한다
  const lastTableCount =
    state.seatings.at(-1)?.tableCount ?? Math.max(1, Math.round(state.players.length / 6)) ?? 1;

  const base = `/host/events/${state.meta.id}/seating`;
  const draft = state.seatings.find((s) => s.status === "draft");
  /**
   * 서로 찌른 사람들. 커플 자리에서만 쓴다 — 다른 라운드는 쌍을 붙이려 하지 않는다.
   *
   * **한 사람이 여러 명과 이어질 수 있다** (A-B, A-C). 콕이 1인당 여러 번이라 당연한 일이다.
   * 그래서 짝은 하나가 아니라 **집합**이다 — 하나만 들고 있으면 나중 것이 앞의 것을 덮어
   * A-B 가 화면에서 조용히 사라진다 (ADR-24).
   */
  const partners = new Map<string, Set<string>>();
  for (const [a, b] of state.mutual) {
    for (const [one, other] of [[a, b], [b, a]] as const) {
      const set = partners.get(one) ?? new Set<string>();
      set.add(other);
      partners.set(one, set);
    }
  }
  const published = state.seatings.filter((s) => s.status === "published");
  const revealed = state.meta.phase === "done";

  async function make(final: boolean, tableCount: number) {
    setBusy(true);
    try {
      await post(base, { tableCount, final });
      navigate(here, { replace: true });
      reload();
    } catch (e) {
      // 이 화면에서 400 이 나올 이유는 인원 대비 테이블이 많은 것뿐이다
      toast(e instanceof ApiError && e.status === 400 ? HOST.seating.tooFewPerTable : HOST.seating.afterReveal);
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.nickname ?? "";

  async function shuffle() {
    await post(`${base}/shuffle`);
    // 커플 자리에서는 쌍이 제자리에 남는다. 그 사실을 그때 말해준다
    toast(draft?.final ? HOST_UI.seats.shuffleKeepsPairs : HOST.seating.shuffled);
    setPicked(null);
    reload();
  }

  /**
   * 이 맞교환으로 **떨어지게 되는 짝**들. 커플 자리에서만 본다.
   * 여러 명과 이어진 사람이면 여럿이 한꺼번에 떨어질 수 있다.
   */
  function pairsBrokenBy(round: SeatingRound, a: string, b: string): Array<[string, string]> {
    if (!round.final) return [];
    const table = new Map(round.seats.map((s) => [s.playerId, s.table]));
    const out: Array<[string, string]> = [];
    for (const [one, other] of [[a, b], [b, a]] as const) {
      for (const mate of partners.get(one) ?? []) {
        // 짝과 지금 같은 테이블인데, 옮겨 갈 자리가 다른 테이블이면 이 교환으로 떨어진다.
        // 상대가 그 짝 본인이면 둘이 같은 테이블이라 아무 일도 안 난다
        if (mate === other) continue;
        if (table.get(one) === table.get(mate) && table.get(other) !== table.get(one)) out.push([one, mate]);
      }
    }
    return out;
  }

  /** 같은 카드 안에서 두 명을 차례로 고르면 맞바꾼다. 다른 카드를 누르면 거기서 새로 고른다 */
  async function swap(round: SeatingRound, playerId: string) {
    if (picked?.round !== round.round) return setPicked({ round: round.round, playerId });
    if (picked.playerId === playerId) return setPicked(null);
    const first = picked.playerId;
    setPicked(null);

    // 막지는 않는다 — 현장 사정은 운영자가 안다. 다만 무엇이 깨지는지는 말한다
    const run = async () => {
      // 남녀를 맞바꿔도 된다. 인원은 그대로고, 바뀐 성비는 테이블 머리의 숫자에 바로 보인다
      await post(`${base}/swap`, { a: first, b: playerId, round: round.round });
      reload();
    };
    const broken = pairsBrokenBy(round, first, playerId);
    if (broken.length > 0) {
      return confirm(
        {
          btn: HOST_UI.seats.breakBtn,
          title: HOST_UI.seats.breakTitle,
          danger: true,
          note: HOST_UI.seats.breakNote,
          // 떨어지는 쌍을 전부 이름으로 보여준다. 한 번에 여럿이 깨질 수 있다
          facts: broken.map(([x, y]) => [HOST_UI.seats.pairLabel, HOST_UI.dash.mutualPair(nameOf(x), nameOf(y))]),
        },
        run,
      );
    }
    await run();
  }

  /**
   * 자리 없는 사람을 앉힌다. **테이블은 보내지 않는다** — 서버가 고른다 (SEATING.md).
   * 그래서 어디에 앉았는지는 응답을 보고 말해준다. 운영자가 그 번호를 그 사람에게 전한다.
   */
  async function seat(round: SeatingRound, playerId: string) {
    const next = await post<SeatingRound>(`${base}/seat`, { playerId, round: round.round });
    const table = next.seats.find((s) => s.playerId === playerId)?.table;
    if (table) toast(HOST_UI.seats.seatedAt(nameOf(playerId), table));
    reload();
  }

  /** 이 라운드 자리에서만 뺀다. 참가자를 지우는 것과 다른 일이다 — 되돌릴 수 있어 확인이 없다 */
  async function unseat(round: SeatingRound, playerId: string) {
    setPicked(null);
    await post(`${base}/unseat`, { playerId, round: round.round });
    toast(HOST_UI.seats.unseated(nameOf(playerId)));
    reload();
  }

  /**
   * 카드 머리의 한 줄. 고른 사람이 없으면 무엇을 할 수 있는지, 있으면 누구를 골랐는지 —
   * **자리 비우기는 고른 뒤에만** 보인다. 상시로 두면 사람마다 버튼이 하나씩 붙는다.
   */
  function editBar(round: SeatingRound) {
    const one = picked?.round === round.round ? picked.playerId : null;
    if (!one) return <p className="small dim">{HOST_UI.seats.swapHint}</p>;
    return (
      <div className="row between">
        <span className="small grow ellipsis">{HOST_UI.seats.pickedOne(nameOf(one))}</span>
        <button className="btn ghost" onClick={() => unseat(round, one)}>
          {HOST_UI.seats.unseat}
        </button>
      </div>
    );
  }

  function askPublish(round: SeatingRound) {
    const perTable = round.seats.length / round.tableCount;
    const pairs = pairStats(round, state.mutual);
    confirm(
      {
        btn: HOST.seating.publish,
        title: HOST_UI.seats.publishTitle,
        facts: [
          [HOST_UI.seats.tableCount, `${round.tableCount}`],
          [HOST_UI.seats.seated, HOST_UI.seats.seatedCount(round.seats.length, Math.round(perTable))],
          // 커플 자리는 성적표를 함께 보여준다. 배정이 닫히지는 않는다 — 한 번 더 할 수 있다
          ...(round.final
            ? ([[HOST_UI.seats.pairLabel, HOST_UI.seats.pairSummary(pairs.together, pairs.total)]] as Array<[string, string]>)
            : ([[HOST_UI.seats.roundTitle(round.round, false), HOST.seating.draftOnly]] as Array<[string, string]>)),
        ],
      },
      async () => {
        await post(`${base}/publish`);
        toast(HOST.seating.published(round.round, round.final));
        reload();
      },
    );
  }

  return (
    <div className="stack">
      {/*
        발표가 끝나도 **화면은 그대로 있다.** 운영자는 끝난 뒤에도 누가 어디 앉았는지를 본다 —
        다음 회차 자리를 짤 때, 사진을 정리할 때. 한동안 이 문장 하나가 탭 전체를 덮고 있었다.
        잠기는 건 고치는 버튼뿐이고, 서버도 같은 문을 닫아둔다 (ADR-28).
      */}
      {revealed && <p className="small dim">{HOST.seating.afterReveal}</p>}

      {/*
        테이블 수는 설정이 아니라 **배정 시점의 입력값**이다 (ADR-5).
        상시 노출된 스테퍼는 설정처럼 보였다 — 누를 때 묻는 게 구조와 화면을 일치시킨다.
      */}
      <div className="row">
        <button
          className="btn wide"
          onClick={() => navigate(`${here}/new`)}
          disabled={revealed || state.players.length < 2}
        >
          {HOST_UI.seats.make}
        </button>
        <button
          className="btn wide gold"
          onClick={() => navigate(`${here}/final`)}
          disabled={revealed || state.players.length < 2}
        >
          {HOST.seating.makeFinal}
        </button>
      </div>

      <Sheet open={!!mode} onClose={() => navigate(-1)} title={HOST_UI.seats.tableCount}>
        <TablePicker
          people={state.players.length}
          men={state.players.filter((p) => p.gender === "M").length}
          pairs={state.mutual.length}
          final={mode === "final"}
          start={lastTableCount}
          busy={busy}
          onGo={(count) => make(mode === "final", count)}
        />
      </Sheet>

      {draft && !revealed && (
        <div className="card stack">
          <div className="kicker">{HOST_UI.seats.roundTitle(draft.round, draft.final)}</div>
          {/* 커플 자리의 성적표. 이 라운드가 제 일을 했는지 여기서 보인다 (ADR-23) */}
          {draft.final && <PairReport round={draft} mutual={state.mutual} state={state} />}
          {editBar(draft)}
          <Tables
            round={draft}
            picked={picked?.round === draft.round ? picked.playerId : null}
            onPick={(id) => swap(draft, id)}
            state={state}
            partners={draft.final ? partners : undefined}
          />
          {/* 초안에도 자리 없는 사람이 있다 — 배정을 누른 뒤에 등록한 사람 */}
          <Unassigned round={draft} state={state} onSeat={(id) => seat(draft, id)} />
          <div className="row">
            <button
              className="btn wide ghost"
              onClick={async () => {
                setPicked(null);
                await del(base);
                toast(HOST.seating.discarded);
                reload();
              }}
            >
              {HOST_UI.seats.discard}
            </button>
            {/* 계산은 그대로, 사람만 다시 섞는다. 테이블마다 남 몇·여 몇인지는 그대로다 */}
            <button className="btn wide" onClick={shuffle}>
              🔀 {HOST_UI.seats.shuffle}
            </button>
          </div>
          <button className="btn primary block" onClick={() => askPublish(draft)}>
            {HOST.seating.publish}
          </button>
        </div>
      )}

      {published.length === 0 && (!draft || revealed) && <p className="dim center">{HOST_UI.seats.noRounds}</p>}

      {[...published].reverse().map((round) => (
        <div className="card stack" key={round.round}>
          <div className="row between">
            <span className="kicker">{HOST_UI.seats.roundTitle(round.round, round.final)}</span>
            <span className="small dim">{HOST.ack.progress(round.acks.length, round.seats.length)}</span>
          </div>
          {/* 알림이 가지 않는다는 걸 고치기 전에 말한다 — 앱이 말해주는 줄 알면 그 사람은 옛 자리에 앉아 있다 */}
          {!revealed && <p className="tiny dim">{HOST_UI.seats.editQuiet}</p>}
          {!revealed && editBar(round)}
          <Tables
            round={round}
            picked={picked?.round === round.round ? picked.playerId : null}
            onPick={(id) => swap(round, id)}
            state={state}
            partners={round.final ? partners : undefined}
            locked={revealed}
          />
          <Unassigned round={round} state={state} onSeat={revealed ? undefined : (id) => seat(round, id)} />
        </div>
      ))}
    </div>
  );
}

/**
 * 테이블 수를 고르는 자리. 배정 버튼을 누르면 여기부터 열린다.
 *
 * 숫자만 받지 않는다 — 그 숫자가 **어떤 자리를 만드는지** 함께 보여준다.
 * 테이블당 몇 명이고 남녀가 몇인지 보이지 않으면, 8을 넣어보고 결과를 보고 다시 6으로
 * 되돌리는 일을 반복하게 된다.
 */
function TablePicker({
  people,
  men,
  pairs,
  final,
  start,
  busy,
  onGo,
}: {
  people: number;
  men: number;
  pairs: number;
  final: boolean;
  start: number;
  busy: boolean;
  onGo: (tableCount: number) => void;
}) {
  const [count, setCount] = useState(start);
  const per = count > 0 ? people / count : 0;
  const perMen = count > 0 ? men / count : 0;

  return (
    <div className="stack">
      <Num
        label={HOST_UI.seats.tableCount}
        value={count}
        min={1}
        max={Math.min(LIMITS.tableMax, Math.max(1, Math.floor(people / 2)))}
        onChange={setCount}
      />

      {/* 이 숫자가 만드는 자리를 미리 보여준다 */}
      <div className="fact">
        <span className="grow">{HOST_UI.seats.preview(Math.round(per), Math.round(perMen))}</span>
      </div>
      <PerTableWarning people={people} tables={count} />

      {/* 커플 자리는 목적이 하나다. 몇 쌍을 붙이려는 참인지 여기서 말한다 */}
      {final && <p className="small dim">{HOST_UI.seats.finalNote(pairs)}</p>}

      <button className={`btn block ${final ? "gold" : "primary"}`} disabled={busy} onClick={() => onGo(count)}>
        {final ? HOST.seating.makeFinal : HOST_UI.seats.make}
      </button>
    </div>
  );
}

/**
 * 서로 찌른 쌍이 **같은 테이블에 앉았는가**. 커플 자리의 성적표다.
 *
 * **쌍 목록을 그대로 센다.** 사람→짝 지도에서 세면 한 사람이 여러 명과 이어졌을 때
 * 쌍 하나가 통째로 빠진다 (ADR-24).
 */
function pairStats(round: SeatingRound, mutual: Array<[string, string]>) {
  const table = new Map(round.seats.map((s) => [s.playerId, s.table]));
  let total = 0;
  const split: Array<[string, string]> = [];
  for (const [a, b] of mutual) {
    // 이 라운드에 자리가 없는 사람(늦게 등록)은 세지 않는다
    if (!table.has(a) || !table.has(b)) continue;
    total++;
    if (table.get(a) !== table.get(b)) split.push([a, b]);
  }
  return { total, together: total - split.length, split };
}

/** 이 배정이 제 일을 했는지 한눈에. 못 붙인 쌍은 운영자가 손볼 수 있는 유일한 신호다 */
function PairReport({
  round,
  mutual,
  state,
}: {
  round: SeatingRound;
  mutual: Array<[string, string]>;
  state: ReturnType<typeof useConsole>["state"];
}) {
  const { total, together, split } = pairStats(round, mutual);
  const name = (id: string) => state.players.find((p) => p.id === id)?.nickname ?? "";
  if (total === 0) return <p className="small dim">{HOST_UI.seats.pairNone}</p>;
  return (
    <div className="stack">
      <span className="small">{HOST_UI.seats.pairSummary(together, total)}</span>
      {split.length === 0 ? (
        <span className="small okText">{HOST_UI.seats.pairAllTogether}</span>
      ) : (
        <span className="small warnText">
          {HOST_UI.seats.pairSplit(split.map(([a, b]) => `${name(a)} ↔ ${name(b)}`).join(", "))}
        </span>
      )}
    </div>
  );
}

function Tables({
  round,
  picked,
  onPick,
  state,
  partners,
  locked,
}: {
  round: SeatingRound;
  picked: string | null;
  onPick: (playerId: string) => void;
  /** 있으면 같은 테이블에 앉은 짝에 💘 를 붙인다. 커플 자리에서만 넘어온다 */
  partners?: Map<string, Set<string>>;
  state: ReturnType<typeof useConsole>["state"];
  /** 발표 후. 자리는 그대로 보이고 **누르는 것만** 잠긴다 */
  locked?: boolean;
}) {
  const tables = Array.from({ length: round.tableCount }, (_, i) => i + 1);
  return (
    <div className="tableGrid">
      {tables.map((t) => {
        const here = round.seats
          .map((s) => (s.table === t ? state.players.find((p) => p.id === s.playerId) : null))
          .filter((p): p is NonNullable<typeof p> => !!p);
        const men = here.filter((p) => p.gender === "M").length;
        return (
          <div className="stack" key={t}>
            <div className="tiny dim">{SEAT.banner(t)}</div>
            {/* 테이블마다 남녀가 몇인지 — 맞교환할지 판단하는 숫자다 */}
            <div className="tiny tableMix">
              <span className="men">{HOST_UI.seats.men(men)}</span>
              <span className="women">{HOST_UI.seats.women(here.length - men)}</span>
            </div>
            {here.map((person) => {
              // 이 테이블에 함께 앉은 짝이 **몇 명인가**. 여러 명과 이어질 수 있다 (ADR-24)
              const mates = [...(partners?.get(person.id) ?? [])].filter((id) => here.some((x) => x.id === id));
              return (
              <button
                className={`seatChip ${person.gender === "M" ? "m" : "f"} ${picked === person.id ? "picked" : ""}`}
                key={person.id}
                disabled={locked}
                onClick={() => onPick(person.id)}
              >
                <Avatar nickname={person.nickname} gender={person.gender} size="sm" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row between">
                    <span className="ellipsis">
                      {mates.length > 0 && (mates.length > 1 ? `💘×${mates.length} ` : "💘 ")}
                      {person.nickname}
                    </span>
                    {/* 색만으로 구분하지 않는다 */}
                    <span className="sex">{person.gender === "M" ? "♂" : "♀"}</span>
                  </span>
                  {/* 운영자만 전체를 본다 — 자리에서 사람을 찾으려면 실명이 필요하다 */}
                  <span className="tiny dim ellipsis" style={{ display: "block" }}>
                    {person.realName} · {UNIT.age(person.age)} · {person.mbti}
                  </span>
                </span>
              </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 이 라운드에 자리가 없는 사람 — 배정 뒤에 등록했거나, 운영자가 자리를 비웠거나.
 *
 * **이름이 버튼이다.** 예전에는 알리기만 하고 할 수 있는 일이 없어서,
 * 한 명 때문에 새 라운드를 발행해야 했다 (전원이 옮겼다).
 */
function Unassigned({
  round,
  state,
  onSeat,
}: {
  round: SeatingRound;
  state: ReturnType<typeof useConsole>["state"];
  /** 없으면 읽기만 한다 — 발표 후에는 앉힐 수 없다 */
  onSeat?: (playerId: string) => void;
}) {
  const seated = new Set(round.seats.map((s) => s.playerId));
  const missing = state.players.filter((p) => !seated.has(p.id));
  if (missing.length === 0) return null;
  if (!onSeat) {
    return (
      <p className="small dim">
        {HOST_UI.seats.unassigned}: {missing.map((p) => p.nickname).join(", ")}
      </p>
    );
  }
  return (
    <div className="stack">
      <span className="small warnText">{HOST_UI.seats.unassigned}</span>
      <div className="chips">
        {missing.map((p) => (
          <button className="btn ghost chipBtn" key={p.id} onClick={() => onSeat(p.id)}>
            {p.nickname}
          </button>
        ))}
      </div>
      <span className="tiny dim">{HOST_UI.seats.unassignedHint}</span>
    </div>
  );
}

function PerTableWarning({ people, tables }: { people: number; tables: number }) {
  const per = tables > 0 ? people / tables : 0;
  if (per < LIMITS.seatPerTable.warnBelow) return <p className="small warnText">{HOST.seating.tooFewPerTable}</p>;
  if (per > LIMITS.seatPerTable.warnAbove) return <p className="small warnText">{HOST.seating.tooManyPerTable}</p>;
  return null;
}
