/**
 * 참가자 화면 한 벌. 네 탭(홈·참가자·내 정보·오늘)이 이 컴포넌트 하나를 나눠 쓴다.
 *
 * 자료는 통로(source)로 받는다 — 화면은 세션도 요청 경로도 모른다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, FAIL, TABS_PARTICIPANT } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { connect } from "../lib/realtime.ts";
import { bannerOf, noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { sessionSource, type ParticipantSource } from "../lib/participant.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ApiError } from "../lib/api.ts";
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
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** 프로필 시트도 라우트다 — 뒤로 가기로 닫힌다 */
  profileId?: string;
  onProfile: (playerId: string | null) => void;
  /**
   * 내 정보 편집도 라우트다 — 뒤로 가기가 곧 취소다 (ADR-31).
   *
   * 닫을 때 `replace` 는 **취소가 아니라 되돌림**이다. 잠긴 뒤에 편집 주소를 직접 연 경우
   * 뒤로 갈 자리가 없어서 앱을 벗어난다 — 그때는 내 정보로 갈아끼운다.
   */
  editing?: boolean;
  onEdit: (on: boolean, opts?: { replace?: boolean }) => void;
  /**
   * 자리 확인 화면을 **다시 연** 상태 (슬라이스 12). 뒤로 가기로 닫힌다.
   *
   * 자동으로 뜨는 쪽(`needsSeatAck`)은 라우트가 아니다 — 참가자가 연 게 아니라
   * 아직 안 본 것이라서 주소를 바꿀 일이 아니다.
   */
  seatOpen?: boolean;
  onSeat: (on: boolean, opts?: { replace?: boolean }) => void;
}

/** URL 이 상태를 들고 있는 진짜 참가자 화면 */
export default function Participant() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/e/${code}`;

  const source = useMemo(() => sessionSource(code), [code]);
  // 프로필 시트(/p/:id)는 참가자 탭 위에, 편집(/me/edit)은 내 정보 탭 위에 뜬 것이다 —
  // 탭 표시는 그 아래 탭 그대로 둔다
  const editing = location.pathname.endsWith("/me/edit");
  const tab: Tab = location.pathname.endsWith("/me") || editing
    ? "me"
    : location.pathname.endsWith("/fortune")
      ? "fortune"
      : location.pathname.endsWith("/people") || location.pathname.includes("/p/")
        ? "people"
        : "home";
  const profileId = location.pathname.includes("/p/")
    ? decodeURIComponent(location.pathname.split("/p/")[1])
    : undefined;
  // 자리 화면을 **다시 여는** 길. 자동으로 뜨는 쪽은 라우트가 아니다 — 참가자가 연 게 아니다
  const seatOpen = location.pathname.endsWith("/seat");

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
      seatOpen={seatOpen}
      /*
       * 편집과 같다 — **닫기는 뒤로 가기**이되, 주소를 직접 연 사람에게는 뒤로 갈 자리가 없다.
       * 그때 `navigate(-1)` 은 앱을 벗어난다. iOS 는 가장자리 스와이프가 뒤로 가기라 더 쉽게 걸린다.
       */
      onSeat={(on, opts) =>
        on ? navigate(`${base}/seat`) : opts?.replace ? navigate(base, { replace: true }) : navigate(-1)
      }
      editing={editing}
      // 편집도 같다. 뒤로 가기가 곧 취소이고, 고치던 입력은 버려진다 (취소 버튼과 같은 동작)
      onEdit={(on, opts) =>
        on
          ? navigate(`${base}/me/edit`)
          : opts?.replace
            ? navigate(`${base}/me`, { replace: true })
            : navigate(-1)
      }
    />
  );
}

export function ParticipantView(props: ViewProps) {
  const { source, code } = props;
  const state = useLoad(() => source.load(), [source.key]);

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
  editing,
  onEdit,
  seatOpen,
  onSeat,
  welcome,
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

  /*
   * 자리 화면 주소를 열었는데 보여줄 자리가 없다 (파티 전이거나 아직 안 앉았다).
   * 빈 주소에 남겨두지 않고 홈으로 **갈아끼운다** — 뒤로 가기가 아니다.
   * 주소를 직접 연 사람에게는 뒤로 갈 자리가 없어서 앱을 벗어난다 (편집과 같은 이유).
   */
  useEffect(() => {
    if (seatOpen && !state.seat) onSeat(false, { replace: true });
  }, [seatOpen, state.seat, onSeat]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  return (
    <Overlays>
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
          {tab === "home" && <Home state={state} onTab={onTab} onSeat={() => onSeat(true)} />}
          {tab === "people" && (
            <People
              state={state}
              source={source}
              reload={reload}
              profileId={profileId}
              onProfile={onProfile}
              onTab={onTab}
            />
          )}
          {tab === "fortune" && <FortuneTab state={state} reload={reload} />}
          {tab === "me" && (
            <Me state={state} source={source} reload={reload} editing={!!editing} onEdit={onEdit} />
          )}
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

        {/*
          아직 안 본 사람에게는 **자동으로** 덮치고 확인을 받는다.
          이미 본 사람이 홈에서 다시 연 경우(`/seat`)에는 닫기만 있다 —
          이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
        */}
        {needsSeatAck && state.seat && <SeatTakeover seat={state.seat} onAck={ack} />}
        {!needsSeatAck && seatOpen && state.seat && (
          <SeatTakeover seat={state.seat} onClose={() => onSeat(false)} />
        )}
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
  /*
   * 세션이 이 회차의 것이 아니면(401) 예전에는 코드로 회차를 되찾아 문 앞으로 보냈다.
   * 그 길을 닫았다 — **코드로 회차를 찾는 창구가 곧 링크를 내주는 창구**였기 때문이다
   * (`by-code` 응답에 회차 아이디가 들어 있어서, 30비트 코드를 뚫으면 64비트 링크가 나왔다).
   *
   * 이제는 참가 링크로 다시 들어오면 된다. 링크는 운영자가 뿌린 그대로 남아 있다.
   */
  const removed = error.status === 404;
  /*
   * 서버에 닿지도 못한 경우(status 0). **처음으로 보내면 안 된다** —
   * 회차를 잘못 찾아온 게 아니라 망이 흔들린 것이라, 할 일은 다시 시도하는 것이다.
   */
  const offline = error.status === 0;
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim pre">{error.userMessage ?? ENTRY.notFound}</p>
        <button className="btn primary" onClick={() => (offline ? location.reload() : navigate("/"))}>
          {offline ? FAIL.retry : removed ? ENTRY.reenter : BTN.home}
        </button>
        {/* 파티장에는 운영자가 눈앞에 있다. 실패를 사람에게 넘길 수 있는 앱은 흔치 않다 */}
        {offline && <p className="tiny dim">{FAIL.askHost}</p>}
      </div>
    </div>
  );
}
