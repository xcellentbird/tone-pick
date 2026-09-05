/**
 * 참가자 등록 3걸음 — `기본 정보 · 나를 소개 · 다시 들어올 때` (ADR-75).
 *
 * 지키는 것
 *  · 스텝 이동은 push — 뒤로 가기가 이전 스텝이다 (`이전` 버튼이 그걸 쓴다)
 *  · 등록 완료는 replace — 그런데 **replace 는 마지막 한 칸만 갈아끼운다.**
 *    1·2 스텝은 히스토리에 남으므로, 이미 등록한 사람이 그 칸을 밟으면 홈으로 돌려보낸다
 *  · 에러는 **그 값을 입력한 자리에** 띄운다. 닉네임 중복이면 3스텝이 아니라 1스텝으로 되돌린다
 *  · 에러가 뜨면 그 칸으로 스크롤·포커스한다 — 2스텝은 길어서 화면 밖에 뜰 수 있다
 *  · 인스타의 @·URL 껍데기는 오류가 아니라 의도다 — 벗겨서 받는다 (normalizeInstagram)
 *  · 토글을 눌러도 입력값을 날리지 않는다 (폼 전체를 다시 그리지 않는다)
 *  · MBTI 는 16지선다가 아니라 4문항 토글 — 모르는 사람도 답할 수 있어야 한다
 *  · **약속은 문장이 아니라 라벨에 붙는다** — `인스타 (운영자 확인용 · 공개되지 않아요)`,
 *    `이름 (서로 콕 찌른 상대에게만 보여요)`. 다섯 칸 사이에서 문단은 안 읽히지만 라벨은 읽힌다
 *  · **PIN 번호는 마지막 걸음이고 두 번 친다.** 한 번 정하면 못 고치므로 재입력이 유일한 방어다 —
 *    둘 중 하나만 떼지 마라 (S-B3). 대조는 여기서 하고 서버는 하나만 받는다
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, GENDER, MBTI_AXES, ME, REGISTER, SCREEN_TITLE } from "../../shared/copy.ts";
import type { ParticipantState, PublicEvent, RegisterResult } from "../../shared/types.ts";
import { LIMITS, PIN, normalizeInstagram } from "../../shared/constants.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { useDraftGuard } from "../lib/history.ts";
import type { ProfileDraft } from "../lib/profileForm.ts";
import { EMPTY_DRAFT, toInput, validateProfile } from "../lib/profileForm.ts";
import { takeBoot } from "../lib/boot.ts";
import { prefetchParticipant } from "../router.tsx";

/** 초안·검증은 내 정보 수정 폼과 함께 쓴다 (`lib/profileForm.ts`) */
type Draft = ProfileDraft;

/** 회차 조회가 이 화면에 주는 것 — Join 이 넘겨주기도 하고, 없으면 직접 묻는다 */
type RoomPeek = Pick<PublicEvent, "nickHint">;
const EMPTY = EMPTY_DRAFT;

export default function Register() {
  const { id = "", step = "1" } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const at = Math.min(3, Math.max(1, Number(step) || 1));
  const [checking, setChecking] = useState(true);
  /** 닉네임 칸에 붙일 운영자 문구 (ADR-59). 회차를 확인하는 그 요청이 함께 준다 */
  const [nickHint, setNickHint] = useState("");
  /*
   * Join 이 넘겨준 회차 정보. **첫 렌더의 값만 잡는다** — 스텝을 오갈 때마다 다시 보면
   * 2·3 스텝에서도 이 판정이 돌아 폼이 잠깐 비어 보인다.
   */
  const handed = useRef<RoomPeek | undefined>(
    (useLocation().state as { room?: RoomPeek } | null)?.room ?? undefined,
  );

  /*
   * **다음 화면을 지금 받아둔다.** 등록을 마치면 곧바로 참가자 앱으로 가는데, 그건 따로
   * 내려받는 청크다. 사람이 세 스텝을 채우는 십수 초 동안 조용히 받아두면 제출 뒤에
   * 기다릴 일이 없다 — 폼을 채우는 시간은 어차피 망이 노는 시간이다.
   */
  useEffect(prefetchParticipant, []);

  /*
   * **이미 등록을 마쳤으면 폼을 보여주지 않는다.**
   *
   * 완료할 때 `replace` 로 갈아끼우는 건 마지막 스텝 한 칸뿐이다. 스텝은 `push` 로 쌓이므로
   * (`이전` 버튼이 그 히스토리를 쓴다) 1·2 스텝이 남고, 홈에서 뒤로 가면 등록 폼이 다시 떴다.
   * 다 채워진 것처럼 보이는 폼을 보면 **두 번 등록하려 든다** — Join 화면이 하는 확인과 같은 것이다.
   *
   * 그 확인은 **이 탭의 세션**에 묻는다 (`/me?event=`). 링크에 신원이 없어진 뒤로는(ADR-75) 이것이
   * 유일한 단서다 — 확인창을 지나온 탭은 이름표를 들고 있어서 남의 탭 세션으로 넘어가지 않는다 (ADR-44).
   * 등록을 마친 탭은 같은 이름표로 참가자 쿠키를 받으므로 여기서 200 이 난다.
   */
  useEffect(() => {
    let alive = true;
    api<ParticipantState>(`/me?event=${encodeURIComponent(id)}`)
      .then((me) => alive && navigate(`/e/${me.event.code}`, { replace: true }))
      .catch(() => {
        if (!alive) return;
        /*
         * 세션이 없다 — 등록할 사람이다. **Join 이 방금 읽은 값을 넘겨받는다**, 없으면 그때 묻는다.
         *
         * 이 화면은 마운트될 때마다 회차를 다시 물었는데, 링크를 눌러 들어온 사람에게는
         * **Join 이 1초 전에 부른 것과 똑같은 요청**이었다. 4G 에서 151ms 를 그냥 버렸다.
         *
         * ⚠️ 새로고침·주소 직접 입력·뒤로 가기로 오면 `state` 가 없다. 그때는 물어야 한다 —
         *    **넘겨받은 값이 없다고 등록을 막으면 안 된다.** `index.html` 이 띄워둔 요청이 있으면
         *    그걸 받아간다 (`lib/boot.ts`).
         */
        const room = handed.current;
        if (room) {
          setNickHint(room.nickHint ?? "");
          setChecking(false);
          return;
        }
        const path = `/events/by-id/${id}`;
        (takeBoot<RoomPeek>(path) ?? api<RoomPeek>(path))
          .then((room) => {
            if (!alive) return;
            setNickHint(room.nickHint ?? "");
            setChecking(false);
          })
          .catch(() => alive && setChecking(false));
      });
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
    const d = at === 1 ? { ...draft, instagram: normalizeInstagram(draft.instagram) } : draft;
    if (d !== draft) setDraft(d);
    const bad = validateProfile(d, at);
    if (bad) return setError(bad);
    if (at < 3) return navigate(`/j/${id}/register/${at + 1}`);
    submit();
  }

  async function submit() {
    setBusy(true);
    try {
      // 번호는 입장할 때 확인한 값이다. 서버가 초대 쿠키에서 꺼내 쓴다 (ADR-31) — PIN 번호는 여기서 함께 간다
      const done = await post<RegisterResult>("/register", toInput(draft));
      const home = `/e/${done.state.event.code}`;
      // 뒤로 가기로 등록 폼에 다시 들어가면 안 된다
      navigate(home, {
        replace: true,
        state: done.resumed ? { welcome: REGISTER.welcomeBack(done.state.me.nickname) } : undefined,
      });
      /*
       * **등록을 마친 사람에게 진행 방식을 한 번 밀어준다** (슬라이스 21).
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
        navigate(`/j/${id}/register/1`);
        return;
      }
      // 초대 확인이 만료되면 폼을 계속 붙들고 있어봐야 소용없다. 문 앞으로 돌려보낸다
      if (e instanceof ApiError && e.status === 401) {
        navigate(`/j/${id}`, { replace: true });
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
              {/* 운영자가 회차마다 정하는 문구 (ADR-59). **없으면 줄 자체가 없다** — 빈 자리를 남기지 않는다 */}
              {nickHint && <span className="tiny dim">{nickHint}</span>}
              {err("nickname")}
            </div>
            <div className="field">
              {/* 약속이 라벨에 있다 — 발표 때 서로 콕 찌른 상대에게만, 그것도 실명 하나다 (ADR-42) */}
              <label htmlFor="realName">{REGISTER.realNameLabel}</label>
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
            <div className="field">
              {/*
                **왜 받는지 라벨이 말한다** (ADR-42·75). 이 말이 없으면 참가자가
                `연락 수단으로 쓰이겠구나` 로 읽는데, 그건 사실이 아니다 — 운영자만 본다.
                라벨 밖에 문장을 두지 마라. 다섯 칸 사이에서 문단은 안 읽힌다
              */}
              <label htmlFor="instagram">{REGISTER.instagramLabel}</label>
              <input id="instagram" value={draft.instagram} autoCapitalize="none" onChange={(e) => set("instagram", e.target.value)} {...invalid("instagram")} />
              {err("instagram")}
            </div>
          </>
        )}

        {at === 2 && (
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

        {at === 3 && (
          <>
            {/* 무엇에 쓰는 번호인지 먼저. 끝이 숫자 여덟 개라 30초에 끝난다 */}
            <p className="small dim pre">{REGISTER.pinIntro}</p>
            <div className="field">
              <label htmlFor="pin">{REGISTER.pin}</label>
              <input
                id="pin"
                className="pinInput"
                value={draft.pin}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN.length}
                onChange={(e) => set("pin", e.target.value.replace(/[^0-9]/g, "").slice(0, PIN.length))}
                {...invalid("pin")}
              />
              {err("pin")}
            </div>
            <div className="field">
              <label htmlFor="pinAgain">{REGISTER.pinAgain}</label>
              <input
                id="pinAgain"
                className="pinInput"
                value={draft.pinAgain}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN.length}
                onChange={(e) => set("pinAgain", e.target.value.replace(/[^0-9]/g, "").slice(0, PIN.length))}
                {...invalid("pinAgain")}
              />
              {err("pinAgain")}
            </div>
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
