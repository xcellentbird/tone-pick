/**
 * 입장 화면.
 * 코드가 틀려도 **입력값을 지우지 않는다** — 여섯 자리를 다시 치게 하는 건 벌이다 (UI.md).
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { ENTRY, SCREEN_TITLE } from "../../shared/copy.ts";
import type { PublicEvent } from "../../shared/types.ts";
import { ApiError, api } from "../lib/api.ts";

export default function Entry() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const found = await api<PublicEvent>(`/events/by-code/${code.trim()}`);
      navigate(`/j/${code.trim().toUpperCase()}`, { state: { name: found.name } });
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? ENTRY.notFound) : ENTRY.notFound);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header>
        <h1 className="grow">{SCREEN_TITLE.entry}</h1>
      </header>
      <form className="body stack" onSubmit={submit}>
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
          {error && <span className="err">{error}</span>}
        </div>
        <button className="btn primary block" disabled={code.trim().length < 6 || busy}>
          {ENTRY.submit}
        </button>
        <button type="button" className="btn ghost block" onClick={() => navigate("/host")}>
          {ENTRY.toHost}
        </button>
      </form>
    </div>
  );
}
