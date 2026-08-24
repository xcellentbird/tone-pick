/**
 * 내 정보 탭.
 *
 * 실명과 전화번호는 기본으로 가린다 — 파티장에서 어깨너머로 보인다.
 *
 * **결과는 여기 없다.** 서로 찌른 사람도, 익명으로 남은 콕도 참가자 탭에서 본다 (ADR-18) —
 * 같은 것을 두 곳에 두면 어느 쪽이 맞는지 눈이 한 번 더 확인하게 된다.
 * 이 탭이 답하는 질문은 하나다: **내가 낸 것이 무엇인가.**
 *
 * 그래서 고치는 길도 하나다 (ADR-31). 매력만 따로 고치는 버튼을 두지 마라 —
 * 참가자가 하는 일은 "내가 낸 것을 고친다" 하나고, 잠기는 순간도 하나다.
 */
import { useEffect, useState } from "react";
import { BTN, GENDER, MBTI_AXES, ME, REGISTER, UNIT } from "../../shared/copy.ts";
import type { ParticipantState, Player } from "../../shared/types.ts";
import { LIMITS, normalizeInstagram } from "../../shared/constants.ts";
import { ApiError } from "../lib/api.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { draftOf, toInput, validateProfile } from "../lib/profileForm.ts";
import { useOverlay } from "../ui/Overlays.tsx";

interface Props {
  state: ParticipantState;
  source: ParticipantSource;
  reload: () => void;
  /** 편집은 라우트다 (`/e/:code/me/edit`) — 뒤로 가기가 곧 취소다 */
  editing: boolean;
  onEdit: (on: boolean, opts?: { replace?: boolean }) => void;
}

export default function Me({ state, source, reload, editing, onEdit }: Props) {
  const { me, event } = state;
  // 사전 투표가 열리면 사람들이 이 정보를 보고 콕을 찌른다. 그 뒤로는 굳는다 (ADR-31)
  const canEdit = event.phase === "reg";

  /**
   * 잠긴 뒤에 편집 주소가 열려 있으면 안 된다 — 링크를 눌러서든 새로고침으로든
   * 고칠 수 없는 폼이 뜬다. 사전 투표가 시작되는 순간 편집 중이던 사람도 여기서 밀려난다.
   */
  useEffect(() => {
    // 뒤로 가기가 아니라 갈아끼우기다 — 주소를 직접 연 사람에게는 뒤로 갈 자리가 없다
    if (editing && !canEdit) onEdit(false, { replace: true });
  }, [editing, canEdit, onEdit]);

  /*
   * 여기 있는 건 **내가 낸 것** 하나다.
   *
   * 라운드·보낸 콕은 두지 않는다 — 라운드는 상단 바가, 콕 숫자는 참가자 탭이 맡는다.
   * 회차 이름도 상단 바로 옮겼다. 같은 것을 두 곳에 두면 어느 쪽이 맞는지 눈이 한 번 더 확인한다.
   * 자리는 홈 탭에, 결과는 참가자 탭에 있다.
   */
  return (
    <div className="stack">
      {editing && canEdit ? (
        <EditForm me={me} source={source} reload={reload} done={() => onEdit(false)} />
      ) : (
        <Saved me={me} canEdit={canEdit} edit={() => onEdit(true)} />
      )}
    </div>
  );
}

/** 저장된 내 정보. 기본 정보와 매력을 나눠 그리되 고치는 버튼은 그 아래 하나뿐이다 */
function Saved({ me, canEdit, edit }: { me: Player; canEdit: boolean; edit: () => void }) {
  const [shown, setShown] = useState(false);

  return (
    <>
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

      {/* 잠긴 뒤에 버튼만 사라지면 "내 화면만 이상한가" 가 된다 — 왜 못 고치는지 말한다 */}
      {canEdit ? (
        <div className="stack">
          <button className="btn block" onClick={edit}>
            {ME.edit}
          </button>
          <p className="tiny dim">{ME.editHint}</p>
        </div>
      ) : (
        <p className="tiny dim">{ME.locked}</p>
      )}
    </>
  );
}

/**
 * 고치기. 기본 정보와 매력이 **함께** 폼이 되고 저장도 한 번이다.
 *
 * 저장은 전부 되거나 전부 안 된다. 닉네임이 겹치면 그 칸에 에러를 띄우고
 * **입력값은 그대로 둔다** — 등록 폼과 같은 방식이다.
 */
function EditForm({
  me,
  source,
  reload,
  done,
}: {
  me: Player;
  source: ParticipantSource;
  reload: () => void;
  done: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(me));
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useOverlay();

  // 오류를 만든 칸으로 데려간다 — 폼이 길어서 화면 밖 오류는 "아무 일도 없음" 으로 보인다.
  // error.field 가 곧 요소 id 다
  useEffect(() => {
    if (!error) return;
    const el = document.getElementById(error.field);
    if (!el) return;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
  }, [error]);

  const set = <K extends keyof typeof draft,>(key: K, value: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  async function save() {
    // 붙여넣은 @·URL 껍데기는 오류가 아니라 의도다 — 벗긴 값으로 검증하고 화면에도 벗긴 값을 남긴다
    const d = { ...draft, instagram: normalizeInstagram(draft.instagram) };
    if (d.instagram !== draft.instagram) setDraft(d);
    const bad = validateProfile(d);
    if (bad) return setError(bad);

    setBusy(true);
    try {
      await source.saveProfile(toInput(d));
      toast(BTN.saved);
      done();
      reload();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "nick_taken") {
        setError({ field: "nickname", text: e.userMessage ?? REGISTER.err.nick });
        return;
      }
      setError({
        field: "form",
        text: e instanceof ApiError ? (e.userMessage ?? REGISTER.err.retry) : REGISTER.err.retry,
      });
    }
  }

  // 색과 위치로만 말하지 않는다 — role="alert" 로 보조기기에도 같은 문구가 전달된다
  const err = (field: string) =>
    error?.field === field ? (
      <span className="err" id={`${field}-err`} role="alert">
        {error.text}
      </span>
    ) : null;
  const invalid = (field: string) =>
    error?.field === field ? ({ "aria-invalid": true, "aria-describedby": `${field}-err` } as const) : {};

  return (
    <>
      <div className="card stack">
        <div className="field">
          <label htmlFor="nickname">{ME.labels.nickname}</label>
          <input
            id="nickname"
            value={draft.nickname}
            maxLength={LIMITS.nicknameMax}
            onChange={(e) => set("nickname", e.target.value)}
            {...invalid("nickname")}
          />
          {err("nickname")}
        </div>
        <div className="field">
          <label htmlFor="realName">{ME.labels.realName}</label>
          <input
            id="realName"
            value={draft.realName}
            maxLength={LIMITS.realNameMax}
            onChange={(e) => set("realName", e.target.value)}
            {...invalid("realName")}
          />
          {err("realName")}
        </div>
        <div className="field">
          <label htmlFor="age">{ME.labels.age}</label>
          <input
            id="age"
            value={draft.age}
            inputMode="numeric"
            onChange={(e) => set("age", e.target.value.replace(/[^0-9]/g, ""))}
            {...invalid("age")}
          />
          {err("age")}
        </div>
        <div className="field" id="gender">
          <label>{ME.labels.gender}</label>
          <div className="choice">
            {(["M", "F"] as const).map((g) => (
              <button key={g} type="button" aria-pressed={draft.gender === g} onClick={() => set("gender", g)}>
                {GENDER[g]}
              </button>
            ))}
          </div>
          {err("gender")}
        </div>
        <div className="field">
          <label htmlFor="instagram">{ME.labels.instagram}</label>
          <input
            id="instagram"
            value={draft.instagram}
            autoCapitalize="none"
            onChange={(e) => set("instagram", e.target.value)}
            {...invalid("instagram")}
          />
          {/* 등록 화면과 **같은 말**이어야 한다 — 두 화면이 다르게 말하면 둘 다 못 믿는다 */}
          <p className="tiny dim">{REGISTER.instaWhy}</p>
          {err("instagram")}
        </div>

        {/* 전화번호는 파티의 문이라 고칠 수 없다 (ADR-15). 칸이 아니라 사실로 보여준다 */}
        <Row label={ME.labels.phone} value={me.phone} />
        <p className="tiny dim">{ME.phoneFixed}</p>
      </div>

      <div className="card stack">
        {MBTI_AXES.map((axis, i) => (
          <div className="field" key={axis.q} id={`mbti${i}`}>
            <label>{axis.q}</label>
            <div className="choice">
              {axis.opts.map(([letter, text]) => (
                <button
                  key={letter}
                  type="button"
                  aria-pressed={draft.mbti[i] === letter}
                  onClick={() => set("mbti", { ...draft.mbti, [i]: letter })}
                >
                  {text}
                </button>
              ))}
            </div>
            {err(`mbti${i}`)}
          </div>
        ))}
      </div>

      <div className="card stack">
        <div className="kicker">{ME.labels.charms}</div>
        <p className="small dim">{REGISTER.charmHint}</p>
        {draft.charms.map((c, i) => (
          <div className="field" key={i}>
            <label htmlFor={`charm${i}`}>{`${ME.labels.charms} ${i + 1}`}</label>
            <textarea
              id={`charm${i}`}
              rows={2}
              maxLength={LIMITS.charmMax}
              value={c}
              onChange={(e) => {
                const next = [...draft.charms] as typeof draft.charms;
                next[i] = e.target.value;
                set("charms", next);
              }}
              {...invalid(`charm${i}`)}
            />
            {err(`charm${i}`)}
          </div>
        ))}
      </div>

      {error?.field === "form" && <p className="err danger">{error.text}</p>}

      <div className="row">
        <button className="btn wide ghost" onClick={done} disabled={busy}>
          {BTN.cancel}
        </button>
        <button className="btn wide primary" onClick={save} disabled={busy}>
          {BTN.save}
        </button>
      </div>
    </>
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
