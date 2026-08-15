/**
 * 운영자 PIN. 하나뿐이다 — 회차마다 따로 두지 않는다 (ADR-12).
 *
 * 회차 화면에서 세션이 끊겨 들어오면 `?event=<id>` 가 붙는다. 보던 회차로 되돌려주기 위한
 * 표식일 뿐 권한과는 상관없다.
 * 성공하면 replace 로 넘어간다. 뒤로 가서 PIN 화면이 다시 뜨면 로그아웃처럼 보인다.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { HOST, HOST_UI, SCREEN_TITLE } from "../../../shared/copy.ts";
import type { AuthScope } from "../../../shared/types.ts";
import { ApiError, post } from "../../lib/api.ts";

export default function HostPin() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const eventId = params.get("event");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post<{ scope: AuthScope }>("/host/pin", { pin });
      navigate(eventId ? `/host/${eventId}` : "/host/events", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (err.userMessage ?? HOST.pin.wrong) : HOST.pin.wrong);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header>
        <h1 className="grow">{SCREEN_TITLE.hostPin}</h1>
      </header>
      <form className="body stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pin">{HOST_UI.pinLabel}</label>
          <input
            id="pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            type="password"
            style={{ letterSpacing: "0.4em", fontSize: 22, textAlign: "center" }}
          />
          {error && <span className="err">{error}</span>}
        </div>
        <button className="btn primary block" disabled={pin.length < 4 || busy}>
          {HOST_UI.enter}
        </button>
      </form>
    </div>
  );
}
