/**
 * 참가자 등록 3스텝.
 *
 * 지키는 것
 *  · 스텝 이동은 push — 뒤로 가기가 이전 스텝이다
 *  · 등록 완료는 replace — 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
 *  · 에러는 **그 값을 입력한 자리에** 띄운다. 닉네임 중복이면 3스텝이 아니라 1스텝으로 되돌린다
 *  · 에러가 뜨면 그 칸으로 스크롤·포커스한다 — 3스텝은 길어서 화면 밖에 뜰 수 있다
 *  · 인스타의 @·URL 껍데기는 오류가 아니라 의도다 — 벗겨서 받는다 (normalizeInstagram)
 *  · 토글을 눌러도 입력값을 날리지 않는다 (폼 전체를 다시 그리지 않는다)
 *  · MBTI 는 16지선다가 아니라 4문항 토글 — 모르는 사람도 답할 수 있어야 한다
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, GENDER, MBTI_AXES, ME, REGISTER, SCREEN_TITLE } from "../../shared/copy.ts";
import type { RegisterInput, RegisterResult } from "../../shared/types.ts";
import { LIMITS, RETENTION_DAYS, nicknameProblem, normalizeInstagram, realNameProblem } from "../../shared/constants.ts";
import { ApiError, post } from "../lib/api.ts";
import { useDraftGuard } from "../lib/history.ts";

interface Draft {
  nickname: string;
  realName: string;
  age: string;
  gender: "M" | "F" | "";
  instagram: string;
  mbti: Record<number, string>;
  charms: [string, string, string];
}

const EMPTY: Draft = {
  nickname: "",
  realName: "",
  age: "",
  gender: "",
  instagram: "",
  mbti: {},
  charms: ["", "", ""],
};

export default function Register() {
  const { id = "", step = "1" } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const at = Math.min(3, Math.max(1, Number(step) || 1));

  // 오류를 만든 칸으로 데려간다 — 키보드가 올라온 폰에서는 화면 밖 오류가 "아무 일도 없음"으로 보인다.
  // error.field 가 곧 요소 id 다. 서버 오류로 스텝을 되돌린 경우(nick_taken)도 이 효과가 받는다
  useEffect(() => {
    if (!error) return;
    const el = document.getElementById(error.field);
    if (!el) return;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
  }, [error]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);
  useDraftGuard(dirty && !busy, "/j/");

  const set = <K extends keyof Draft,>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };

  function next() {
    // 붙여넣은 @·URL 껍데기는 오류가 아니다 — 벗긴 값으로 검증하고, 화면에도 벗긴 값을 남긴다
    const d = at === 2 ? { ...draft, instagram: normalizeInstagram(draft.instagram) } : draft;
    if (d !== draft) setDraft(d);
    const bad = validate(d, at);
    if (bad) return setError(bad);
    if (at < 3) return navigate(`/j/${id}/register/${at + 1}`);
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
        instagram: normalizeInstagram(draft.instagram),
        mbti: MBTI_AXES.map((_, i) => draft.mbti[i]).join(""),
        charms: draft.charms.map((c) => c.trim()) as [string, string, string],
      };
      // 번호는 입장할 때 확인한 값이다. 서버가 초대 쿠키에서 꺼내 쓴다 (ADR-15)
      const done = await post<RegisterResult>("/register", body);
      // 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
      navigate(`/e/${done.state.event.code}`, {
        replace: true,
        state: done.resumed ? { welcome: REGISTER.welcomeBack(done.state.me.nickname) } : undefined,
      });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "nick_taken") {
        // 닉네임 칸이 있는 1스텝으로 되돌린 뒤 띄운다. 입력값은 그대로 둔다
        setError({ field: "nickname", text: e.userMessage ?? REGISTER.err.nick });
        navigate(`/j/${id}/register/1`);
        return;
      }
      // 초대 확인이 만료되면 폼을 계속 붙들고 있어봐야 소용없다. 문 앞으로 돌려보낸다
      if (e instanceof ApiError && e.status === 401) {
        navigate(`/j/${id}`, { replace: true });
        return;
      }
      setError({ field: "form", text: e instanceof ApiError ? (e.userMessage ?? REGISTER.err.nick) : REGISTER.err.nick });
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
              <input id="realName" value={draft.realName} onChange={(e) => set("realName", e.target.value)} {...invalid("realName")} />
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
            <p className="tiny dim pre">{REGISTER.retention(RETENTION_DAYS)}</p>
            <div className="field">
              <label htmlFor="instagram">{ME.labels.instagram}</label>
              <input id="instagram" value={draft.instagram} autoCapitalize="none" onChange={(e) => set("instagram", e.target.value)} {...invalid("instagram")} />
              {err("instagram")}
            </div>
          </>
        )}

        {at === 3 && (
          <>
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
                  {...invalid(`charm${i}`)}
                />
                {err(`charm${i}`)}
              </div>
            ))}
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
    const nick = nicknameProblem(d.nickname);
    if (nick === "empty") return { field: "nickname", text: REGISTER.err.nick };
    if (nick === "short" || nick === "long") {
      return { field: "nickname", text: REGISTER.err.nickLen(LIMITS.nicknameMin, LIMITS.nicknameMax) };
    }
    if (nick) return { field: "nickname", text: REGISTER.err.nickChars };
    const name = realNameProblem(d.realName);
    if (name === "empty") return { field: "realName", text: REGISTER.err.name };
    if (name) return { field: "realName", text: REGISTER.err.nameDigit };
    const age = Number(d.age);
    if (!Number.isInteger(age) || age < 18 || age > 99) return { field: "age", text: REGISTER.err.age };
    if (!d.gender) return { field: "gender", text: REGISTER.err.gender };
  }
  if (step === 2) {
    if (!d.instagram.trim()) return { field: "instagram", text: REGISTER.err.instaRequired };
    if (!/^[A-Za-z0-9._]+$/.test(d.instagram.trim())) {
      return { field: "instagram", text: REGISTER.err.insta };
    }
  }
  if (step === 3) {
    // 답 안 한 첫 문항·비어 있는 첫 칸을 가리킨다 — field 가 곧 요소 id 라 스크롤·포커스가 따라간다
    const blank = MBTI_AXES.findIndex((_, i) => !d.mbti[i]);
    if (blank >= 0) return { field: `mbti${blank}`, text: REGISTER.err.mbti };
    const missing = d.charms.findIndex((c) => !c.trim());
    if (missing >= 0) return { field: `charm${missing}`, text: REGISTER.err.charm(missing + 1) };
  }
  return null;
}
