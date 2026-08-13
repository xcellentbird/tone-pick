/**
 * 참가자 화면 한 벌.
 *
 * 라우트가 쓰는 것과 데모 뷰가 쓰는 것이 **같은 컴포넌트**다. 다른 건 자료 통로(source)와
 * 탭 상태를 누가 들고 있는가뿐이다. 데모용 화면을 따로 만들면 두 벌이 갈라져
 * 데모가 거짓말을 하게 된다 (ADR-7).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, TABS_PARTICIPANT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { connect } from "../lib/realtime.ts";
import { bannerOf, noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { sessionSource, type ParticipantSource } from "../lib/participant.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ApiError } from "../lib/api.ts";
import { Overlays, useOverlay } from "../ui/Overlays.tsx";
import People from "./People.tsx";
import Alerts from "./Alerts.tsx";
import Me from "./Me.tsx";
import Home from "./Home.tsx";
import SeatTakeover from "../ui/SeatTakeover.tsx";
import StatusBar from "../ui/StatusBar.tsx";

export type Tab = "home" | "people" | "alerts" | "me";

interface ViewProps {
  source: ParticipantSource;
  /** URL 이 가리키는 회차. 세션이 끊겼을 때 어디로 되돌릴지 판단에 쓴다 */
  code?: string;
  /** 같은 번호로 다시 들어온 경우의 인사. 한 번만 띄운다 */
  welcome?: string;
  /** 값이 바뀌면 다시 읽는다. 실시간을 직접 듣지 않는 화면(데모 뷰)이 쓴다 */
  refreshToken?: number;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** 프로필 시트. 라우트에서는 URL, 데모에서는 폰 안의 상태 */
  profileId?: string;
  onProfile: (playerId: string | null) => void;
}

/** URL 이 상태를 들고 있는 진짜 참가자 화면 */
export default function Participant() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/e/${code}`;

  const source = useMemo(() => sessionSource(code), [code]);
  // 프로필 시트(/p/:id)는 참가자 탭 위에 뜬 것이다 — 탭 표시도 참가자로 둔다
  const tab: Tab = location.pathname.endsWith("/alerts")
    ? "alerts"
    : location.pathname.endsWith("/me")
      ? "me"
      : location.pathname.endsWith("/people") || location.pathname.includes("/p/")
        ? "people"
        : "home";
  const profileId = location.pathname.includes("/p/")
    ? decodeURIComponent(location.pathname.split("/p/")[1])
    : undefined;

  return (
    <ParticipantView
      source={source}
      code={code}
      welcome={(location.state as { welcome?: string } | null)?.welcome}
      tab={tab}
      onTab={(next) => {
        /**
         * 홈 탭이 스택의 **바닥**이다. 어느 탭에 있든 뒤로 가기 한 번이면 여기로 온다.
         *
         * 예전에는 탭 이동이 전부 push 라, 탭을 오갈수록 히스토리가 쌓이고 뒤로 가기가
         * "내 발자국 되감기"가 됐다. 사람은 뒤로 가기를 "목록으로 돌아가기"로 기대한다.
         */
        const to = next === "home" ? base : `${base}/${next}`;
        navigate(to, { replace: tab !== "home" });
      }}
      profileId={profileId}
      // 시트 열기는 push, 닫기는 뒤로 가기 — 안드로이드 백 버튼으로 닫혀야 한다
      onProfile={(id) => (id ? navigate(`${base}/p/${id}`) : navigate(-1))}
    />
  );
}

export function ParticipantView(props: ViewProps) {
  const { source, refreshToken, code } = props;
  const state = useLoad(() => source.load(), [source.key, refreshToken]);

  // 실시간은 "다시 읽어라"는 신호로만 쓴다. 부분 갱신을 만들면 화면과 서버가 조용히 어긋난다
  useEffect(() => {
    if (!source.liveCode) return;
    const socket = connect(source.liveCode, () => state.reload());
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.liveCode]);

  if (state.error) return <Failed error={state.error} code={code} />;
  if (!state.data) return <div className="screen" />;
  return <Loaded {...props} state={state.data} reload={state.reload} />;
}

function Loaded({
  source,
  tab,
  onTab,
  profileId,
  onProfile,
  welcome,
  state,
  reload,
}: ViewProps & { state: ParticipantState; reload: () => void }) {
  const [acked, setAcked] = useState<number[]>([]);
  const banner = bannerOf(noticesOf(state), now());

  const ack = useCallback(async () => {
    if (!state.seat) return;
    setAcked((list) => [...list, state.seat!.round]);
    await source.ackSeat(state.seat.round);
    reload();
  }, [source, state.seat, reload]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  return (
    <Overlays history={!!source.liveCode}>
      {welcome && <Greeting text={welcome} />}
      <div className="screen">
        {/* 스크롤해도 남는 자리다. 여기엔 반복해서 볼 것만 둔다 */}
        <header className="bar">
          <StatusBar state={state} />
        </header>

        <div className="body stack">
          {banner && (
            // 최근 3분 안의 변화만 배너로. 그보다 오래된 건 알림 탭에만 남는다
            <button className={`banner ${banner.warn ? "warn" : ""}`} onClick={() => onTab("alerts")}>
              <span className="icon">{banner.icon}</span>
              <span className="grow">
                <span className="name">{banner.title}</span>
                <div className="small dim">{banner.body}</div>
              </span>
            </button>
          )}
          {tab === "home" && <Home state={state} onTab={onTab} />}
          {tab === "people" && (
            <People state={state} source={source} reload={reload} profileId={profileId} onProfile={onProfile} />
          )}
          {tab === "alerts" && <Alerts state={state} />}
          {tab === "me" && <Me state={state} />}
        </div>

        <nav className="tabbar">
          {TABS_PARTICIPANT.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "active" : ""}
              onClick={() => onTab(t.key as Tab)}
              aria-current={tab === t.key}
            >
              <span className="icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {needsSeatAck && state.seat && <SeatTakeover seat={state.seat} onAck={ack} />}
      </div>
    </Overlays>
  );
}

/** 토스트는 Overlays 안에서만 부를 수 있어서 작은 컴포넌트 하나로 감싼다 */
function Greeting({ text }: { text: string }) {
  const { toast } = useOverlay();
  useEffect(() => {
    toast(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * 세션이 없거나 만료됐다. 참가자 식별은 쿠키뿐이라 여기서 할 수 있는 건 다시 입장하는 것이다.
 * 회차 확인 화면으로 보낸다 — 전화번호를 다시 넣으면 그 회차의 기존 참가자로 돌아온다.
 */
function Failed({ error, code }: { error: ApiError; code?: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (code && error.status === 401) navigate(`/j/${code}`, { replace: true });
  }, [code, error.status, navigate]);

  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim pre">{error.userMessage ?? ENTRY.notFound}</p>
        <button className="btn primary" onClick={() => navigate("/")}>
          {BTN.home}
        </button>
      </div>
    </div>
  );
}
