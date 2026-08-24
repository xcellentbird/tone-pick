/**
 * 자리 탭.  뺄 사람 고르기 → 테이블 수 → 초안 → 검토·고치기 → 📣 알림 발송
 *
 * · 배정은 **두 걸음**이다 (ADR-45). 뺄 사람을 먼저 고르고 그 다음 테이블 수다 —
 *   `테이블당 N명` 이 남은 인원으로 계산되므로, 순서가 뒤집히면 방금 읽은 숫자가 틀린 것이 된다
 * · 뺀 사람은 **이 라운드에만** 빠진다. 사람에게 붙는 상태가 아니라 다음 배정은 전원으로 시작한다
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
import { useLocation, useNavigate } from "react-router";
import { GENDER, HOST, HOST_UI, SEAT, UNIT } from "../../../shared/copy.ts";
import type { Gender, Player, SeatingRound } from "../../../shared/types.ts";
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
  // 배정 시트도 라우트다. 뒤로 가기로 앞 걸음, 한 번 더 누르면 닫힌다 (ROUTES.md)
  const path = useLocation().pathname;
  const here = `/host/${state.meta.id}/seats`;
  /** 두 걸음 중 어디인가. 주소가 진실이라 새로고침해도 같은 걸음이 뜬다 */
  const sheetOpen = path.startsWith(`${here}/new`);
  const atTables = path.endsWith("/tables");
  /**
   * 고르는 중인 사람. **라운드까지 함께 기억한다** — 카드가 여럿이라
   * 초안에서 고른 사람이 발행된 라운드의 다음 클릭과 짝지어지면 엉뚱한 맞교환이 된다.
   */
  const [picked, setPicked] = useState<{ round: number; playerId: string } | null>(null);
  /**
   * 지금 고치고 있는 발행 라운드 (ADR-51). `null` 이면 전부 잠겨 있다.
   *
   * **기본이 잠김이다** — 이 카드는 대부분 *누가 어디 앉았나* 를 읽으러 여는 자리고,
   * 그때 손가락이 스치면 두 사람이 말없이 바뀐다. 초안은 여기 해당하지 않는다.
   */
  const [openEdit, setOpenEdit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 이번 라운드에서 뺄 사람 (ADR-45).
   *
   * **어디에도 저장하지 않는다.** 사람에게 붙는 상태로 만들면 시간이 지나 틀리고,
   * 틀린 상태가 다음 라운드에서 사람을 조용히 빠뜨린다 (FLOWS.md).
   * 배정 버튼을 누를 때 비워서, 시트를 새로 열면 언제나 전원으로 시작한다.
   */
  const [out, setOut] = useState<Set<string>>(new Set());

  /** 배정 시트를 연다. **고른 것을 비우고 연다** — 지난 라운드의 선택이 따라오면 안 된다 */
  function openSeating() {
    setOut(new Set());
    navigate(`${here}/new`);
  }
  // 두 번째 라운드에서는 같은 테이블 수를 다시 고르는 일이 흔하다. 지난번 값에서 시작한다
  const lastTableCount =
    state.seatings.at(-1)?.tableCount ?? Math.max(1, Math.round(state.players.length / 6)) ?? 1;

  const base = `/host/events/${state.meta.id}/seating`;
  const draft = state.seatings.find((s) => s.status === "draft");
  /**
   * 서로 찌른 사람들. **모든 라운드에서 쓴다** (ADR-51) — 쌍을 붙이는 일이
   * 알고리즘에서 운영자의 손으로 옮겨왔으므로, 어느 라운드에서든 짚어줘야 한다.
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

  async function make(tableCount: number) {
    setBusy(true);
    try {
      await post(base, { tableCount, exclude: [...out] });
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
    /*
     * **붙어 앉은 쌍은 섞어도 제자리다** (ADR-23). 그 사실은 붙은 쌍이 있을 때만 말한다 —
     * 없을 때 말하면 있지도 않은 일을 알리는 것이 된다.
     */
    const held = draft ? pairStats(draft, state.mutual).together : 0;
    toast(held > 0 ? HOST_UI.seats.shuffleKeepsPairs : HOST.seating.shuffled);
    setPicked(null);
    reload();
  }

  /**
   * 이 맞교환으로 **떨어지게 되는 짝**들. **모든 라운드에서 본다** (ADR-51) —
   * 운영자가 손으로 붙여둔 쌍을 다음 맞교환이 조용히 떼면 그 손이 헛일이 된다.
   * 첫 라운드에는 상호 매칭이 없어 이 목록이 늘 비어 있다.
   *
   * 여러 명과 이어진 사람이면 여럿이 한꺼번에 떨어질 수 있다.
   */
  function pairsBrokenBy(round: SeatingRound, a: string, b: string): Array<[string, string]> {
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
          /*
           * **쌍이 있을 때만 그 줄을 넣는다** (ADR-51). 첫 라운드에는 상호 매칭이 없어서
           * `0쌍 중 0쌍` 이 뜨는데, 그건 나쁜 소식처럼 읽히고 실은 아무 말도 아니다.
           */
          ...((pairs.total > 0
            ? [[HOST_UI.seats.pairLabel, HOST_UI.seats.pairSummary(pairs.together, pairs.total)]]
            : []) as Array<[string, string]>),
          [HOST_UI.seats.roundTitle(round.round), HOST.seating.draftOnly],
        ],
      },
      async () => {
        await post(`${base}/publish`);
        toast(HOST.seating.published(round.round));
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
      {/*
        **버튼은 하나뿐이다** (ADR-51). 옆에 `💘 커플 자리 배정` 이 있었는데 걷어냈다 —
        콕이 매 라운드 자리에 반영되므로 쌍만 모으는 전용 라운드가 필요 없고,
        못 붙은 쌍은 아래 카드가 💘·💔 로 짚어준다. 붙이는 건 맞교환이 한다.
      */}
      <button
        className="btn primary block"
        onClick={openSeating}
        disabled={revealed || state.players.length < 2}
      >
        {HOST_UI.seats.make}
      </button>

      {/*
        **두 걸음이 한 시트를 나눠 쓴다** (ADR-45). 걸음은 주소가 정하므로
        뒤로 가기가 곧 `이전` 이고, 한 번 더 누르면 시트가 닫힌다.
      */}
      <Sheet
        open={sheetOpen}
        onClose={() => navigate(-1)}
        title={atTables ? HOST_UI.seats.tableCount : HOST_UI.seats.excludeTitle}
      >
        {atTables ? (
          <TablePicker
            players={state.players.filter((p) => !out.has(p.id))}
            excluded={out.size}
            start={lastTableCount}
            busy={busy}
            onGo={make}
          />
        ) : (
          <ExcludePicker
            players={state.players}
            out={out}
            onToggle={(id) =>
              setOut((prev) => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })
            }
            onNext={() => navigate(`${here}/new/tables`)}
          />
        )}
      </Sheet>

      {draft && !revealed && (
        <div className="card stack">
          <div className="kicker">{HOST_UI.seats.roundTitle(draft.round)}</div>
          {/*
            쌍 성적표. **모든 라운드에서 보인다** (ADR-51) — 떨어진 쌍의 이름이
            운영자가 맞교환으로 손볼 목록 그 자체다.
          */}
          <PairReport round={draft} mutual={state.mutual} state={state} />
          {editBar(draft)}
          <Tables
            round={draft}
            picked={picked?.round === draft.round ? picked.playerId : null}
            onPick={(id) => swap(draft, id)}
            state={state}
            partners={partners}
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

      {[...published].reverse().map((round, i) => {
        /*
         * **가장 최신 라운드만 고칠 수 있다** (ADR-49).
         *
         * 목록은 최신이 위라 `i === 0` 이 그것이다. 지난 라운드를 고쳐도 사람들은 이미
         * 다음 자리에 앉아 있어서 아무 데도 반영되지 않는다 — 고쳤다는 사실만 남는다.
         * 발표 뒤에는 최신 라운드도 잠긴다 (ADR-28). 서버도 같은 문을 닫아둔다.
         */
        const editable = i === 0 && !revealed;
        const editing = editable && openEdit === round.round;
        return (
          <div className="card stack" key={round.round}>
            {/*
              자리 이동 확인 수는 **고치는 문이 열려도 남는다** — 지금 사람들이 답하고 있는
              라운드가 바로 이것이라, 여기서 사라지면 볼 자리가 없어진다.
            */}
            <div className="row">
              <span className="kicker grow ellipsis">{HOST_UI.seats.roundTitle(round.round)}</span>
              <span className="small dim">{HOST.ack.progress(round.acks.length, round.seats.length)}</span>
              {editable && (
                <button
                  className={`btn ghost tiny ${editing ? "primary" : ""}`}
                  onClick={() => {
                    setPicked(null);
                    setOpenEdit(editing ? null : round.round);
                  }}
                >
                  {editing ? HOST_UI.seats.editDone : HOST_UI.seats.edit}
                </button>
              )}
            </div>
            {/*
              **설명은 고치는 동안에만, 한 줄만 선다** (ADR-49). 읽으러 연 사람에게는
              테이블이 먼저다 — 늘 떠 있던 설명 넷이 화면 위쪽을 통째로 먹고 있었다.
            */}
            {editing && editBar(round)}
            {/*
              쌍 성적표도 **고치는 동안에만** 선다 (ADR-49 + ADR-51). 이건 읽을거리가 아니라
              **작업 목록**이다 — 떨어진 쌍의 이름이 곧 맞교환할 대상이다.
              읽으러 연 사람에게는 테이블이 먼저라는 이 카드의 규칙을 그대로 따른다.
            */}
            {editing && <PairReport round={round} mutual={state.mutual} state={state} />}
            <Tables
              round={round}
              picked={picked?.round === round.round ? picked.playerId : null}
              onPick={(id) => swap(round, id)}
              state={state}
              partners={partners}
              locked={!editing}
            />
            <Unassigned round={round} state={state} onSeat={editing ? (id) => seat(round, id) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * **첫 걸음 — 뺄 사람을 고른다** (ADR-45).
 *
 * 테이블 수보다 먼저 오는 이유가 하나다. 다음 걸음의 `테이블당 N명` 이 여기서 남은
 * 인원으로 계산되므로, 순서가 뒤집히면 방금 읽은 숫자가 곧바로 틀린 것이 된다.
 *
 * **이번 라운드에만 빠진다.** 참가자에게 붙는 상태를 만들지 않는다 — 노쇼는 다음 라운드에
 * 나타날 수 있고, 온 사람이 잠깐 빠질 수도 있다. 시트를 새로 열면 전원으로 돌아온다.
 *
 * 기본은 **전원 배정**이다. 대부분의 라운드가 그렇고, 아무도 안 뺄 사람은 그대로 다음을 누른다.
 */
function ExcludePicker({
  players,
  out,
  onToggle,
  onNext,
}: {
  players: Player[];
  out: Set<string>;
  onToggle: (id: string) => void;
  onNext: () => void;
}) {
  const seated = players.length - out.size;
  /**
   * 성별로 걸러 본다. **참가자 탭과 같은 칩·같은 순서다** —
   * 사람이 서른을 넘으면 한 목록에서 한 사람을 찾는 게 일이 된다.
   * 두 화면이 다른 모양으로 거르면 운영자가 매번 어느 쪽인지 다시 익혀야 한다.
   */
  const [filter, setFilter] = useState<"all" | Gender>("all");
  const shown = players.filter((p) => filter === "all" || p.gender === filter);
  const count = {
    all: players.length,
    M: players.filter((p) => p.gender === "M").length,
    F: players.filter((p) => p.gender === "F").length,
  } as const;

  return (
    <div className="stack">
      <p className="small dim">{HOST_UI.seats.excludeNote}</p>

      {/* 한 버튼을 껐다 켜면 지금 어느 쪽인지 알 수 없다. 셋 중 하나가 항상 켜져 있다 */}
      <div className="choice">
        {(
          [
            ["all", HOST_UI.players.filterAll],
            ["M", GENDER.M],
            ["F", GENDER.F],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="filterCount">{count[key]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="dim center">{HOST_UI.players.emptyFiltered}</p>}

      <div className="stack">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`fact ${out.has(p.id) ? "" : "on"}`}
            aria-pressed={!out.has(p.id)}
            onClick={() => onToggle(p.id)}
          >
            <Avatar nickname={p.nickname} gender={p.gender} size="sm" />
            <span className="grow ellipsis">{p.nickname}</span>
            {/* 톤만으로 말하지 않는다. 지금 어느 쪽인지 글자가 같은 정보를 다시 준다 */}
            <span className={out.has(p.id) ? "dim" : ""}>
              {out.has(p.id) ? HOST_UI.seats.excludeOut : HOST_UI.seats.excludeIn}
            </span>
          </button>
        ))}
      </div>

      {/*
        다음 걸음이 이 숫자로 계산한다. 넘어가기 전에 한 번 말해준다.
        **거른 것과 상관없이 언제나 전원 기준이다** — 남성만 보고 있다고 여성이 빠진 게 아니다.
      */}
      <div className="fact">
        <span className="grow">
          {out.size > 0 ? HOST_UI.seats.leftOut(seated, out.size) : HOST_UI.seats.seatedAll(seated)}
        </span>
      </div>

      {/* 테이블 하나에 둘은 앉아야 한다. 그 아래로는 다음 걸음에서 할 수 있는 게 없다 */}
      <button className="btn primary block" disabled={seated < 2} onClick={onNext}>
        {HOST_UI.seats.excludeNext}
      </button>
    </div>
  );
}

/**
 * **둘째 걸음 — 테이블 수를 고른다.**
 *
 * 숫자만 받지 않는다 — 그 숫자가 **어떤 자리를 만드는지** 함께 보여준다.
 * 테이블당 몇 명이고 남녀가 몇인지 보이지 않으면, 8을 넣어보고 결과를 보고 다시 6으로
 * 되돌리는 일을 반복하게 된다.
 *
 * 받는 명단은 **이미 뺄 사람이 빠진 것**이다. 여기서 다시 거르지 않는다 —
 * 거르는 곳이 둘이면 언젠가 둘이 어긋난다.
 */
function TablePicker({
  players,
  excluded,
  start,
  busy,
  onGo,
}: {
  players: Player[];
  /** 앞 걸음에서 뺀 사람 수. 인원이 왜 줄었는지 이 걸음에서도 말해야 한다 */
  excluded: number;
  start: number;
  busy: boolean;
  onGo: (tableCount: number) => void;
}) {
  const [count, setCount] = useState(start);
  const people = players.length;
  const men = players.filter((p) => p.gender === "M").length;
  const per = count > 0 ? people / count : 0;
  const perMen = count > 0 ? men / count : 0;

  return (
    <div className="stack">
      {/*
        **테이블 수보다 먼저** 인원을 말한다. 아래 `테이블당 N명` 이 이 인원으로 계산되므로,
        빠진 사람이 있는 줄 모르면 방금 읽은 숫자가 왜 그런지 알 수 없다.
        나간 사람이 없으면 `N명 배정` 한 줄이다 — 없는 일을 알리지 않는다.
      */}
      <div className="fact">
        <span className="grow">
          {excluded > 0 ? HOST_UI.seats.leftOut(people, excluded) : HOST_UI.seats.seatedAll(people)}
        </span>
      </div>
      {excluded > 0 && <p className="small dim">{HOST_UI.seats.leftOutNote}</p>}

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

      <button className="btn primary block" disabled={busy} onClick={() => onGo(count)}>
        {HOST_UI.seats.make}
      </button>
    </div>
  );
}

/**
 * 서로 찌른 쌍이 **같은 테이블에 앉았는가**. 자리 검토의 성적표다 (ADR-51).
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
  /**
   * 사람 → 서로 찌른 상대들 (ADR-51). **모든 라운드에서 넘어온다.**
   * 붙어 앉았으면 💘, 다른 테이블에 있으면 💔 — 뒤엣것이 곧 옮길 수 있다는 신호다.
   */
  partners: Map<string, Set<string>>;
  state: ReturnType<typeof useConsole>["state"];
  /** 발표 후. 자리는 그대로 보이고 **누르는 것만** 잠긴다 */
  locked?: boolean;
}) {
  const tables = Array.from({ length: round.tableCount }, (_, i) => i + 1);
  /** 이 라운드에서 누가 몇 번 테이블인가. 짝이 어디 앉았는지 보려면 자리 전체가 필요하다 */
  const seatedAt = new Map(round.seats.map((s) => [s.playerId, s.table]));
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
              /*
               * 이 사람의 짝 중 **이 라운드에 자리가 있는** 사람들 (ADR-24 — 여럿일 수 있다).
               * 자리 없는 짝은 세지 않는다 — 맞교환으로 붙일 수 없어서 짚어줘도 할 일이 없다.
               */
              const mates = [...(partners.get(person.id) ?? [])].filter((id) => seatedAt.has(id));
              const together = mates.filter((id) => seatedAt.get(id) === t).length;
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
                      {mates.length > 0 && `${HOST_UI.seats.pairChip(together)} `}
                      {person.nickname}
                    </span>
                    {/* 색만으로 구분하지 않는다 */}
                    <span className="sex">{person.gender === "M" ? "♂" : "♀"}</span>
                  </span>
                  {/* 운영자만 전체를 본다 — 자리에서 사람을 찾으려면 실명이 필요하다 */}
                  {/* 그림만으로 말하지 않는다 — 💘·💔 가 뜻하는 것을 글자로도 준다 */}
                  <span className="tiny dim ellipsis" style={{ display: "block" }}>
                    {person.realName} · {UNIT.age(person.age)} · {person.mbti}
                    {mates.length > 0 && ` · ${HOST_UI.seats.pairChipNote(together)}`}
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
      {/* 경고가 아니라 할 일이다 — 아래 칩과 같은 색으로 묶는다 */}
      <span className="small accentText">{HOST_UI.seats.unassigned}</span>
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
