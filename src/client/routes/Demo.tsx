/**
 * 데모 뷰 — 참가자 화면 1~3개를 나란히 띄우는 시연 도구.
 *
 * 참가자 뷰를 따로 만들지 않는다. 같은 컴포넌트에 자료 통로와 탭 상태만 다르게 준다 (ADR-7).
 * 폰 상태는 URL 에 담지 않는다 — 뒤로 가기로 폰 하나의 탭만 되돌아가면 오히려 혼란스럽다.
 * 그래서 폰마다 `Overlays history={false}` 로 감싸 확인창도 서로 독립이다.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, HOST_UI, SCREEN_TITLE } from "../../shared/copy.ts";
import { api } from "../lib/api.ts";
import { connect } from "../lib/realtime.ts";
import { demoSource } from "../lib/participant.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useAuthRedirect } from "../lib/guard.ts";
import { Overlays } from "../ui/Overlays.tsx";
import { ParticipantView, type Tab } from "./Participant.tsx";
import type { ConsoleState } from "./host/HostConsole.tsx";

export default function Demo() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const loaded = useLoad(() => api<ConsoleState>(`/host/events/${id}/state`), [id]);
  useAuthRedirect(loaded.error, `/host?event=${id}`);
  const [picked, setPicked] = useState<string[]>([]);
  // 폰마다 실시간을 따로 듣지 않는다. 한 번만 듣고 폰 전체에 "다시 읽어라"를 돌린다 —
  // 한쪽 폰에서 찌른 콕이 다른 폰에 보여야 시연이 된다
  const [tick, setTick] = useState(0);
  const code = loaded.data?.meta.code;
  useEffect(() => {
    if (!code) return;
    const socket = connect(code, () => setTick((t) => t + 1));
    return () => socket.close();
  }, [code]);

  const players = loaded.data?.players ?? [];
  const shown = picked.length ? picked : players.slice(0, 3).map((p) => p.id);

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => navigate(`/host/${id}`)}>
          {BTN.back}
        </button>
        <h1 className="grow">{SCREEN_TITLE.demo}</h1>
      </header>

      <div className="tabs">
        {players.map((p) => (
          <a
            key={p.id}
            className={shown.includes(p.id) ? "active" : ""}
            onClick={() =>
              setPicked((list) => {
                const base = list.length ? list : shown;
                return base.includes(p.id) ? base.filter((x) => x !== p.id) : [...base, p.id].slice(-3);
              })
            }
          >
            {p.nickname}
          </a>
        ))}
      </div>

      {players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}

      <div className="demo">
        {shown.map((playerId) => (
          <Phone key={playerId} eventId={id} playerId={playerId} tick={tick} />
        ))}
      </div>
    </div>
  );
}

/** 폰 한 대. 탭·시트·확인창이 전부 이 안에서만 움직인다 */
function Phone({ eventId, playerId, tick }: { eventId: string; playerId: string; tick: number }) {
  const [tab, setTab] = useState<Tab>("home");
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [source] = useState(() => demoSource(eventId, playerId));

  return (
    <div className="phone">
      <Overlays history={false}>
        <ParticipantView
          source={source}
          refreshToken={tick}
          tab={tab}
          onTab={setTab}
          profileId={profileId}
          onProfile={(id) => setProfileId(id ?? undefined)}
        />
      </Overlays>
    </div>
  );
}
