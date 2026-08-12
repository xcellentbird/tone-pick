/**
 * 내 정보 탭.
 *
 * 실명과 전화번호는 기본으로 가린다 — 파티장에서 어깨너머로 보인다.
 * 상호 매칭은 발표 후에만 나온다. 매칭돼도 연락처는 주지 않는다 (ADR-1):
 * 앱이 만드는 건 "같은 테이블"까지다.
 */
import { useState } from "react";
import { GENDER, ME, PEOPLE, REVEAL, SEAT, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";

export default function Me({ state }: { state: ParticipantState }) {
  const [shown, setShown] = useState(false);
  const { me, poke, seat, event } = state;
  const round = event.phase === "prevote" ? "pre" : "party";
  const budget = poke.budget[round];
  const revealed = event.phase === "done";
  const anonymous = Math.max(0, poke.receivedCount - poke.matches.length);

  return (
    <div className="stack">
      {seat && (
        <div className="card">
          <div className="kicker">{SEAT.sectionTitle}</div>
          <div className="big" style={{ fontSize: 20, fontWeight: 800 }}>
            {SEAT.banner(seat.table)}
          </div>
          <div className="small dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
        </div>
      )}

      {revealed ? (
        <div className="card stack">
          <div className="kicker">{REVEAL.mutualTitle}</div>
          {poke.matches.length === 0 ? (
            <p className="pre">{REVEAL.noMutual(poke.receivedCount)}</p>
          ) : (
            poke.matches.map((m) => (
              <div className="fact" key={m.player.id}>
                <b>{m.player.nickname}</b>
                <span className="grow">
                  {m.sameTable ? REVEAL.hintSameTable(m.sameTable) : REVEAL.hintOther}
                </span>
              </div>
            ))
          )}
          {anonymous > 0 && (
            <>
              <div className="kicker">{REVEAL.anonTitle(anonymous)}</div>
              <p className="small dim pre">{REVEAL.anonNote}</p>
            </>
          )}
        </div>
      ) : (
        canPoke(event.phase) && (
          <div className="card">
            <div className="kicker">{PEOPLE.sentSoFar(budget.used)}</div>
            <div>{ME.budget(round, budget.max - budget.used, budget.max)}</div>
          </div>
        )
      )}

      <div className="card stack">
        <Row label={ME.labels.nickname} value={me.nickname} />
        <Row label={ME.labels.age} value={UNIT.age(me.age)} />
        <Row label={ME.labels.gender} value={GENDER[me.gender]} />
        <Row label={ME.labels.mbti} value={me.mbti} />
        <Row label={ME.labels.realName} value={shown ? me.realName : ME.hidden} />
        <Row label={ME.labels.phone} value={shown ? me.phone : ME.hidden} />
        {me.instagram && <Row label={ME.labels.instagram} value={shown ? me.instagram : ME.hidden} />}
        <button className="btn ghost" onClick={() => setShown((v) => !v)}>
          {shown ? ME.hide : ME.show}
        </button>
        <p className="tiny dim">{ME.hideNote}</p>
      </div>

      <div className="card stack">
        <div className="kicker">{ME.labels.charms}</div>
        {me.charms.map((c, i) => (
          <div className="fact" key={i}>
            <span className="grow pre">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between">
      <span className="small dim">{label}</span>
      <span className="ellipsis">{value}</span>
    </div>
  );
}
