/**
 * 회차 목록. 운영자 PIN 하나로 모든 회차가 여기 보인다 (ADR-12).
 */
import { useNavigate } from "react-router";
import { HOST_UI, PHASE_LABEL, SCREEN_TITLE, UNIT } from "../../../shared/copy.ts";
import type { EventSummary } from "../../../shared/types.ts";
import { api, post } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";

export default function HostEvents() {
  const navigate = useNavigate();
  const list = useLoad(() => api<EventSummary[]>("/host/events"));
  // 세션이 끊겼으면 PIN 화면으로 되돌린다
  useAuthRedirect(list.error);

  // 함수 이름을 DOM 빌트인과 겹치게 짓지 않는다 — createEvent 로 지었다가 버튼이 조용히 죽은 적 있다 (ADR-8)
  const startWizard = () => navigate("/host/new/1");

  async function leave() {
    await post("/host/logout");
    navigate("/host", { replace: true });
  }

  return (
    <div className="screen">
      <header>
        <h1 className="grow">{SCREEN_TITLE.hostEvents}</h1>
        <button className="btn ghost" onClick={leave}>
          {HOST_UI.logout}
        </button>
      </header>

      <div className="body stack">
        <button className="btn primary block" onClick={startWizard}>
          {HOST_UI.newEvent}
        </button>
        <button className="btn ghost block" onClick={() => navigate("/host/defaults")}>
          {HOST_UI.openDefaults}
        </button>

        {list.data?.length === 0 && <p className="dim center">{HOST_UI.noEvents}</p>}

        {list.data?.map((ev) => (
          <button className="card row between" key={ev.id} onClick={() => navigate(`/host/${ev.id}`)}>
            <span className="grow" style={{ textAlign: "left" }}>
              <span className="name">{ev.name}</span>
              <div className="small dim">
                {ev.code} · {PHASE_LABEL[ev.phase]} · {UNIT.people(ev.playerCount)}
              </div>
            </span>
            <span className="dim">{"›"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
