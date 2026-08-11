/**
 * 참가자 등록 3스텝.
 *
 * 지키는 것
 *  · 스텝 이동은 push — 뒤로 가기가 이전 스텝이다
 *  · 등록 완료는 replace — 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
 *  · 에러는 **그 값을 입력한 자리에** 띄운다. 닉네임 중복이면 3스텝이 아니라 1스텝으로 되돌린다
 *  · 토글을 눌러도 입력값을 날리지 않는다 (폼 전체를 다시 그리지 않는다)
 *  · MBTI 는 16지선다가 아니라 4문항 토글 — 모르는 사람도 답할 수 있어야 한다
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, GENDER, MBTI_AXES, ME, REGISTER, SCREEN_TITLE } from "../../shared/copy.ts";
import type { RegisterInput, RegisterResult } from "../../shared/types.ts";
import { LIMITS } from "../../shared/constants.ts";
import { ApiError, post } from "../lib/api.ts";
import { useDraftGuard } from "../lib/history.ts";

interface Draft {
  nickname: string;
  realName: string;
  age: string;
  gender: "M" | "F" | "";
  phone: string;
  instagram: string;
  mbti: Record<number, string>;
  charms: [string, string, string];
}

const EMPTY: Draft = {
  nickname: "",
  realName: "",
  age: "",
  gender: "",
  phone: "",
  instagram: "",
  mbti: {},
  charms: ["", "", ""],
};

export default function Register() {
  const { code = "", step = "1" } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const at = Math.min(3, Math.max(1, Number(step) || 1));
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);
  useDraftGuard(dirty && !busy, "/j/");

  const set = <K extends keyof Draft,>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  function next() {
    const bad = validate(draft, at);
    if (bad) return setError(bad);
    if (at < 3) return navigate(`/j/${code}/register/${at + 1}`);
    submit();
  }

  async function submit() {
    setBusy(true);
    try {
      const body: RegisterInput = {
        nickname: draft.nickname.trim(),
        realName: draft.realName.trim(),
        age: Number(draft.age),
        gender: draft.gender as "M" | "F",
        phone: draft.phone.replace(/[^0-9]/g, ""),
        instagram: draft.instagram.trim() || undefined,
        mbti: MBTI_AXES.map((_, i) => draft.mbti[i]).join(""),
        charms: draft.charms.map((c) => c.trim()) as [string, string, string],
      };
      const done = await post<RegisterResult>(`/events/${code}/register`, body);
      // 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
      navigate(`/e/${code}`, {
        replace: true,
        state: done.resumed ? { welcome: REGISTER.welcomeBack(done.state.me.nickname) } : undefined,
      });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "nick_taken") {
        // 닉네임 칸이 있는 1스텝으로 되돌린 뒤 띄운다. 입력값은 그대로 둔다
        setError({ field: "nickname", text: e.userMessage ?? REGISTER.err.nick });
        navigate(`/j/${code}/register/1`);
        return;
      }
      setError({ field: "form", text: e instanceof ApiError ? (e.userMessage ?? REGISTER.err.nick) : REGISTER.err.nick });
    }
  }

  const err = (field: string) => (error?.field === field ? <span className="err">{error.text}</span> : null);

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => navigate(-1)}>
          {BTN.back}
        </button>
        <div className="grow">
          <h1>{SCREEN_TITLE.register}</h1>
          <div className="sub">
            {at}/3 · {REGISTER.steps[at - 1]}
          </div>
        </div>
      </header>

      <div className="body stack">
        {at === 1 && (
          <>
            <div className="field">
              <label htmlFor="nick">{ME.labels.nickname}</label>
              <input
                id="nick"
                value={draft.nickname}
                maxLength={LIMITS.nicknameMax}
                onChange={(e) => set("nickname", e.target.value)}
              />
              {err("nickname")}
            </div>
            <div className="field">
              <label htmlFor="name">{ME.labels.realName}</label>
              <input id="name" value={draft.realName} onChange={(e) => set("realName", e.target.value)} />
              {err("realName")}
            </div>
            <div className="field">
              <label htmlFor="age">{ME.labels.age}</label>
              <input
                id="age"
                value={draft.age}
                inputMode="numeric"
                onChange={(e) => set("age", e.target.value.replace(/[^0-9]/g, ""))}
              />
              {err("age")}
            </div>
            <div className="field">
              <label>{ME.labels.gender}</label>
              <div className="choice">
                {(["M", "F"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={draft.gender === g}
                    onClick={() => set("gender", g)}
                  >
                    {GENDER[g]}
                  </button>
                ))}
              </div>
              {err("gender")}
            </div>
          </>
        )}

        {at === 2 && (
          <>
            <div className="field">
              <label htmlFor="phone">{ME.labels.phone}</label>
              <input
                id="phone"
                value={draft.phone}
                inputMode="tel"
                autoComplete="tel"
                onChange={(e) => set("phone", e.target.value)}
              />
              {err("phone")}
            </div>
            <div className="field">
              <label htmlFor="insta">{ME.labels.instagram}</label>
              <input id="insta" value={draft.instagram} autoCapitalize="none" onChange={(e) => set("instagram", e.target.value)} />
              {err("instagram")}
            </div>
          </>
        )}

        {at === 3 && (
          <>
            {MBTI_AXES.map((axis, i) => (
              <div className="field" key={axis.q}>
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
              </div>
            ))}
            {err("mbti")}

            <p className="small dim">{REGISTER.charmHint}</p>
            {draft.charms.map((c, i) => (
              <div className="field" key={i}>
                <label htmlFor={`charm${i}`}>{`${ME.labels.charms} ${i + 1}`}</label>
                <textarea
                  id={`charm${i}`}
                  rows={2}
                  value={c}
                  onChange={(e) => {
                    const next = [...draft.charms] as Draft["charms"];
                    next[i] = e.target.value;
                    set("charms", next);
                  }}
                />
              </div>
            ))}
            {err("charms")}
          </>
        )}

        {error?.field === "form" && <p className="err danger">{error.text}</p>}
      </div>

      <div className="row" style={{ padding: "0 16px 16px" }}>
        <button className="btn wide primary" onClick={next} disabled={busy}>
          {at < 3 ? BTN.next : SCREEN_TITLE.register}
        </button>
      </div>
    </div>
  );
}

/** 검증은 화면 순서대로. 서버도 같은 규칙을 다시 본다 — 여기는 사람이 고치기 쉬우라고 있는 것 */
function validate(d: Draft, step: number): { field: string; text: string } | null {
  if (step === 1) {
    if (!d.nickname.trim()) return { field: "nickname", text: REGISTER.err.nick };
    if (!d.realName.trim()) return { field: "realName", text: REGISTER.err.name };
    const age = Number(d.age);
    if (!Number.isInteger(age) || age < 18 || age > 99) return { field: "age", text: REGISTER.err.age };
    if (!d.gender) return { field: "gender", text: REGISTER.err.gender };
  }
  if (step === 2) {
    if (d.phone.replace(/[^0-9]/g, "").length < 9) return { field: "phone", text: REGISTER.err.phone };
    if (d.instagram && !/^[A-Za-z0-9._]+$/.test(d.instagram.trim())) {
      return { field: "instagram", text: REGISTER.err.insta };
    }
  }
  if (step === 3) {
    if (MBTI_AXES.some((_, i) => !d.mbti[i])) return { field: "mbti", text: REGISTER.err.mbti };
    const missing = d.charms.findIndex((c) => !c.trim());
    if (missing >= 0) return { field: "charms", text: REGISTER.err.charm(missing + 1) };
  }
  return null;
}
