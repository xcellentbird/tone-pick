/**
 * 내 정보 탭.
 *
 * 실명과 전화번호는 기본으로 가린다 — 파티장에서 어깨너머로 보인다.
 *
 * **결과는 여기 없다.** 서로 찌른 사람도, 익명으로 남은 콕도 참가자 탭에서 본다 (ADR-18) —
 * 같은 것을 두 곳에 두면 어느 쪽이 맞는지 눈이 한 번 더 확인하게 된다.
 * 이 탭이 답하는 질문은 하나다: **내가 낸 것이 무엇인가.**
 */
import { useState } from "react";
import { GENDER, ME, PEOPLE, UNIT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";

export default function Me({ state }: { state: ParticipantState }) {
  const [shown, setShown] = useState(false);
  const { me, poke, event } = state;
  const budget = poke.budget[event.phase === "prevote" ? "pre" : "party"];

  // 자리·남은 콕은 홈 탭에, 결과는 참가자 탭에 있다. 같은 것을 두 곳에 두지 않는다
  return (
    <div className="stack">
      {canPoke(event.phase) && (
        <div className="card">
          <div className="kicker">{PEOPLE.sentSoFar(budget.used)}</div>
        </div>
      )}

      {/* 입장 코드는 보여주지 않는다 — 문을 여는 건 전화번호고, 코드는 참가자가 쓸 일이 없다 */}
      <div className="card stack">
        <Row label={ME.labels.event} value={event.name} />
      </div>

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
