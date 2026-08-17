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
import type { ParticipantState, PublicEvent } from "../../shared/types.ts";
import { connect } from "../lib/realtime.ts";
import { bannerOf, noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { sessionSource, type ParticipantSource } from "../lib/participant.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ApiError, api } from "../lib/api.ts";
import { Overlays, useOverlay } from "../ui/Overlays.tsx";
import People from "./People.tsx";
import Me from "./Me.tsx";
import Home from "./Home.tsx";
import SeatTakeover from "../ui/SeatTakeover.tsx";
import { canOpenFortune } from "../../shared/phase.ts";
import FortuneTab from "./Fortune.tsx";
import StatusBar from "../ui/StatusBar.tsx";

export type Tab = "home" | "fortune" | "people" | "me";

interface ViewProps {
  source: ParticipantSource;
  /** URL 이 가리키는 회차. 세션이 끊겼을 때 어디로 되돌릴지 판단에 쓴다 */
  code?: string;
  /** 같은 번호로 다시 들어온 경우의 인사. 한 번만 띄운다 */
  welcome?: string;
  /** 값이 바뀌면 다시 읽는다. 실시간을 직접 듣지 않는 화면(데모 뷰)이 쓴다 */
  refreshToken?: number;
  /** 데모 뷰의 폰 안에 시트를 그릴 때 */
  container?: HTMLElement | null;
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
  const tab: Tab = location.pathname.endsWith("/me")
    ? "me"
    : location.pathname.endsWith("/fortune")
      ? "fortune"
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

  /*
   * 실시간은 "다시 읽어라"는 신호로만 쓴다. 부분 갱신을 만들면 화면과 서버가 조용히 어긋난다.
   *
   * 실패한 화면에서는 붙들지 않는다 — 다른 회차 주소를 열어둔 폰이 그 회차 소켓을 쥔 채
   * 신호가 올 때마다 다시 읽고 또 401 을 받는다. 여기서 다시 읽어봐야 나올 게 없다.
   */
  const failed = !!state.error;
  useEffect(() => {
    if (!source.liveCode || failed) return;
    const socket = connect(source.liveCode, () => state.reload());
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.liveCode, failed]);

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
  container,
  state,
  reload,
}: ViewProps & { state: ParticipantState; reload: () => void }) {
  const [acked, setAcked] = useState<number[]>([]);
  const banner = bannerOf(noticesOf(state), now());

  const ack = useCallback(async () => {
    if (!state.seat) return;
    const round = state.seat.round;
    setAcked((list) => [...list, round]);
    try {
      await source.ackSeat(round);
      reload();
    } catch {
      /*
       * 저장에 실패했으면 **확인을 없던 일로 되돌린다.** 그냥 삼키면 화면에서는 사라지고
       * 서버에는 미확인으로 남아, 운영자가 보는 이동 확인 수가 조용히 모자란다.
       * 되돌리면 안내가 그대로 남아 한 번 더 누를 수 있다.
       */
      setAcked((list) => list.filter((r) => r !== round));
    }
  }, [source, state.seat, reload]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  return (
    <Overlays history={!!source.liveCode} container={container}>
      {welcome && <Greeting text={welcome} />}
      <div className="screen">
        {/* 스크롤해도 남는 자리다. 여기엔 반복해서 볼 것만 둔다 */}
        <header className="bar">
          <StatusBar state={state} />
        </header>

        <div className="body stack">
          {banner && tab !== "home" && tab !== banner.tab && (
            /*
             * 최근 3분 안의 변화만 배너로. **이미 볼 수 있는 화면에서는 띄우지 않는다** —
             * 홈에는 소식 목록이 있고, 목적지 탭에는 소식 그 자체가 있다.
             * 누르면 그 알림의 목적지로 간다. 발표는 홈이 아니라 참가자 탭이다.
             */
            <button className={`banner ${banner.warn ? "warn" : ""}`} onClick={() => onTab(banner.tab)}>
              <span className="icon">{banner.icon}</span>
              <span className="grow">
                <span className="name">{banner.title}</span>
                <div className="small dim">{banner.body}</div>
              </span>
            </button>
          )}
          {tab === "home" && <Home state={state} onTab={onTab} />}
          {tab === "people" && (
            <People
              state={state}
              source={source}
              reload={reload}
              profileId={profileId}
              onProfile={onProfile}
              container={container}
            />
          )}
          {tab === "fortune" && <FortuneTab state={state} reload={reload} />}
          {tab === "me" && <Me state={state} reload={reload} />}
        </div>

        <nav className="tabbar">
          {/* '오늘' 은 파티가 시작돼야 생긴다. 그 전에는 빈 탭을 보여줄 이유가 없다 */}
          {TABS_PARTICIPANT.filter((t) => t.key !== "fortune" || canOpenFortune(state.event.phase)).map((t) => (
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
/**
 * 참가자 화면이 열리지 않는 세 경우.
 *
 *   401  세션이 없다 → 문 앞으로 돌려보낸다
 *   404  회차는 있는데 **내가 없다** — 운영자가 지웠다. 그렇다고 말한다
 *   그 밖  서버가 준 문장을 그대로
 *
 * 404 를 "그런 회차가 없어요" 로 뭉뚱그리면 참가자는 링크를 의심하고 운영자에게
 * 엉뚱한 걸 묻는다. 지워진 사람은 명단에 남아 있으면 다시 들어올 수 있으니 그 길을 준다.
 */
function Failed({ error, code }: { error: ApiError; code?: string }) {
  const navigate = useNavigate();
  /**
   * 세션이 이 회차의 것이 아니다 — 다른 회차에 등록했거나 만료됐다.
   * 문 앞으로 돌려보내되 **코드를 회차 아이디로 바꿔서** 보낸다.
   *
   * `/j` 는 아이디 경로다 (ADR-13). 코드를 그대로 넘기면 아이디로 대조하는 서버가
   * 못 찾아서 "그런 회차가 없어요" 로 끝난다 — 회차는 멀쩡한데 없다고 말하는 셈이다.
   * 입장 화면(Entry)이 쓰는 순서와 같다: 코드로 회차를 찾고, 아이디로 이동한다.
   */
  useEffect(() => {
    if (!code || error.status !== 401) return;
    let alive = true;
    api<PublicEvent>(`/events/by-code/${code}`)
      .then((found) => alive && navigate(`/j/${found.id}`, { replace: true }))
      // 코드마저 못 찾으면 이 화면의 문구가 비로소 맞는 말이 된다
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code, error.status, navigate]);

  const removed = error.status === 404;
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim pre">{error.userMessage ?? ENTRY.notFound}</p>
        <button className="btn primary" onClick={() => navigate("/")}>
          {removed ? ENTRY.reenter : BTN.home}
        </button>
      </div>
    </div>
  );
}
