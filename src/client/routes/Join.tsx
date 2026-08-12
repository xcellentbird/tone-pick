/**
 * 회차 확인 화면. 등록할 수 있는 상태인지 서버가 판단해서 문장까지 들려준다 —
 * 준비 중이면 언제 열리는지, 끝났으면 끝났다고.
 */
import { useNavigate, useParams } from "react-router";
import { BTN, ENTRY, PHASE_LABEL, SCREEN_TITLE } from "../../shared/copy.ts";
import type { PublicEvent } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const found = useLoad(() => api<PublicEvent>(`/events/by-code/${code}`), [code]);

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
              <button
                className="btn primary block"
                onClick={() => navigate(`/j/${code}/register/1`)}
              >
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
