/**
 * 참가 링크가 여는 화면. **방이 보이고, 코드를 맞춰야 들어간다** (ADR-13).
 *
 * 링크에는 입장 코드가 없다. 링크만 받은 사람은 "어느 파티인가"까지만 볼 수 있고,
 * 운영자가 따로 알려준 6자리를 맞춰야 등록으로 넘어간다 —
 * 참가 링크는 한 번 뿌려지면 어디까지 퍼질지 아무도 모르기 때문이다.
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
import type { ParticipantState, PublicEvent } from "../../shared/types.ts";
import { formatWhen } from "../../shared/time.ts";
import { api } from "../lib/api.ts";
import { codeFor, rememberCode } from "../lib/entry.ts";
import { useLoad } from "../lib/useLoad.ts";

export default function Join() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const found = useLoad(() => api<PublicEvent>(`/events/by-id/${id}`), [id]);
  // 세션이 이 회차의 것인지 서버가 판정한다. 다른 회차 세션이면 401 이 와서 여기 남는다
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [passed, setPassed] = useState(() => codeFor(id));
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
    const typed = code.trim().toUpperCase();
    try {
      // 코드가 정말 **이 회차**의 것인지 본다. 다른 회차의 유효한 코드로는 열리지 않는다
      const byCode = await api<PublicEvent>(`/events/by-code/${typed}`);
      if (byCode.id !== id) throw new Error("mismatch");
      rememberCode(id, typed);
      setPassed(typed);
    } catch {
      // 코드가 틀려도 입력값을 지우지 않는다 — 여섯 자리를 다시 치게 하는 건 벌이다 (UI.md)
      setError(ENTRY.wrongCode);
    } finally {
      setBusy(false);
    }
  }

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
              {found.data.partyAt && <p className="small dim">{ENTRY.partyAt(formatWhen(found.data.partyAt))}</p>}
              {found.data.message && <p className="dim pre">{found.data.message}</p>}
            </div>

            {!found.data.canRegister ? (
              <button className="btn ghost block" onClick={() => navigate("/")}>
                {BTN.home}
              </button>
            ) : passed ? (
              <button className="btn primary block" onClick={() => navigate(`/j/${id}/register/1`)}>
                {SCREEN_TITLE.register}
              </button>
            ) : (
              <form className="stack" onSubmit={unlock}>
                <div className="field">
                  <label htmlFor="code">{ENTRY.codeLabel}</label>
                  <input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={6}
                    inputMode="text"
                    style={{ letterSpacing: "0.4em", fontSize: 22, textAlign: "center" }}
                  />
                  {error ? <span className="err">{error}</span> : <span className="tiny dim">{ENTRY.gateNote}</span>}
                </div>
                <button className="btn primary block" disabled={code.trim().length < 6 || busy}>
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
