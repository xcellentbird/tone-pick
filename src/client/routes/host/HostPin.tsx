/**
 * 운영자 PIN.
 *
 * 회차 화면에서 들어오면 `?event=<id>` 가 붙는다. 그러면 서버가 **회차 PIN 을 먼저** 본다 —
 * 두 PIN 이 같아도 회차 담당자가 전체 권한을 얻지 않게 하기 위해서다 (ADR-3).
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
      const res = await post<{ scope: AuthScope }>("/host/pin", eventId ? { pin, eventId } : { pin });
      const to = res.scope.kind === "host" ? `/host/${res.scope.eventId}` : (eventId ?? "").length > 0 ? `/host/${eventId}` : "/host/events";
      navigate(to, { replace: true });
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
