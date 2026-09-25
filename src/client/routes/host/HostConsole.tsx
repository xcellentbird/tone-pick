/**
 * 회차 콘솔 4탭. 자료는 여기서 한 벌 읽어 탭으로 내려보낸다 —
 * 탭마다 따로 읽으면 같은 화면 안에서 숫자가 서로 다르게 보인다.
 */
import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { HOST_UI, PHASE_LABEL, TABS_HOST } from "../../../shared/copy.ts";
import type { HostState } from "../../../shared/types.ts";
import { api } from "../../lib/api.ts";
import { useLoad, useTimeouts } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { LoadFailed } from "../../ui/Boom.tsx";
import { connect } from "../../lib/realtime.ts";
import { Overlays } from "../../ui/Overlays.tsx";

export type ConsoleState = HostState;

/**
 * 신호가 몰릴 때 다시 읽는 간격 (ADR-107). 콘솔은 콕 하나에도 다시 읽는데, 파티 중에는 콕이 잇따라 온다 —
 * 신호마다 읽으면 요청이 몰린다. **첫 신호는 바로 읽고**, 그 뒤 이만큼 안에 온 것은 모아서 한 번 더 읽는다.
 * 운영자 탭 하나가 많아야 분당 30번이다.
 */
export const HOST_RELOAD_GAP_MS = 2_000;

export interface ConsoleCtx {
  state: ConsoleState;
  reload: () => void;
}

export function useConsole(): ConsoleCtx {
  return useOutletContext<ConsoleCtx>();
}

export default function HostConsole() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const loaded = useLoad(() => api<ConsoleState>(`/host/events/${id}/state`), [id]);
  useAuthRedirect(loaded.error, `/host?event=${id}`);

  const code = loaded.data?.meta.code;
  const later = useTimeouts();
  useEffect(() => {
    if (!code) return;
    /** 마지막으로 다시 읽은 때, 그리고 모아 둔 한 번 */
    let last = 0;
    let pending: (() => void) | null = null;
    const pull = () => {
      pending = null;
      last = Date.now();
      loaded.reload();
    };
    const socket = connect(
      code,
      () => {
        if (pending) return;
        const wait = last + HOST_RELOAD_GAP_MS - Date.now();
        if (wait <= 0) pull();
        else pending = later(pull, wait);
      },
      { host: true },
    );
    return () => {
      socket.close();
      pending?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  /*
   * **빈 화면을 남기지 않는다.** 401·403 은 위에서 PIN 화면으로 되돌리지만,
   * 망이 끊기거나 서버가 500 을 주면 여기까지 온다 — 예전에는 빈 `.screen` 이라
   * 파티 중에 콘솔이 통째로 비어버렸다. 단계도 못 넘기고 자리도 못 본다.
   *
   * 아직 불러오는 중일 때는 빈 화면이 맞다. 실패했을 때만 갈라준다.
   */
  if (loaded.error) return <LoadFailed error={loaded.error} onRetry={loaded.reload} busy={loaded.loading} />;
  if (!loaded.data) return <div className="screen" />;
  const base = `/host/${id}`;
  // 현황 탭이 스택의 바닥이다. 다른 탭에서 뒤로 가면 현황으로 온다 (참가자 화면과 같은 규칙)
  const atHome = location.pathname.replace(/\/$/, "") === base;

  return (
    <Overlays>
      <div className="screen">
        <header>
          {/* 회차 하나에 갇히지 않는다. 파티가 여러 개면 오가는 게 기본 동작이다 */}
          <button className="btn ghost" onClick={() => navigate("/host/events")}>
            {HOST_UI.openEvents}
          </button>
          <div className="grow">
            <h1 className="ellipsis">{loaded.data.meta.name}</h1>
            <div className="sub">
              {loaded.data.meta.code} · {PHASE_LABEL[loaded.data.meta.phase]} ·{" "}
              <span>{HOST_UI.dash.registered(loaded.data.players.length)}</span>
            </div>
          </div>
        </header>

        <nav className="tabs">
          {TABS_HOST.map((t) => (
            <NavLink
              key={t.key}
              to={t.path ? `${base}/${t.path}` : base}
              end={!t.path}
              replace={!atHome}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="body">
          <Outlet context={{ state: loaded.data, reload: loaded.reload } satisfies ConsoleCtx} />
        </div>
      </div>
    </Overlays>
  );
}
