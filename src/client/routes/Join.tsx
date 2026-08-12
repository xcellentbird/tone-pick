/**
 * 회차 확인 화면. 등록할 수 있는 상태인지 서버가 판단해서 문장까지 들려준다 —
 * 준비 중이면 언제 열리는지, 끝났으면 끝났다고.
 *
 * 참가 링크는 운영자가 한 번 뿌리고 참가자는 그 링크를 계속 다시 연다.
 * 그래서 **이미 등록한 사람인지 먼저 본다** — 아니면 등록을 마친 사람이 링크를 다시 열 때마다
 * 등록 화면이 나온다. (실제로 그랬다)
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL, SCREEN_TITLE } from "../../shared/copy.ts";
import type { ParticipantState, PublicEvent } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const found = useLoad(() => api<PublicEvent>(`/events/by-code/${code}`), [code]);
  // 세션이 이 회차의 것인지 서버가 판정한다. 다른 회차 세션이면 401 이 와서 여기 남는다
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    api<ParticipantState>(`/me?code=${encodeURIComponent(code)}`)
      .then(() => {
        // 이미 등록한 사람이다. 뒤로 가기로 등록 화면에 되돌아가지 않게 replace 로 넘긴다
        if (alive) navigate(`/e/${code}`, { replace: true });
      })
      .catch(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [code, navigate]);

  if (checking) return <div className="screen" />;

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => navigate("/")}>
          {BTN.back}
        </button>
        <h1 className="grow">{SCREEN_TITLE.join}</h1>
      </header>

      <div className="body stack">
        {found.error && <p className="err danger">{found.error.userMessage ?? ENTRY.notFound}</p>}

        {found.data && (
          <>
            <div className="card stack">
              <div className="kicker">{PHASE_LABEL[found.data.phase]}</div>
              <h2 style={{ margin: 0 }}>{found.data.name}</h2>
              {found.data.message && <p className="dim pre">{found.data.message}</p>}
            </div>

            {found.data.canRegister ? (
              <button className="btn primary block" onClick={() => navigate(`/j/${code}/register/1`)}>
                {SCREEN_TITLE.register}
              </button>
            ) : (
              <button className="btn ghost block" onClick={() => navigate("/")}>
                {BTN.home}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
