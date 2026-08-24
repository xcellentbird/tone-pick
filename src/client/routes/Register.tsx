/**
 * 참가자 등록 3스텝.
 *
 * 지키는 것
 *  · 스텝 이동은 push — 뒤로 가기가 이전 스텝이다 (`이전` 버튼이 그걸 쓴다)
 *  · 등록 완료는 replace — 그런데 **replace 는 마지막 한 칸만 갈아끼운다.**
 *    1·2 스텝은 히스토리에 남으므로, 이미 등록한 사람이 그 칸을 밟으면 홈으로 돌려보낸다
 *  · 에러는 **그 값을 입력한 자리에** 띄운다. 닉네임 중복이면 3스텝이 아니라 1스텝으로 되돌린다
 *  · 에러가 뜨면 그 칸으로 스크롤·포커스한다 — 3스텝은 길어서 화면 밖에 뜰 수 있다
 *  · 인스타의 @·URL 껍데기는 오류가 아니라 의도다 — 벗겨서 받는다 (normalizeInstagram)
 *  · 토글을 눌러도 입력값을 날리지 않는다 (폼 전체를 다시 그리지 않는다)
 *  · MBTI 는 16지선다가 아니라 4문항 토글 — 모르는 사람도 답할 수 있어야 한다
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, GENDER, MBTI_AXES, ME, REGISTER, SCREEN_TITLE } from "../../shared/copy.ts";
import type { ParticipantState, RegisterResult } from "../../shared/types.ts";
import { LIMITS, normalizeInstagram } from "../../shared/constants.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { useDraftGuard } from "../lib/history.ts";
import type { ProfileDraft } from "../lib/profileForm.ts";
import { EMPTY_DRAFT, toInput, validateProfile } from "../lib/profileForm.ts";

/** 초안·검증은 내 정보 수정 폼과 함께 쓴다 (`lib/profileForm.ts`) */
type Draft = ProfileDraft;
const EMPTY = EMPTY_DRAFT;

export default function Register() {
  const { id = "", token = "", step = "1" } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const at = Math.min(3, Math.max(1, Number(step) || 1));
  const [checking, setChecking] = useState(true);

  /*
   * **이미 등록을 마쳤으면 폼을 보여주지 않는다.**
   *
   * 완료할 때 `replace` 로 갈아끼우는 건 마지막 스텝 한 칸뿐이다. 스텝은 `push` 로 쌓이므로
   * (`이전` 버튼이 그 히스토리를 쓴다) 1·2 스텝이 남고, 홈에서 뒤로 가면 등록 폼이 다시 떴다.
   * 다 채워진 것처럼 보이는 폼을 보면 **두 번 등록하려 든다** — Join 화면이 하는 확인과 같은 것이다.
   */
  useEffect(() => {
    let alive = true;
    api<ParticipantState>(`/me?event=${encodeURIComponent(id)}`)
      .then((state) => alive && navigate(`/e/${state.event.code}`, { replace: true }))
      .catch(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [id, navigate]);

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
    const bad = validateProfile(d, at);
    if (bad) return setError(bad);
    if (at < 3) return navigate(`/j/${id}/${token}/register/${at + 1}`);
    submit();
  }

  async function submit() {
    setBusy(true);
    try {
      // 번호는 입장할 때 확인한 값이다. 서버가 초대 쿠키에서 꺼내 쓴다 (ADR-15)
      const done = await post<RegisterResult>("/register", toInput(draft));
      const home = `/e/${done.state.event.code}`;
      // 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
      navigate(home, {
        replace: true,
        state: done.resumed ? { welcome: REGISTER.welcomeBack(done.state.me.nickname) } : undefined,
      });
      /*
       * **등록을 마친 사람에게 진행 방식을 한 번 밀어준다** (슬라이스 20).
       *
       * 도움말은 상단 물음표로 늘 열리지만, 그건 **이미 질문이 생긴 사람**의 장치라 늦다.
       * 목표가 "운영자에게 묻는 일을 줄이는 것" 이면 질문이 생기기 전에 한 번 읽혀야 하고,
       * 그 순간은 등록 직후다 — 주의가 가장 높고, 화면은 가장 비어 있다.
       *
       * **갈아끼운 뒤에 밀어 넣는다.** 순서가 뒤집히면 도움말이 3스텝 위에 얹혀서
       * 뒤로 가기가 등록 폼을 밟는다. 이렇게 두면 뒤로 가기 한 번이 곧 홈이다.
       *
       * 본 적이 있다는 기록은 남기지 않는다 (ADR-4). **`등록 완료` 라는 사건에 붙는다** —
       * 새로고침하면 안 뜨고, 다시 보고 싶으면 물음표이거나 홈 카드의 `진행 방식 보기` 다.
       * `resumed` 는 새로 등록한 게 아니라 돌아온 것이라 밀지 않는다.
       */
      if (!done.resumed) navigate(`${home}/help`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "nick_taken") {
        // 닉네임 칸이 있는 1스텝으로 되돌린 뒤 띄운다. 입력값은 그대로 둔다
        setError({ field: "nickname", text: e.userMessage ?? REGISTER.err.nick });
        navigate(`/j/${id}/${token}/register/1`);
        return;
      }
      // 초대 확인이 만료되면 폼을 계속 붙들고 있어봐야 소용없다. 문 앞으로 돌려보낸다
      if (e instanceof ApiError && e.status === 401) {
        navigate(`/j/${id}/${token}`, { replace: true });
        return;
      }
      setError({ field: "form", text: e instanceof ApiError ? (e.userMessage ?? REGISTER.err.retry) : REGISTER.err.retry });
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

  // 확인하는 동안은 빈 화면이다. 폼을 먼저 그리면 이미 등록한 사람에게 한 번 번쩍인다 (Join 과 같다)
  if (checking) return <div className="screen" />;

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
              <input id="realName" value={draft.realName} maxLength={LIMITS.realNameMax} onChange={(e) => set("realName", e.target.value)} {...invalid("realName")} />
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
            <p className="tiny dim pre">{REGISTER.contactNote}</p>
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
                  maxLength={LIMITS.charmMax}
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
