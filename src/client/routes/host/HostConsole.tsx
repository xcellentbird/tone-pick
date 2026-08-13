/**
 * 회차 콘솔 4탭. 자료는 여기서 한 벌 읽어 탭으로 내려보낸다 —
 * 탭마다 따로 읽으면 같은 화면 안에서 숫자가 서로 다르게 보인다.
 */
import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { HOST_UI, PHASE_LABEL, TABS_HOST } from "../../../shared/copy.ts";
import type { HostState } from "../../../shared/types.ts";
import { api, post } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { connect } from "../../lib/realtime.ts";
import { Overlays } from "../../ui/Overlays.tsx";

export type ConsoleState = HostState & { seatingClosed: boolean };

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
  useEffect(() => {
    if (!code) return;
    const socket = connect(code, () => loaded.reload());
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function leave() {
    await post("/host/logout");
    navigate("/host", { replace: true });
  }

  if (!loaded.data) return <div className="screen" />;
  const base = `/host/${id}`;
  // 현황 탭이 스택의 바닥이다. 다른 탭에서 뒤로 가면 현황으로 온다 (참가자 화면과 같은 규칙)
  const atHome = location.pathname.replace(/\/$/, "") === base;

  return (
    <Overlays>
      <div className="screen">
        <header>
          <div className="grow">
            <h1 className="ellipsis">{loaded.data.meta.name}</h1>
            <div className="sub">
              {loaded.data.meta.code} · {PHASE_LABEL[loaded.data.meta.phase]}
            </div>
          </div>
          <button className="btn ghost" onClick={leave}>
            {HOST_UI.logout}
          </button>
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
