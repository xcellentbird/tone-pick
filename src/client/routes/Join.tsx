/**
 * 참가 링크가 여는 화면. **링크가 곧 신원이다** (ADR-32).
 *
 * 번호를 묻지 않는다. 같은 파티에 오는 사람들은 서로 번호를 아는 사이라
 * 번호는 열쇠가 못 됐다 — 번호를 아는 사람이 그 사람이 될 수 있었다 (ADR-15 후기 2).
 *
 * **그런데 이 화면은 남는다.** 곧바로 등록 폼으로 넘기지 않는 이유가 둘이다 —
 *   · 안내문은 등록 시작 **전에** 보낸다. 일찍 연 사람에게 "언제 열리는지" 를 말할 자리가 필요하다
 *   · 링크를 열자마자 입력 폼이 뜨는 것보다 어느 파티인지 한 번 보여주는 쪽이 낫다
 *
 * **장소는 여기 없다.** 안내문으로만 알린다 (ADR-32) — 지금 운영이 그렇다.
 *
 * ─────────────────────────────────────────────────────────────
 * **이 화면만 머리 띠가 없다.** 앱을 통틀어 로고가 서는 유일한 자리이고,
 * 참가자가 이 앱을 처음 만나는 화면이라 그렇다. `회차 확인` 이라는 제목은 걷어냈다 —
 * 로고가 어느 파티인지, 그 아래 회차 이름이 어느 회차인지 말한다.
 * 제목 줄은 그 둘 사이에서 아무것도 더하지 않았다.
 *
 * ⚠️ **로고에 회차 이름을 그려 넣지 마라.** 로고는 고정 자산이고 회차 이름은
 * 운영자가 친 글자다 — 회차마다 다르다. 이름은 늘 텍스트로 선다.
 *
 * 그리고 **이미 등록한 사람인지 먼저 본다** — 아니면 등록을 마친 사람이 링크를 다시 열 때마다
 * 문을 다시 두드리게 된다.
 *
 * ⚠️ **그 판정은 토큰이 한다. 브라우저 쿠키가 아니다** (ADR-44).
 *    예전에는 여기서 `/me?event=` 를 먼저 불러 "이 브라우저에 세션이 있나" 로 넘겼는데,
 *    쿠키는 탭이 아니라 브라우저 단위라 **두 번째 탭에서 다른 사람의 링크를 열면
 *    첫 번째 탭의 사람으로 넘어갔다.** 링크가 사람마다 달라도 소용이 없었다 —
 *    토큰을 보기도 전에 답이 정해져 있었기 때문이다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL } from "../../shared/copy.ts";
import type { EnterResult, PublicEvent } from "../../shared/types.ts";
import { formatWhen } from "../../shared/time.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { takeBoot } from "../lib/boot.ts";
import { setTabRef } from "../lib/session.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { id = "", token = "" } = useParams();
  const navigate = useNavigate();
  // 회차 정보도 토큰이 있어야 열린다 — 아이디만으로 열리면 토큰을 만든 의미가 없다
  /*
   * **`index.html` 이 번들보다 먼저 띄워둔 답을 먼저 본다** (`lib/boot.ts`).
   * 없으면(새로고침·되불러오기·다른 경로) 평소대로 서버에 묻는다.
   */
  const found = useLoad(() => {
    const path = `/events/by-id/${id}?t=${encodeURIComponent(token)}`;
    return takeBoot<PublicEvent>(path) ?? api<PublicEvent>(path);
  }, [id, token]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 자동 입장은 한 번뿐이다. 회차 정보가 다시 그려져도 문을 두 번 두드리지 않는다 */
  const entered = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // 통과하면 서버가 쿠키를 준다. 번호는 서버가 토큰에서 꺼낸다 — 폼이 번호를 만지지 않는다
      const res = await post<EnterResult>(`/events/${id}/enter`, { token });
      /*
       * **이 탭이 누구인지 기억한다** (ADR-44). 다음 요청부터 이 이름표가 실려,
       * 다른 탭이 다른 링크로 들어와도 서로를 덮지 않는다.
       */
      setTabRef(res.ref);
      /*
       * **방금 읽은 회차 정보를 함께 넘긴다** — 등록 화면이 같은 요청을 또 하지 않게.
       * 받는 쪽은 없어도 동작한다(새로고침·직접 진입). 그래서 넘기는 게 최적화이지 계약이 아니다.
       */
      navigate(res.registered && res.code ? `/e/${res.code}` : `/j/${id}/${token}/register/1`, {
        replace: res.registered,
        state: found.data ? { room: found.data } : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? ENTRY.notInvited) : ENTRY.notInvited);
      setBusy(false);
    }
  }, [id, token, navigate, found.data]);

  /*
   * 등록을 마친 사람은 링크를 여는 것만으로 자기 화면으로 간다.
   *
   * **판정은 `found.data.registered` 다** — 서버가 **이 토큰으로** 답한 값이다.
   * 브라우저에 어떤 세션이 남아 있든 보지 않는다. 그게 탭이 서로를 덮던 원인이었다.
   */
  const registered = found.data?.registered;
  useEffect(() => {
    if (entered.current || !registered) return;
    entered.current = true;
    void start();
  }, [registered, start]);

  // 회차를 아직 못 읽었거나, 읽자마자 넘어갈 사람이다. 카드를 한 번 그리면 화면이 튄다
  if ((!found.data && !found.error) || (registered && !error)) return <div className="screen join" />;

  return (
    <div className="screen join">
      {/*
        **`이전` 버튼을 두지 않는다.** 이 화면에 오는 길은 참가 링크 하나뿐이고,
        링크로 온 사람에게는 앱 안에 돌아갈 자리가 없다.
        브라우저 뒤로 가기로 링크를 받은 자리(카톡)로 돌아가는 게 맞는 동작이다.
      */}
      <div className="body joinBody">
        {/*
          로고는 **장식이다** — 바로 아래에 회차 이름이 글자로 서 있어서,
          낭독기가 `TONE PARTY` 를 한 번 더 읽으면 같은 말이 두 번 난다.
          크기를 박아 두는 건 그림이 늦게 와도 아래 것들이 안 튀게 하기 위해서다.
        */}
        {/*
          **`public/` 의 고정 주소다** — 번들을 거치면 해시가 붙어 `index.html` 이 그 이름을
          모르고, 그러면 첫 화면 스켈레톤이 로고를 띄울 수 없다. 로고는 거의 안 바뀌므로
          해시로 얻는 캐시 무효화보다 **먼저 보이는 것**이 값지다.
        */}
        <img className="joinLogo" src="/logo.webp" alt="" aria-hidden width={640} height={455} />

        {found.error && <p className="err danger joinErr">{found.error.userMessage ?? ENTRY.notFound}</p>}

        {found.data && (
          <>
            <div className={`joinMeta phase-${found.data.phase}`}>
              <div className="joinTitle">
                {/*
                  **단계는 남긴다.** 등록이 발표 전까지 열려 있어서, 파티가 이미 시작된 뒤
                  늦게 링크를 연 사람도 `등록하기` 만 보게 된다 — 이 줄이 없으면
                  파티가 진행 중인 걸 알 길이 없다.
                */}
                <p className="joinPhase">{PHASE_LABEL[found.data.phase]}</p>
                <h1 className="joinName">{found.data.name}</h1>
              </div>
              {/* 이름과 시각을 가르는 선. 글자가 아니라 자리 표시라 낭독기에서는 없다 */}
              <span className="joinRule" aria-hidden />
              {/*
                `파티` 라고 다시 쓰지 않는다 — 바로 위 로고가 이미 그 말을 하고 있다.
                시각 하나만 남기는 것이 이 줄이 답하는 질문(`그 파티가 맞나`)에 맞다.
              */}
              {found.data.partyAt && <p className="joinWhen">{formatWhen(found.data.partyAt)}</p>}
              {/* 등록이 닫혔을 때만 뜬다. 운영자가 쓴 글이 아니라 `ENTRY.*` 다 */}
              {found.data.message && <p className="joinNote pre">{found.data.message}</p>}
            </div>

            {!found.data.canRegister ? (
              <button className="btn ghost block joinGo" onClick={() => navigate("/")}>
                {BTN.home}
              </button>
            ) : (
              <>
                <button className="btn primary block joinGo" disabled={busy} onClick={start}>
                  {found.data.registered ? ENTRY.reenter : ENTRY.start}
                </button>
                {error && <p className="err joinErr">{error}</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
