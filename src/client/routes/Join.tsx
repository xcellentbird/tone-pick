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
 * 그리고 **이미 등록한 사람인지 먼저 본다** — 아니면 등록을 마친 사람이 링크를 다시 열 때마다
 * 문을 다시 두드리게 된다.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL, SCREEN_TITLE } from "../../shared/copy.ts";
import type { EnterResult, ParticipantState, PublicEvent } from "../../shared/types.ts";
import { formatWhen } from "../../shared/time.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { id = "", token = "" } = useParams();
  const navigate = useNavigate();
  // 회차 정보도 토큰이 있어야 열린다 — 아이디만으로 열리면 토큰을 만든 의미가 없다
  const found = useLoad(
    () => api<PublicEvent>(`/events/by-id/${id}?t=${encodeURIComponent(token)}`),
    [id, token],
  );
  // 세션이 이 회차의 것인지 서버가 판정한다. 다른 회차 세션이면 401 이 와서 여기 남는다
  const [checking, setChecking] = useState(true);
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

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // 통과하면 서버가 쿠키를 준다. 번호는 서버가 토큰에서 꺼낸다 — 폼이 번호를 만지지 않는다
      const res = await post<EnterResult>(`/events/${id}/enter`, { token });
      navigate(res.registered && res.code ? `/e/${res.code}` : `/j/${id}/${token}/register/1`, {
        replace: res.registered,
      });
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? ENTRY.notInvited) : ENTRY.notInvited);
      setBusy(false);
    }
  }

  if (checking) return <div className="screen" />;

  return (
    <div className="screen">
      {/*
        **`이전` 버튼을 두지 않는다.** 이 화면에 오는 길은 참가 링크 하나뿐이고,
        링크로 온 사람에게는 앱 안에 돌아갈 자리가 없다.
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
              <>
                <button className="btn primary block" disabled={busy} onClick={start}>
                  {found.data.registered ? ENTRY.reenter : ENTRY.start}
                </button>
                {error && <p className="err">{error}</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
