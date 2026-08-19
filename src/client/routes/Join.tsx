/**
 * 참가 링크가 여는 화면. **방이 보이고, 전화번호를 맞춰야 들어간다** (ADR-15).
 *
 * 링크만 받은 사람은 "어느 파티인가"까지만 볼 수 있고, 문을 여는 건
 * **운영자가 미리 받아둔 번호**다. 코드 여섯 자리는 옮겨 적을 수 있지만
 * 남의 번호로는 들어올 수 없다 — 참가 링크는 한 번 뿌려지면 어디까지 퍼질지 모른다.
 *
 * 등록할 수 있는 상태인지는 서버가 판단해서 문장까지 들려준다 —
 * 준비 중이면 언제 열리는지, 끝났으면 끝났다고.
 *
 * 그리고 **이미 등록한 사람인지 먼저 본다** — 아니면 등록을 마친 사람이 링크를 다시 열 때마다
 * 코드부터 다시 물어본다. (실제로 그랬다)
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL, SCREEN_TITLE } from "../../shared/copy.ts";
import type { EnterResult, ParticipantState, PublicEvent } from "../../shared/types.ts";
import { formatWhen } from "../../shared/time.ts";
import { formatPhone, normalizePhone } from "../../shared/constants.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const found = useLoad(() => api<PublicEvent>(`/events/by-id/${id}`), [id]);
  // 세션이 이 회차의 것인지 서버가 판정한다. 다른 회차 세션이면 401 이 와서 여기 남는다
  const [checking, setChecking] = useState(true);
  /**
   * **`010` 을 미리 채워 둔다.** 거의 모든 번호가 그렇게 시작하니 세 번의 탭을 아낀다.
   *
   * 고정 접두사(칸 밖의 라벨)로 두지 않은 이유가 둘이다 —
   *   · **자동완성이 살아야 한다.** 칸이 여덟 자리짜리면 브라우저가 채운 열한 자리가 안 들어간다.
   *     세 번 아끼려다 열한 번을 잃는다
   *   · 011·016 처럼 다른 번호도 지우고 칠 수 있어야 한다. 고정하면 그 사람은 문 앞에서 막히는데,
   *     실패 문구는 하나뿐이라(ADR-15) 왜 막혔는지 알 길이 없다
   *
   * 상태는 **숫자만** 들고, 하이픈은 그릴 때만 넣는다 (생년월일 칸과 같은 방식).
   */
  const [phone, setPhone] = useState("010");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ParticipantState>(`/me?event=${encodeURIComponent(id)}`)
      .then((state) => {
        // 이미 등록한 사람이다. 뒤로 가기로 이 화면에 되돌아가지 않게 replace 로 넘긴다
        if (alive) navigate(`/e/${state.event.code}`, { replace: true });
      })
      .catch(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // 통과하면 서버가 쿠키를 준다. 이미 등록한 사람은 곧바로 자기 화면으로
      const res = await post<EnterResult>(`/events/${id}/enter`, { phone });
      navigate(res.registered && res.code ? `/e/${res.code}` : `/j/${id}/register/1`, {
        replace: res.registered,
      });
    } catch (err) {
      // 번호가 틀려도 입력값을 지우지 않는다 — 다시 치게 하는 건 벌이다 (UI.md)
      setError(err instanceof ApiError ? (err.userMessage ?? ENTRY.notInvited) : ENTRY.notInvited);
      setBusy(false);
    }
  }

  if (checking) return <div className="screen" />;

  return (
    <div className="screen">
      {/*
        **`이전` 버튼을 두지 않는다.** 이 화면에 오는 길은 참가 링크 하나뿐이고,
        링크로 온 사람에게는 앱 안에 돌아갈 자리가 없다 — 예전엔 여기서 코드 입력 화면으로
        보냈는데, 링크만 받은 사람은 알지도 못하는 코드를 요구받는 막다른 길이었다.
        브라우저 뒤로 가기로 링크를 받은 자리(카톡)로 돌아가는 게 맞는 동작이다.
      */}
      <header>
        <h1 className="grow">{SCREEN_TITLE.join}</h1>
      </header>

      <div className="body stack">
        {found.error && <p className="err danger">{found.error.userMessage ?? ENTRY.notFound}</p>}

        {found.data && (
          <>
            <div className="card stack">
              <div className="kicker">{PHASE_LABEL[found.data.phase]}</div>
              <h2 style={{ margin: 0 }}>{found.data.name}</h2>
              {found.data.partyAt && <p className="small dim">{ENTRY.partyAt(formatWhen(found.data.partyAt))}</p>}
              {found.data.message && <p className="dim pre">{found.data.message}</p>}
            </div>

            {!found.data.canRegister ? (
              <button className="btn ghost block" onClick={() => navigate("/")}>
                {BTN.home}
              </button>
            ) : (
              <form className="stack" onSubmit={unlock}>
                <div className="field">
                  <label htmlFor="phone">{ENTRY.phoneLabel}</label>
                  <input
                    id="phone"
                    value={formatPhone(phone)}
                    onChange={(e) => setPhone(normalizePhone(e.target.value).slice(0, 11))}
                    inputMode="tel"
                    autoComplete="tel"
                    /* 010-1234-5678 = 13자. 하이픈까지 세어 잡는다 */
                    maxLength={13}
                    style={{ fontSize: 20, textAlign: "center", letterSpacing: "0.06em" }}
                  />
                  {error ? <span className="err">{error}</span> : <span className="tiny dim">{ENTRY.gateNote}</span>}
                </div>
                <button className="btn primary block" disabled={phone.length < 10 || busy}>
                  {ENTRY.submit}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
