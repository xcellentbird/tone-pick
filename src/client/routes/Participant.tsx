/**
 * 참가자 화면 한 벌. 네 탭(홈·참가자·내 정보·재미)이 이 컴포넌트 하나를 나눠 쓴다.
 *
 * 자료는 통로(source)로 받는다 — 화면은 세션도 요청 경로도 모른다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, FAIL, FORTUNE, HELP, TABS_PARTICIPANT } from "../../shared/copy.ts";
import type { MyPokeState, ParticipantState } from "../../shared/types.ts";
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
import Sheet from "../ui/Sheet.tsx";
import Help from "../ui/Help.tsx";
import { canOpenFortune } from "../../shared/phase.ts";
import FortuneTab from "./Fortune.tsx";
import StatusBar from "../ui/StatusBar.tsx";

export type Tab = "home" | "fun" | "people" | "me";

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
  /**
   * 파티 룰 도움말. 라우트라 뒤로 가기로 닫힌다.
   *
   * 자리 확인창과 달리 **되돌릴 자리가 없는 경우를 걱정하지 않아도 된다** —
   * 주소를 직접 열 일이 없고, 열더라도 볼 것이 늘 있다.
   */
  helpOpen?: boolean;
  onHelp: (on: boolean) => void;
}

/**
 * 하단 탭.
 *
 * **'재미' 는 없다가 생기지 않는다** (ADR-20 후기). 처음부터 자리를 지키고,
 * 매력 투표와 함께 켜진다 — 탭이 도중에 생기면 넷이 나눠 쓰던 폭이 통째로 다시 나뉘어
 * 손가락이 기억한 자리가 어긋난다.
 *
 * 꺼진 탭은 **죽은 버튼이 아니다.** 누르면 언제 열리는지 말한다 —
 * 눌러도 아무 일이 없으면 고장으로 읽힌다. (`Overlays` 안이라 토스트를 쓸 수 있다)
 */
function Tabs({ tab, onTab, funOpen }: { tab: Tab; onTab: (t: Tab) => void; funOpen: boolean }) {
  const { toast } = useOverlay();
  return (
    <nav className="tabbar">
      {TABS_PARTICIPANT.map((t) => {
        const off = t.key === "fun" && !funOpen;
        return (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            /* `disabled` 로 두면 누른 것 자체가 안 와서 왜 안 되는지 말할 수 없다 */
            aria-disabled={off || undefined}
            onClick={() => (off ? toast(FORTUNE.closed) : onTab(t.key as Tab))}
            aria-current={tab === t.key}
          >
            <span className="icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
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
    : location.pathname.endsWith("/fun")
      ? "fun"
      : location.pathname.endsWith("/people") || location.pathname.includes("/p/")
        ? "people"
        : "home";
  const profileId = location.pathname.includes("/p/")
    ? decodeURIComponent(location.pathname.split("/p/")[1])
    : undefined;
  // 자리 화면을 **다시 여는** 길. 자동으로 뜨는 쪽은 라우트가 아니다 — 참가자가 연 게 아니다
  const seatOpen = location.pathname.endsWith("/seat");
  // 도움말도 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md)
  const helpOpen = location.pathname.endsWith("/help");

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
      helpOpen={helpOpen}
      onHelp={(on) => (on ? navigate(`${base}/help`) : navigate(-1))}
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
   *
   * **닿지 못한 실패(`status 0`)는 그 실패가 아니다.** 서버가 거절한 게 아니라 망이
   * 흔들린 것이라, 여기서 소켓까지 놓으면 스스로 돌아올 길이 함께 끊긴다 —
   * 안드로이드에서 화면을 껐다 켠 참가자가 오류 화면에 갇힌 게 이것이었다.
   * 소켓은 알아서 다시 붙고(`realtime.ts`), 붙는 순간 화면을 따라잡게 한다.
   */
  const failed = !!state.error && state.error.status !== 0;

  /*
   * **내 콕 한 칸만** 갈아끼우는 통로 (슬라이스 17). 화면이 서버 답을 기다리지 않고
   * 그 자리에서 바뀌게 한다.
   *
   * `set` 을 통째로 내려보내지 않는 이유가 여기 있다 — 그러면 받은 쪽에서 무엇이든
   * 갈아끼울 수 있고, ADR-26 의 예외가 조용히 넓어진다. 통로가 좁으면 넓힐 때
   * 이 줄을 고쳐야 해서 눈에 띈다.
   */
  const setPoke = useCallback(
    (poke: MyPokeState) => state.set((cur) => (cur ? { ...cur, poke } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  useEffect(() => {
    if (!source.liveCode || failed) return;
    const socket = connect(source.liveCode, () => state.reload());
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.liveCode, failed]);

  if (state.error) return <Failed error={state.error} code={code} onRetry={state.reload} busy={state.loading} />;
  if (!state.data) return <div className="screen" />;
  return <Loaded {...props} state={state.data} reload={state.reload} setPoke={setPoke} />;
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
  setPoke,
  helpOpen,
  onHelp,
}: ViewProps & { state: ParticipantState; reload: () => void; setPoke: (poke: MyPokeState) => void }) {
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

  /*
   * 아직 안 열린 '재미' 주소를 직접 연 경우. 탭이 꺼져 있어도 주소는 칠 수 있다 —
   * 자리 화면과 같이 홈으로 **갈아끼운다** (`onTab` 이 replace 한다).
   *
   * 탭의 문은 **가장 먼저 열리는 카드의 문**이다. 지금은 그게 운세라 `canOpenFortune` 이
   * 그대로 탭의 문이고, 더 일찍 열리는 카드가 들어오면 이 줄이 바뀔 자리다.
   */
  const funOpen = canOpenFortune(state.event.phase);
  useEffect(() => {
    if (tab === "fun" && !funOpen) onTab("home");
  }, [tab, funOpen, onTab]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  return (
    <Overlays>
      {welcome && <Greeting text={welcome} />}
      <div className="screen">
        {/* 스크롤해도 남는 자리다. 여기엔 반복해서 볼 것만 둔다 */}
        <header className="bar">
          <StatusBar state={state} onHelp={() => onHelp(true)} />
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
          {tab === "home" && (
            <Home state={state} onTab={onTab} onSeat={() => onSeat(true)} onHelp={() => onHelp(true)} />
          )}
          {tab === "people" && (
            <People
              state={state}
              source={source}
              reload={reload}
              setPoke={setPoke}
              profileId={profileId}
              onProfile={onProfile}
              onTab={onTab}
            />
          )}
          {/* 재미 탭. 지금은 운세 카드 하나뿐이다 — 이상형 찾기가 여기 두 번째로 붙는다 */}
          {tab === "fun" && <FortuneTab state={state} reload={reload} />}
          {tab === "me" && (
            <Me state={state} source={source} reload={reload} editing={!!editing} onEdit={onEdit} />
          )}
        </div>

        <Tabs tab={tab} onTab={onTab} funOpen={funOpen} />

        {/*
          아직 안 본 사람에게는 **자동으로** 덮치고 확인을 받는다.
          이미 본 사람이 홈에서 다시 연 경우(`/seat`)에는 닫기만 있다 —
          이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
        */}
        {needsSeatAck && state.seat && <SeatTakeover seat={state.seat} onAck={ack} />}
        {!needsSeatAck && seatOpen && state.seat && (
          <SeatTakeover seat={state.seat} onClose={() => onSeat(false)} />
        )}

        {/* 파티 룰 도움말. 어느 탭에서 열든 같은 것이 뜬다 */}
        <Sheet open={!!helpOpen} onClose={() => onHelp(false)} title={HELP.title}>
          <Help state={state} />
        </Sheet>
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
function Failed({
  error,
  code,
  onRetry,
  busy,
}: {
  error: ApiError;
  code?: string;
  /** 앱 안에서 요청만 다시 보낸다. 페이지를 다시 받지 않는다 */
  onRetry: () => void;
  busy: boolean;
}) {
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
  /** 세션이 이 회차의 것이 아니다. 참가 링크로 다시 들어오면 된다 */
  const sessionGone = error.status === 401 || error.status === 403;
  /*
   * 서버가 답은 했는데 우리 것이 아니다 — 500 이거나, 설명 없이 온 무엇이든.
   *
   * **이 전부가 "그런 회차가 없어요" 로 떨어지고 있었다.** `apiError()` 는 `message` 를
   * 선택으로 두므로 설명 없이 나가는 실패가 흔한데, 화면은 그때 링크를 탓했다.
   * 참가자는 멀쩡한 링크를 의심하고 운영자에게 엉뚱한 걸 묻는다 —
   * `status 0` 에서 이미 한 번 고친 실수인데 **이 경로가 남아 있었다.**
   *
   * 그래서 되묻는 순서를 뒤집었다. 기본값은 "회차가 없다" 가 아니라
   * **"우리가 못 불러왔다"** 이고, 링크를 탓하는 건 **404 하나뿐**이다.
   * 서버 탓일 때는 눈앞의 운영자에게 넘긴다 — 참가자가 할 수 있는 게 없다.
   */
  const broken = !offline && !removed && !sessionGone;
  /*
   * **망 문제에 `location.reload()` 를 걸면 안 된다.** 앱을 통째로 버리고 `index.html`
   * 부터 다시 받는 일인데, 망이 흔들리는 바로 그 순간에 가장 하면 안 되는 것이다.
   * 실패하면 브라우저의 오류 화면으로 넘어가고 거기서는 우리가 할 수 있는 게 없다.
   * 요청 하나만 다시 보내면 된다 — 성공하면 그 자리에서 화면이 돌아온다.
   */
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim pre">{error.userMessage ?? (removed ? ENTRY.notFound : FAIL.title)}</p>
        <button
          className="btn primary"
          disabled={offline && busy}
          onClick={() => (offline ? onRetry() : broken ? location.reload() : navigate("/"))}
        >
          {offline
            ? busy
              ? FAIL.reconnecting
              : FAIL.reconnect
            : broken
              ? FAIL.retry
              : removed
                ? ENTRY.reenter
                : BTN.home}
        </button>
        {/* 파티장에는 운영자가 눈앞에 있다. 실패를 사람에게 넘길 수 있는 앱은 흔치 않다 */}
        {(offline || broken) && <p className="tiny dim">{FAIL.askHost}</p>}
      </div>
    </div>
  );
}
