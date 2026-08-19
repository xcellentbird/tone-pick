/**
 * 회차 목록. 운영자 PIN 하나로 모든 회차가 여기 보인다 (ADR-12).
 */
import { useNavigate } from "react-router";
import { HOST_UI, PHASE_LABEL, SCREEN_TITLE, UNIT } from "../../../shared/copy.ts";
import type { EventSummary } from "../../../shared/types.ts";
import { api } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";

export default function HostEvents() {
  const navigate = useNavigate();
  const list = useLoad(() => api<EventSummary[]>("/host/events"));
  // 세션이 끊겼으면 PIN 화면으로 되돌린다
  useAuthRedirect(list.error);

  // 함수 이름을 DOM 빌트인과 겹치게 짓지 않는다 — createEvent 로 지었다가 버튼이 조용히 죽은 적 있다 (ADR-8)
  const startWizard = () => navigate("/host/new/1");

  return (
    <div className="screen">
      <header>
        <h1 className="grow">{SCREEN_TITLE.hostEvents}</h1>
      </header>

      {/*
        두 버튼은 **스크롤에서 빠진다.** 회차가 쌓이면 `새 회차 만들기` 가 목록과 함께 밀려
        올라가는데, 그때 운영자가 하려던 일이 바로 그것이다 (지난 회차를 보러 온 게 아니라).
        `.screen` 이 세로 flex 라 `.body` 만 흐른다 — 그 앞에 두면 제자리에 남는다.
      */}
      <div className="pinned stack">
        <button className="btn primary block" onClick={startWizard}>
          {HOST_UI.newEvent}
        </button>
        <button className="btn ghost block" onClick={() => navigate("/host/defaults")}>
          {HOST_UI.openDefaults}
        </button>
      </div>

      <div className="body stack">
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
