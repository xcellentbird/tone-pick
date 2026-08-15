/**
 * 자리 탭.  테이블 수 선택 → 초안 → 검토·맞교환 → 📣 알림 발송
 *
 * · 테이블 수는 **배정할 때마다** 고른다. 설정값이 아니다 (ADR-5)
 * · 초안 생성에는 확인을 붙이지 않는다 — 참가자에게 안 보이고 몇 번이든 다시 만들 수 있다
 * · 발송에는 확인을 붙인다 — 참가자 화면을 덮는 확인 화면이 뜬다
 * · 좌석 변경은 **맞교환 하나뿐**이다. 한 명만 옮기는 버튼을 만들면 테이블 인원이 어긋난다
 * · 남녀를 맞바꾸는 것도 된다 — 바뀐 성비는 테이블 머리의 `남 N / 여 M` 에 바로 보인다
 */
import { useState } from "react";
import { HOST, HOST_UI, UNIT } from "../../../shared/copy.ts";
import type { SeatingRound } from "../../../shared/types.ts";
import { LIMITS } from "../../../shared/constants.ts";
import { ApiError, del, post } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import { Num } from "./HostDefaults.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Seats() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const [tableCount, setTableCount] = useState(() => Math.max(1, Math.round(state.players.length / 6)) || 1);
  const [picked, setPicked] = useState<string | null>(null);

  const base = `/host/events/${state.meta.id}/seating`;
  const draft = state.seatings.find((s) => s.status === "draft");
  const published = state.seatings.filter((s) => s.status === "published");
  const revealed = state.meta.phase === "done";

  async function make(final: boolean) {
    try {
      await post(base, { tableCount, final });
      reload();
    } catch (e) {
      // 이 화면에서 400 이 나올 이유는 인원 대비 테이블이 많은 것뿐이다
      toast(e instanceof ApiError && e.status === 400 ? HOST.seating.tooFewPerTable : HOST.seating.closed);
    }
  }

  async function shuffle() {
    await post(`${base}/shuffle`);
    toast(HOST.seating.shuffled);
    setPicked(null);
    reload();
  }

  async function swap(playerId: string) {
    if (!picked) return setPicked(playerId);
    if (picked === playerId) return setPicked(null);
    const first = picked;
    setPicked(null);
    // 남녀를 맞바꿔도 된다. 인원은 그대로고, 바뀐 성비는 테이블 머리의 숫자에 바로 보인다
    await post(`${base}/swap`, { a: first, b: playerId });
    reload();
  }

  function askPublish(round: SeatingRound) {
    const perTable = round.seats.length / round.tableCount;
    confirm(
      {
        btn: HOST.seating.publish,
        title: HOST_UI.seats.publishTitle,
        facts: [
          [HOST_UI.seats.tableCount, `${round.tableCount}`],
          [HOST_UI.dash.registered(round.seats.length), UNIT.people(Math.round(perTable))],
          [HOST_UI.seats.roundTitle(round.round, round.final), HOST.seating.draftOnly],
        ],
      },
      async () => {
        await post(`${base}/publish`);
        toast(HOST.seating.published(round.round, round.final));
        reload();
      },
    );
  }

  if (revealed) return <p className="dim center">{HOST.seating.afterReveal}</p>;

  return (
    <div className="stack">
      {state.seatingClosed ? (
        <div className="card stack">
          <p className="pre">{HOST.seating.closed}</p>
          <button
            className="btn"
            onClick={async () => {
              await post(`${base}/reopen`);
              reload();
            }}
          >
            {HOST.seating.reopen}
          </button>
        </div>
      ) : (
        <>
          <Num
            label={HOST_UI.seats.tableCount}
            value={tableCount}
            min={1}
            max={LIMITS.tableMax}
            onChange={setTableCount}
          />
          <PerTableWarning people={state.players.length} tables={tableCount} />
          <div className="row">
            <button className="btn wide" onClick={() => make(false)} disabled={state.players.length < 2}>
              {HOST_UI.seats.make}
            </button>
            <button className="btn wide gold" onClick={() => make(true)} disabled={state.players.length < 2}>
              {HOST.seating.makeFinal}
            </button>
          </div>
        </>
      )}

      {draft && (
        <div className="card stack">
          <div className="kicker">{HOST_UI.seats.roundTitle(draft.round, draft.final)}</div>
          <p className="small dim">{HOST_UI.seats.swapHint}</p>
          <Tables round={draft} picked={picked} onPick={swap} state={state} />
          <div className="row">
            <button
              className="btn wide ghost"
              onClick={async () => {
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

      {published.length === 0 && !draft && <p className="dim center">{HOST_UI.seats.noRounds}</p>}

      {[...published].reverse().map((round) => (
        <div className="card stack" key={round.round}>
          <div className="row between">
            <span className="kicker">{HOST_UI.seats.roundTitle(round.round, round.final)}</span>
            <span className="small dim">{HOST.ack.progress(round.acks.length, round.seats.length)}</span>
          </div>
          <Tables round={round} picked={null} onPick={() => {}} state={state} />
          <Unassigned round={round} state={state} />
        </div>
      ))}
    </div>
  );
}

function Tables({
  round,
  picked,
  onPick,
  state,
}: {
  round: SeatingRound;
  picked: string | null;
  onPick: (playerId: string) => void;
  state: ReturnType<typeof useConsole>["state"];
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
            <div className="tiny dim">{HOST_UI.seats.tableTitle(t)}</div>
            {/* 테이블마다 남녀가 몇인지 — 맞교환할지 판단하는 숫자다 */}
            <div className="tiny tableMix">
              <span className="men">{HOST_UI.seats.men(men)}</span>
              <span className="women">{HOST_UI.seats.women(here.length - men)}</span>
            </div>
            {here.map((person) => (
              <button
                className={`seatChip ${person.gender === "M" ? "m" : "f"} ${picked === person.id ? "picked" : ""}`}
                key={person.id}
                onClick={() => onPick(person.id)}
              >
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row between">
                    <span className="ellipsis">{person.nickname}</span>
                    {/* 색만으로 구분하지 않는다 */}
                    <span className="sex">{person.gender === "M" ? "♂" : "♀"}</span>
                  </span>
                  {/* 운영자만 전체를 본다 — 자리에서 사람을 찾으려면 실명이 필요하다 */}
                  <span className="tiny dim ellipsis" style={{ display: "block" }}>
                    {person.realName} · {UNIT.age(person.age)} · {person.mbti}
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 자리를 발행한 뒤 등록한 사람은 그 라운드에 자리가 없다. 운영자가 알아야 할 신호다 (FLOWS.md) */
function Unassigned({
  round,
  state,
}: {
  round: SeatingRound;
  state: ReturnType<typeof useConsole>["state"];
}) {
  const seated = new Set(round.seats.map((s) => s.playerId));
  const missing = state.players.filter((p) => !seated.has(p.id));
  if (missing.length === 0) return null;
  return <p className="small warnText">{HOST_UI.seats.unassigned(missing.map((p) => p.nickname).join(", "))}</p>;
}

function PerTableWarning({ people, tables }: { people: number; tables: number }) {
  const per = tables > 0 ? people / tables : 0;
  if (per < LIMITS.seatPerTable.warnBelow) return <p className="small warnText">{HOST.seating.tooFewPerTable}</p>;
  if (per > LIMITS.seatPerTable.warnAbove) return <p className="small warnText">{HOST.seating.tooManyPerTable}</p>;
  return null;
}
