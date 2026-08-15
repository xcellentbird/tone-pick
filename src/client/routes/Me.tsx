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
import { BTN, GENDER, ME, PEOPLE, REGISTER, UNIT } from "../../shared/copy.ts";
import type { ParticipantState, Player } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { ApiError, put } from "../lib/api.ts";
import { useOverlay } from "../ui/Overlays.tsx";

export default function Me({ state, reload }: { state: ParticipantState; reload: () => void }) {
  const [shown, setShown] = useState(false);
  const { me, poke, event } = state;
  const round = event.phase === "prevote" ? ("pre" as const) : ("party" as const);
  const budget = poke.budget[round];

  // 자리·남은 콕은 홈 탭에, 결과는 참가자 탭에 있다. 같은 것을 두 곳에 두지 않는다
  return (
    <div className="stack">
      {canPoke(event.phase) && (
        <div className="card">
          <div className="kicker">{PEOPLE.sentSoFar(round, budget.used)}</div>
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

      <Charms state={state} reload={reload} />
    </div>
  );
}

/**
 * 나의 매력 세 줄. **사전 투표가 열리기 전까지만** 고칠 수 있다 (ADR-27).
 *
 * 등록 폼에서 급히 쓴 걸 다듬을 시간은 준다. 다만 사전 투표가 시작되면
 * 사람들이 이 세 줄을 보고 콕을 찌르므로, 그 뒤로는 그대로 둔다 —
 * 바꾸면 누군가 나를 고른 근거가 조용히 사라진다.
 */
function Charms({ state, reload }: { state: ParticipantState; reload: () => void }) {
  const { me, event } = state;
  const canEdit = event.phase === "reg";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([...me.charms]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useOverlay();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await put<Player>("/me/charms", { charms: draft.map((c) => c.trim()) });
      toast(BTN.saved);
      setEditing(false);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? REGISTER.err.charm(1)) : REGISTER.err.charm(1));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="card stack">
        <div className="kicker">{ME.labels.charms}</div>
        {me.charms.map((c, i) => (
          <div className="fact" key={i}>
            <span className="grow pre">{c}</span>
          </div>
        ))}
        {canEdit && (
          <>
            <button
              className="btn block"
              onClick={() => {
                setDraft([...me.charms]);
                setEditing(true);
              }}
            >
              {ME.editCharms}
            </button>
            <p className="tiny dim">{ME.charmsHint}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="kicker">{ME.labels.charms}</div>
      {draft.map((c, i) => (
        <div className="field" key={i}>
          <label htmlFor={`myCharm${i}`}>{`${ME.labels.charms} ${i + 1}`}</label>
          <textarea
            id={`myCharm${i}`}
            rows={2}
            value={c}
            onChange={(e) => setDraft(draft.map((x, k) => (k === i ? e.target.value : x)))}
          />
        </div>
      ))}
      {error && <p className="err danger">{error}</p>}
      <div className="row">
        <button className="btn wide ghost" onClick={() => setEditing(false)} disabled={busy}>
          {BTN.cancel}
        </button>
        <button
          className="btn wide primary"
          onClick={save}
          disabled={busy || draft.some((c) => !c.trim())}
        >
          {BTN.save}
        </button>
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
