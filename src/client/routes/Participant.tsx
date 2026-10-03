/**
 * 참가자 화면 한 벌. 네 탭(홈·참가자·내 정보·재미)이 이 컴포넌트 하나를 나눠 쓴다.
 *
 * 자료는 통로(source)로 받는다 — 화면은 세션도 요청 경로도 모른다.
 */
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, FAIL, FUN, HELP, NOTE, TABS_PARTICIPANT } from "../../shared/copy.ts";
import type { MyNoteState, MyPokeState, PublicAnnouncement, ParticipantState, StageKey } from "../../shared/types.ts";
import type { Fortune } from "../../shared/fortune.ts";
import type { Ideal } from "../../shared/ideal.ts";
import { connect } from "../lib/realtime.ts";
import { canNote, canOpenFun, canPoke } from "../../shared/phase.ts";
import { bannerOf, noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { sessionSource, type ParticipantSource } from "../lib/participant.ts";
import { useCovered } from "../lib/covered.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ApiError } from "../lib/api.ts";
import { nav, startPulse } from "../lib/pulse.ts";
import { FACES_READY } from "../lib/faces.ts";
import type { NavKey } from "../../shared/pulse.ts";
import { Overlays } from "../ui/Overlays.tsx";
import People from "./People.tsx";
import Me from "./Me.tsx";
import Home from "./Home.tsx";
import SeatTakeover from "../ui/SeatTakeover.tsx";
import StageTakeover from "../ui/StageTakeover.tsx";
import Sheet from "../ui/Sheet.tsx";
import Help from "../ui/Help.tsx";
import NoteBox, { type InboxSeg } from "../ui/NoteBox.tsx";
import FortunePage, { FortuneCard } from "./Fortune.tsx";
import IdealCard from "./IdealCard.tsx";
import StatusBar from "../ui/StatusBar.tsx";

/*
 * 이상형 찾기의 고르는 화면은 **따로 싣는다** (슬라이스 19). 여는 사람만 받으면 되는 조각이다 —
 * 재미 탭이 그려지면 미리 부르기 시작해서, 카드를 누를 때는 이미 와 있다.
 */
const loadIdeal = () => import("./Ideal.tsx");
const IdealFlow = lazy(loadIdeal);

/**
 * 이상형 조각을 못 받았을 때 (슬라이스 19). **세션 한가운데서 받는 첫 조각**이라 생긴 자리다 —
 * 등록은 파티 며칠 전에 열려서(ADR-38) 그때 연 탭이 배포를 건너 살아 있을 수 있고, 그 탭이 아는
 * 옛 `Ideal-<해시>.js` 는 새 배포에 없다(`/assets/*` 는 없는 파일에 일부러 404 — src/server/index.ts).
 *
 * `lazy` 는 실패한 약속을 **그대로 쥐고 있어서** 그 자리에서 다시 부를 길이 없다 — 새로고침만 된다.
 * 그래서 버튼은 `FAIL.retry`(새로고침)다. 재미 탭 본문 **안에서** 말한다 — 탭 바와 헤더는 산다.
 * 토스트가 아니다: 화면이 비어 있는 동안 계속 말해야 한다 (ADR-65).
 */
class IdealBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };

  static getDerivedStateFromError() {
    return { dead: true };
  }

  render() {
    if (!this.state.dead) return this.props.children;
    return (
      <div className="card stack center">
        <p className="dim small">{FAIL.title}</p>
        <button className="btn" onClick={() => location.reload()}>
          {FAIL.retry}
        </button>
      </div>
    );
  }
}

export type Tab = "home" | "fun" | "people" | "me";

interface ViewProps {
  source: ParticipantSource;
  /** URL 이 가리키는 회차. 세션이 끊겼을 때 어디로 되돌릴지 판단에 쓴다 */
  code?: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** 프로필 시트도 라우트다 — 뒤로 가기로 닫힌다 */
  profileId?: string;
  onProfile: (playerId: string | null) => void;
  /**
   * 익명 쪽지 작성 시트 (슬라이스 36). **프로필 시트 위에 쌓이지 않고 대신 선다** —
   * 이 저장소의 시트는 겹치지 않는다 (운영자 콘솔의 떨어뜨리기 시트와 같다).
   */
  noteOpen?: boolean;
  onNote: (on: boolean, opts?: { replace?: boolean }) => void;
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
  /**
   * 익명 쪽지함 (ADR-98 후기 3). 도움말처럼 **상단 바에서 어느 탭에서든 열리는 시트**다.
   * 뒤로 가기로 닫힌다. 이 회차에 쪽지가 없는데 주소를 직접 열면 갈아끼운다 (`/seat` 와 같다).
   */
  notesOpen?: boolean;
  onNotes?: (on: boolean, opts?: { replace?: boolean }) => void;
  /**
   * 이상형 찾기 (슬라이스 19). 재미 탭 **안의 페이지**다 — 시트가 아니다.
   * `undefined` 면 재미 탭 카드, 0 이면 `/ideal`(시작 또는 결과), 1~3 이면 라운드, 그 밖은 없는 주소다.
   */
  idealRound?: number;
  /** `/ideal/again` — 다시 찾기의 시작 화면 (ADR-125). `idealRound` 는 0 이다 */
  idealAgain?: boolean;
  /**
   * 0 = `/ideal`(push), 1~3 = 라운드(push). `replace` 는 **열리면 안 되는 라운드 주소에서 시작으로 물러날 때**다 —
   * 이 화면이 쌓은 칸이면 그만큼 되감고, 아니면 갈아끼운다 (결과를 저장한 뒤의 되감기도 이 길이다).
   */
  onIdeal?: (to: number, opts?: { replace?: boolean }) => void;
  /**
   * 다시 찾기 (ADR-125). 재미 탭 카드에서는 쌓고(push), 결과 화면에서는 결과 칸을 **갈아끼운다** —
   * 쌓으면 새 결과를 본 뒤의 뒤로 가기가 지난 결과를 한 번 더 보여준다.
   */
  onIdealAgain?: (opts?: { replace?: boolean }) => void;
  /** 파티 운세 보기 페이지(`/fortune`, ADR-125) — 재미 탭 **안의 페이지**다. 이상형 찾기와 같은 자리 */
  fortunePage?: boolean;
  onFortunePage?: (on: boolean) => void;
}

/**
 * 하단 탭.
 *
 * **'재미' 는 없다가 생기지 않는다** (ADR-20 후기). 처음부터 자리를 지킨다 —
 * 탭이 도중에 생기면 넷이 나눠 쓰던 폭이 통째로 다시 나뉘어 손가락이 기억한 자리가 어긋난다.
 *
 * **넷 다 등록부터 켜져 있다.** 한동안 '재미' 는 운세의 문을 빌려 매력 투표 전에 꺼져 있었다(흐린 탭 + 토스트) —
 * 이상형 찾기가 등록부터 열리면서 그 문을 걷었다(ADR-122). 재미가 다시 한 번에 열리게 됐어도(ADR-125) **꺼진 탭을
 * 되살리지 않는다** — 탭 안에서 맨 위 한 줄이 언제 볼 수 있는지 말하고, 카드는 무엇이 오는지 보여준다.
 */
function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
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
  );
}

/** URL 이 상태를 들고 있는 진짜 참가자 화면 */
export default function Participant() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/e/${code}`;

  const source = useMemo(() => sessionSource(code), [code]);
  // 도움말도 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md)
  const helpOpen = location.pathname.endsWith("/help");
  // 익명 쪽지함도 같다 (ADR-98 후기 3)
  const notesOpen = location.pathname.endsWith("/notes");
  /*
   * **도움말·쪽지함은 연 화면 위에 선다** (ADR-114). 두 주소에는 탭이 없어서 한동안 뒤가 **홈으로 바뀌었다** —
   * 참가자 탭에서 ✉️ 나 ? 를 누르면 시트 뒤로 홈 카드가 비쳤고, 내 정보를 고치다 열면 고치던 폼이 사라졌다.
   * 그래서 연 자리의 주소를 기록(`state.under`)에 실어 열고, 아래 화면(탭·편집)은 그 주소로 읽는다.
   * 기록은 새로고침에도 남는다. 주소를 바로 열었거나 등록을 마치고 저절로 열린 도움말이면 기록이 없다 — 홈이다.
   * **이 회차 안의 주소만 받는다** — 기록은 누구든 넣을 수 있는 값이다.
   */
  const saved = (location.state as { under?: unknown } | null)?.under;
  const ours = typeof saved === "string" && (saved === base || saved.startsWith(`${base}/`));
  const under = helpOpen || notesOpen ? (ours ? saved : base) : location.pathname;
  // 프로필 시트(/p/:id)는 참가자 탭 위에, 편집(/me/edit)은 내 정보 탭 위에 뜬 것이다 —
  // 탭 표시는 그 아래 탭 그대로 둔다
  const editing = under.endsWith("/me/edit");
  /*
   * 이상형 찾기(슬라이스 19)는 재미 탭 위의 페이지다. **`under` 로 읽는다** (ADR-114) — 라운드 중에 ? 나 ✉️ 를 열어도
   * 시트 뒤에 그 라운드가 그대로 서고, 고르던 값도 산다. 이 회차의 `/ideal` 로 **시작하는** 주소만 받는다 —
   * 끝 조각으로 보면 다른 주소의 아이디가 우연히 걸린다.
   */
  const idealAt = `${base}/ideal`;
  const idealRest = under === idealAt ? "" : under.startsWith(`${idealAt}/`) ? under.slice(idealAt.length + 1) : null;
  /*
   * 1~3 이 아닌 조각(`/ideal/9`)은 -1 — 화면이 시작으로 갈아끼운다.
   * **자산이 없는 빌드에서는 이상형 주소가 없다** (S-C5, `lib/faces.ts`) — 카드도 없고 주소는 홈으로 읽힌다.
   */
  const idealRound = !FACES_READY || idealRest === null
    ? undefined
    : idealRest === "" || idealRest === "again" ? 0 : /^[1-3]$/.test(idealRest) ? Number(idealRest) : -1;
  /** 다시 찾기의 시작 주소 (ADR-125). 칸 수는 `/ideal` 과 같다 — 카드나 결과 화면이 연 첫 칸(0)이다 */
  const idealAgain = idealRound === 0 && idealRest === "again";
  /*
   * 파티 운세 보기 페이지 (ADR-125). 이상형 찾기처럼 재미 탭 위의 페이지이고, **`under` 로 읽는다** — ?·✉️ 를 열어도
   * 그 페이지가 시트 뒤에 선다. 카드가 연 칸이면 `fortuneStep: 0` 을 싣는다 — 탭을 누를 때 이 칸부터 걷는 근거다.
   */
  const fortuneAt = `${base}/fortune`;
  const fortunePage = under === fortuneAt;
  const rawFortuneStep = (location.state as { fortuneStep?: unknown } | null)?.fortuneStep;
  const fortuneStep = !helpOpen && !notesOpen && fortunePage && rawFortuneStep === 0 ? 0 : undefined;
  /*
   * 이 칸을 이상형 화면이 **직접 쌓았나** — 카드가 `/ideal` 을 0 으로, 라운드 n 을 n 으로 싣는다.
   * 주소와 맞을 때만 믿는다(시트 칸에는 없다). 그 수가 곧 **이 칸 뒤에 이 화면이 쌓은 칸 수**이고,
   * `/ideal`(0) 바로 뒤는 카드를 누른 재미 탭이다 — 되감을 칸 수의 근거가 여기 하나다.
   */
  const rawStep = (location.state as { idealStep?: unknown } | null)?.idealStep;
  const idealStep =
    !helpOpen && !notesOpen && idealRound !== undefined && rawStep === Math.max(idealRound, 0) ? rawStep : undefined;
  /** 같은 칸에서 두 번 되감지 않는다 — 가드는 그릴 때마다 돌고, 되감기는 한 박자 뒤에 끝난다 */
  const rewound = useRef<string | null>(null);
  /*
   * 이상형 화면에서 탭을 누르면 그 화면이 쌓은 칸부터 걷고(재미 탭 칸까지 되감고) **거기서** 탭을 옮긴다.
   * 되감기는 한 박자 뒤에 끝나서, 옮길 곳을 들고 있다가 재미 탭에 닿으면 갈아끼운다.
   */
  const pendingTab = useRef<string | null>(null);
  useEffect(() => {
    const to = pendingTab.current;
    if (!to) return;
    pendingTab.current = null;
    if (location.pathname === `${base}/fun`) navigate(to, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  const tab: Tab = under.endsWith("/me") || editing
    ? "me"
    : under.endsWith("/fun") || idealRound !== undefined || fortunePage
      ? "fun"
      : under.endsWith("/people") || under.includes("/p/")
        ? "people"
        : "home";
  /*
   * ⚠️ **뒤 조각을 갈라야 한다.** `/p/:pid` 뒤에 `/note` 가 붙을 수 있어서(슬라이스 36),
   * `split("/p/")[1]` 을 통째로 아이디로 쓰면 `abc/note` 가 되어 **프로필을 못 찾는다.**
   */
  const afterP = location.pathname.includes("/p/") ? location.pathname.split("/p/")[1] : undefined;
  const profileId = afterP ? decodeURIComponent(afterP.replace(/\/note$/, "")) : undefined;
  /** 익명 쪽지 작성 시트. 조건이 안 맞으면 `People` 이 프로필 시트로 갈아끼운다 */
  const noteOpen = !!afterP && afterP.endsWith("/note");
  // 자리 화면을 **다시 여는** 길. 자동으로 뜨는 쪽은 라우트가 아니다 — 참가자가 연 게 아니다
  const seatOpen = location.pathname.endsWith("/seat");

  /*
   * 어느 화면까지 왔나를 **집계로만** 남긴다 (ADR-56).
   *
   * 여기 한 곳에서 보는 이유는 화면 상태가 전부 주소에 있기 때문이다 (ROUTES.md) —
   * 탭마다 흩어 놓으면 새 탭이 생길 때 빠뜨리고, 빠뜨린 걸 아무도 모른다.
   * ⚠️ **주소를 그대로 보내지 마라.** `/e/:code` 의 코드가 실린다 — 화면 **이름**만 보낸다.
   */
  const screen: NavKey = helpOpen ? "help" : notesOpen ? "notes" : seatOpen ? "seat" : profileId ? "profile" : tab;
  useEffect(() => nav(screen), [screen]);
  useEffect(() => startPulse(), []);

  return (
    <ParticipantView
      source={source}
      code={code}
      tab={tab}
      onTab={(next) => {
        /**
         * 홈 탭이 스택의 **바닥**이다. 어느 탭에 있든 뒤로 가기 한 번이면 여기로 온다.
         *
         * 예전에는 탭 이동이 전부 push 라, 탭을 오갈수록 히스토리가 쌓이고 뒤로 가기가
         * "내 발자국 되감기"가 됐다. 사람은 뒤로 가기를 "목록으로 돌아가기"로 기대한다.
         */
        const to = next === "home" ? base : `${base}/${next}`;
        /*
         * **이상형 화면이 쌓은 칸 위라면 그 칸부터 걷는다** (슬라이스 19). 그대로 갈아끼우면 라운드 칸이 기록에 남아
         * 뒤로 가기가 그 칸들을 하나씩 밟는다 — 가드가 매번 시작 화면으로 돌려보내 같은 화면을 몇 번이고 본 뒤에야
         * 홈에 닿는다. 재미 탭 칸까지 되감은 뒤 거기서 여느 때처럼 옮긴다 (재미 탭에서 누른 것과 같다).
         */
        if (idealStep !== undefined) {
          pendingTab.current = next === "fun" ? null : to;
          navigate(-(idealStep + 1));
          return;
        }
        // 파티 운세 보기 페이지도 같다 — 카드가 쌓은 한 칸을 걷고 재미 탭에서 옮긴다 (ADR-125)
        if (fortuneStep !== undefined) {
          pendingTab.current = next === "fun" ? null : to;
          navigate(-1);
          return;
        }
        navigate(to, { replace: tab !== "home" });
      }}
      profileId={profileId}
      // 시트 열기는 push, 닫기는 뒤로 가기 — 안드로이드 백 버튼으로 닫혀야 한다
      onProfile={(id) => (id ? navigate(`${base}/p/${id}`) : navigate(-1))}
      noteOpen={noteOpen}
      /*
       * 작성 시트도 push 다 — 뒤로 가기가 곧 취소이고 쓰던 글은 버려진다 (내 정보 고치기와 같다).
       * 닫을 때 `replace` 는 **갈아끼움**이다: 조건이 안 맞는 주소를 직접 연 사람에게는
       * 뒤로 갈 자리가 없다 (`/seat` 와 같은 규칙).
       */
      onNote={(on, opts) =>
        on
          ? navigate(`${base}/p/${profileId}/note`)
          : opts?.replace
            ? navigate(`${base}/p/${profileId}`, { replace: true })
            : navigate(-1)
      }
      seatOpen={seatOpen}
      helpOpen={helpOpen}
      // 연 자리를 기록에 싣는다 — 시트 뒤에 그 화면이 그대로 선다 (위 `under`)
      onHelp={(on) => (on ? navigate(`${base}/help`, { state: { under: location.pathname } }) : navigate(-1))}
      notesOpen={notesOpen}
      /*
       * 도움말과 같다 — 열기는 push, 닫기는 뒤로 가기. 쪽지함이 꺼진 주소면 **아래 화면으로** 갈아끼운다 —
       * 바로 연 주소는 아래가 홈이라 홈이다
       */
      onNotes={(on, opts) =>
        on
          ? navigate(`${base}/notes`, { state: { under: location.pathname } })
          : opts?.replace
            ? navigate(under, { replace: true })
            : navigate(-1)
      }
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
      idealRound={idealRound}
      idealAgain={idealAgain}
      /*
       * 카드 → `/ideal` → `/1` → `/2` → `/3` 은 전부 push — 뒤로 가기가 곧 이전 라운드다 (등록 스텝과 같다).
       * 칸마다 몇 번째인지 싣는다(`idealStep` — 카드가 연 `/ideal` 은 0). 되감을 칸 수를 거기서 읽는다.
       */
      onIdeal={(to, opts) => {
        if (to >= 1) return navigate(`${idealAt}/${to}`, { state: { idealStep: to } });
        if (!opts?.replace) return navigate(idealAt, { state: { idealStep: 0 } });
        /*
         * **열리면 안 되는 라운드 주소에서 시작으로 물러난다** — 결과가 있거나(결과를 막 저장했을 때도 이 길이다),
         * 고르던 값이 없거나(새로고침·탭 바로 나갔다 뒤로 오기·앞으로 가기), 없는 라운드다.
         *
         * ① 시트(?·✉️)가 떠 있으면 **시트 칸을 지키고 그 아래만 바꾼다.** 주소를 갈아끼우면 시트가 사라지고
         *    뒤로 가기로 닫힐 칸도 같이 사라진다.
         * ② 이 칸을 이 화면이 쌓았으면(`idealStep`) **그만큼 되감는다.** 갈아끼우면 뒤의 라운드 칸이 기록에 남아
         *    뒤로 가기가 그 칸을 하나씩 밟으며 시작 화면을 몇 번이고 보여준다. 결과를 저장한 뒤라면
         *    뒤로 가기가 라운드를 되밟지 않고 재미 탭으로 간다 (S-B4).
         *    ⚠️ ROUTES.md 는 기록을 손으로 되감지 않는다 — 몇 칸이 쌓였는지 믿을 수 없어서다. 여기는 칸마다
         *    이 화면이 직접 적어 둔 수가 있고, **지금 선 칸**의 수로 센다. 누른 순간의 칸으로 세면 저장을 기다리는
         *    동안 뒤로 가거나 시트를 연 사람에게 엉뚱한 칸에 닿는다.
         * ③ 표시가 없으면(주소를 바로 열었다) 믿지 않고 갈아끼운다 — 뒤로 갈 자리가 없다.
         */
        if (helpOpen || notesOpen) return navigate(location.pathname, { replace: true, state: { under: idealAt } });
        if (idealStep !== undefined && idealStep >= 1) {
          if (rewound.current === location.key) return;
          rewound.current = location.key;
          return navigate(-idealStep);
        }
        // 다시 찾기의 시작 칸(0)에서 결과로 물러날 때는 칸 표시를 그대로 옮긴다 — 뒤가 재미 탭이라는 근거다
        navigate(idealAt, { replace: true, state: idealStep === 0 ? { idealStep: 0 } : undefined });
      }}
      /*
       * 다시 찾기 (ADR-125). 결과 화면에서는 **그 칸을 갈아끼운다** — 칸 표시(뒤가 재미 탭인가)도 그대로 옮긴다.
       * 재미 탭 카드에서는 쌓는다. 어느 쪽이든 이 칸이 이 흐름의 첫 칸(0)이고, 라운드는 그 위에 쌓인다.
       */
      onIdealAgain={(opts) =>
        opts?.replace
          ? navigate(`${idealAt}/again`, { replace: true, state: idealStep === 0 ? { idealStep: 0 } : undefined })
          : navigate(`${idealAt}/again`, { state: { idealStep: 0 } })
      }
      fortunePage={fortunePage}
      // 카드 → 페이지는 push, 닫기는 뒤로 가기 — 안드로이드 백 버튼으로 재미 탭에 돌아온다
      onFortunePage={(on) => (on ? navigate(fortuneAt, { state: { fortuneStep: 0 } }) : navigate(-1))}
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
  /** 익명 쪽지 한 칸만 갈아끼운다 (슬라이스 36). `setPoke` 와 같은 이유로 통로가 좁다 */
  const setNote = useCallback(
    (note: MyNoteState) => state.set((cur) => (cur ? { ...cur, note } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 설문 답 한 칸만 갈아끼운다 (슬라이스 27). `setPoke` 와 같은 이유로 통로가 좁다 */
  const setAnnouncement = useCallback(
    (a: PublicAnnouncement) =>
      state.set((cur) => (cur ? { ...cur, announcements: cur.announcements.map((x) => (x.id === a.id ? a : x)) } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 연 운세 한 칸만 갈아끼운다. 서버가 돌려준 그 카드다 — `setPoke` 와 같은 이유로 통로가 좁다 */
  const setFortune = useCallback(
    (fortune: Fortune) => state.set((cur) => (cur ? { ...cur, fortune } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 이상형 찾기 한 칸만 갈아끼운다 (슬라이스 19). 서버가 돌려준 **저장된 행**이다 — 방금 고른 셋이 아닐 수 있다 (S-E2) */
  const setIdeal = useCallback(
    (ideal: Ideal) => state.set((cur) => (cur ? { ...cur, ideal } : cur)),
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
  return (
    <Loaded
      {...props}
      state={state.data}
      reload={state.reload}
      setPoke={setPoke}
      setNote={setNote}
      setAnnouncement={setAnnouncement}
      setFortune={setFortune}
      setIdeal={setIdeal}
    />
  );
}

function Loaded({
  source,
  tab,
  onTab,
  profileId,
  onProfile,
  noteOpen,
  onNote,
  editing,
  onEdit,
  seatOpen,
  onSeat,
  state,
  reload,
  setPoke,
  setNote,
  setAnnouncement,
  setFortune,
  setIdeal,
  helpOpen,
  onHelp,
  notesOpen,
  onNotes,
  idealRound,
  idealAgain,
  onIdeal,
  onIdealAgain,
  fortunePage,
  onFortunePage,
}: ViewProps & {
  state: ParticipantState;
  reload: () => void;
  setPoke: (poke: MyPokeState) => void;
  setNote: (note: MyNoteState) => void;
  setAnnouncement: (a: PublicAnnouncement) => void;
  setFortune: (f: Fortune) => void;
  setIdeal: (i: Ideal) => void;
}) {
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
       * 서버에는 미확인으로 남아, 앱을 다시 열 때 전체 화면이 또 덮친다.
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

  /**
   * 파티가 시작됐나. 자리 확인 화면의 문장이 여기서 갈린다 (ADR-39) —
   * 첫 자리는 파티 전에 나가고, 그때 받는 사람은 **아직 오는 중**일 수 있다.
   */
  const started = state.event.phase === "party" || state.event.phase === "done";

  /*
   * 재미 탭이 그려지면 이상형 화면 조각을 미리 부른다 — 카드를 누를 때 빈 화면으로 기다리지 않게.
   * 조각만이다. **얼굴 자료는 받지 않는다** — 안 여는 사람은 1바이트도 안 받는다 (슬라이스 19).
   */
  useEffect(() => {
    // 실패는 여기서 삼킨다 — 여는 순간 `lazy` 가 다시 부르고, 그때 실패는 `IdealBoundary` 가 말한다
    if (tab === "fun" && FACES_READY) loadIdeal().catch(() => {});
  }, [tab]);

  /*
   * **재미는 한 번에 열린다 — 프로필 투표부터** (ADR-125). 열기 전에 기능 페이지 주소가 열리면(주소를 바로 열었거나 운영자가
   * 단계를 되돌렸다) 재미 탭으로 물러난다 — 거기서 맨 위 한 줄이 언제 볼 수 있는지 말한다. **찾은 결과가 있으면 그대로 본다** —
   * 막는 것은 새로 만드는 일뿐이다. 물러나는 길은 탭을 누른 것과 같다: 이 화면이 쌓은 칸이면 걷고, 아니면 갈아끼운다.
   */
  const funOpen = canOpenFun(state.event.phase);
  const funStray = !funOpen && ((idealRound !== undefined && !state.ideal) || (!!fortunePage && !state.fortune));
  useEffect(() => {
    if (funStray) onTab("fun");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funStray]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  /**
   * 단계가 열릴 때의 안내 (ADR-96, 슬라이스 34). 새 행동이 열리는 순간이 둘뿐이라 매력 투표와 파티만이다 —
   * 등록 직후는 도움말이, 마감은 자리 화면이, 발표는 결과 카드가 이미 그 자리다.
   *
   * **자리 확인이 먼저다** — 몸을 옮기는 지시가 설명보다 앞이다. 둘 다 뜰 자리면 자리를 확인한 뒤에 온다.
   * 봤다는 건 서버가 안다(`me.seenStage`, 사건이 아니라 상태다 — 예약이 여는 순간 앱을 켜둔 사람이 없다).
   * 누른 즉시 감추고, 저장이 실패하면 되돌린다 — 자리 확인과 같다.
   *
   * 문은 참가자 탭의 버튼과 **같은 판정**(`canPoke`)이다 — 닫는 길이 하나 더 생겨도 여기와 거기가 따로 갈 수 없다.
   */
  const stage: StageKey | null = !canPoke(state.event.phase)
    ? null
    : state.event.phase === "party"
      ? "party"
      : "prevote";
  const [seenLocal, setSeenLocal] = useState<StageKey | null>(null);
  const needsStage = !!stage && state.me.seenStage !== stage && seenLocal !== stage && !needsSeatAck;

  /**
   * 어깨너머 가리기 (슬라이스 16). **여기서 한 번만 읽는다** — 참가자 탭과 프로필 시트의 ✉️ 가 같은 값을 본다.
   * 쪽지함에는 가리기가 없다 (ADR-119) — 읽음 판정도 이 값을 보지 않는다. 저장은 localStorage 하나다 (서버로 보내지 않는다).
   */
  const [covered, setCovered] = useCovered();

  /**
   * 익명 쪽지함 ✉️ 는 **늘 선다** — 단계도 장 수도 안 본다 (ADR-111 · 후기 1). 없다가 생기면 상단 바의 회차 이름 칸이
   * 그 순간 줄어든다 — 재미 탭이 처음부터 자리를 지키는 것과 같은 이유다 (ADR-20 후기). 장 수를 보면 운영자가
   * 파티 중에 0 과 1~5 사이를 오갈 때마다(굳지 않는다) 그 칸이 늘었다 줄었다 한다.
   *
   * **켜져 있나는 따로다** (`inboxLive`). 쓰는 창(`canNote`)과 함께 매력 투표에 켜지고, 발표 뒤에도 켜져 있다 —
   * 온 쪽지는 끝까지 읽을 수 있어야 한다. 쪽지를 0장으로 둔 회차는 꺼진 채다.
   * **주고받은 것이 하나라도 있으면 언제든 켜진다** — 운영자가 0 으로 내린 회차가 곧 괴롭힘이 있었던 회차이고,
   * 거기서 이미 온 쪽지도 읽을 수 있어야 한다 (도움말 문답과 같은 조건). 단계를 뒤로 물린 회차도 같다.
   */
  const note = state.note;
  const hasNotes = note.received.length > 0 || Object.keys(note.sent).length > 0;
  const notesOn = (state.event.config.maxNotes ?? 0) > 0;
  const inboxLive = hasNotes || (notesOn && (canNote(state.event.phase) || state.event.phase === "done"));
  /** 꺼져 있을 때 누르면 말할 한 줄. 끈 회차는 단계가 와도 안 켜지므로 `언제부터` 를 말하면 거짓이다 */
  const inboxOff = inboxLive ? undefined : notesOn ? NOTE.inbox.notYet : NOTE.inbox.off;
  useEffect(() => {
    if (notesOpen && !inboxLive) onNotes?.(false, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesOpen, inboxLive]);

  /**
   * **덮개(자리 확인 · 단계 안내)와 시트는 겹치지 않는다.**
   *
   * 시트와 확인창은 Radix 모달이라, 열려 있는 동안 그 밖의 모든 것에서 손가락을 뺏는다
   * (`body` 에 `pointer-events: none`). 덮개는 그 위에 **그려지기만 하고 눌리지 않았다** — 누른 손가락은
   * 뒤에 가려진 시트의 글자에 닿았다. 등록을 마치면 도움말이 저절로 열려서(슬라이스 21) 매력 투표·파티 중에
   * 온 사람은 모두 `참가자 보러 가기` 가 아무 일도 안 하는 화면에 갇혔고, 파티 중 자리가 나올 때마다
   * 프로필·쪽지를 보던 사람의 `자리 확인` 이 같은 일을 겪었다.
   *
   * · **자리 확인은 바로 선다** — 몸을 옮기는 지시다. 그동안 시트는 닫혀 있고, 라우트는 그대로라 확인하면 돌아온다
   * · **단계 안내는 기다린다** — 설명이다. 시트가 열려 있으면 닫힌 뒤에 선다. 등록을 마친 사람의 도움말이 먼저다
   * · 확인창은 자리·단계가 **바뀌는 순간** 취소된다 — 돌려놓지 않는다 (`Overlays` 의 `suspend`)
   */
  const seatUp = needsSeatAck && !!state.seat;
  const sheetOpen = !!helpOpen || (!!notesOpen && inboxLive) || (tab === "people" && (!!profileId || !!noteOpen));
  const stageUp = needsStage && !!stage && !sheetOpen;

  /**
   * 받은 익명 쪽지를 **읽음으로 찍는다.** 여기 있는 이유는 셋을 한자리에서 보기 때문이다 —
   * 쪽지함이 열려 있나, 덮개가 덮고 있나(`needsSeatAck`·`needsStage`), 어깨너머 가리기가 켜져 있나.
   *
   * **읽음은 쪽지함을 열 때다** (ADR-98 후기 3). 한동안 홈이 그려지면 찍었는데, 쪽지 줄이 홈 맨 아래라
   * **스크롤하지 않아도 읽음이 섰다** — 배지가 말하는 것보다 코드가 넓게 재고 있었다.
   * 쪽지함은 열면 받은 쪽지가 맨 위에 있다.
   *
   * **받은 쪽지 쪽이 열려 있으면 곧 읽은 것이다** (ADR-119). 한동안 가리기 중에는 안 찍었다 — 안 읽고 지우는 길이었는데,
   * 운영자가 쪽지함에서 가리기와 지우기를 함께 걷었다.
   *
   * ⚠️ **덮개 아래에서는 찍지 않는다.** 자리 확인이 서면 쪽지함 시트가 닫힌다 — 열려 있지 않은 쪽지함을 읽은 것으로
   * 찍으면 `문구가 코드보다 넓게 말하면 거짓말` 에 걸린다.
   *
   * ⚠️ **보낸 쪽지를 보는 동안에도 찍지 않는다.** 쪽지함이 열려 있어도 화면은 다른 신호로 계속 다시 읽히고,
   * 그때 새 쪽지가 오면 본문을 본 적 없는 사람에게 읽음이 찍혔다. 받은 쪽지로 돌아오는 순간 찍힌다.
   */
  const [inboxSeg, setInboxSeg] = useState<InboxSeg>("received");
  // 열면 늘 받은 쪽지부터다 — 닫힐 때 되돌려 두면 여는 순간부터 받은 쪽지가 보인다
  useEffect(() => {
    if (!notesOpen) setInboxSeg("received");
  }, [notesOpen]);
  /*
   * **쪽지함을 열면 서버에서 한 번 더 읽는다** (ADR-118). 쪽지는 소켓으로 바로 온다 — 새 쪽지는 받는 사람에게,
   * 읽음은 보낸 사람에게 (ADR-120). 이것은 그물이다: 소켓이 막 끊겼다 붙는 사이에 지나간 것도 여는 순간 맞는다.
   * 쪽지 한 칸만 갈아끼운다(`setNote`). 못 읽었으면(망) 가진 값 그대로다.
   */
  useEffect(() => {
    if (!notesOpen) return;
    let alive = true;
    source.load().then(
      (next) => alive && setNote(next.note),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesOpen]);
  /*
   * **안 읽은 것이 있을 때만 찍는다** (`note.unread`). 한동안 줄 수(`received.length`)로 정했는데 둘이 샜다 —
   * 다 읽은 쪽지함을 열 때마다 서버에 쓰는 요청이 나갔고, 지운 한 장과 새로 온 한 장이 한 응답에 겹치면
   * 줄 수가 그대로라 **화면에 뜬 새 쪽지가 읽음으로 안 찍혔다.**
   */
  const notesShown =
    !!notesOpen && inboxLive && !seatUp && !stageUp && inboxSeg === "received" && note.unread > 0;
  useEffect(() => {
    if (!notesShown) return;
    let alive = true;
    // 못 찍었으면(망) 그대로 둔다 — 배지가 남고, 다음에 열 때 다시 찍는다. 읽는 사람에게 말할 일은 아니다
    source.seeNotes().then(
      (next) => {
        if (alive) setNote(next);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesShown, note.unread]);
  const seeStage = useCallback(async () => {
    if (!stage) return;
    setSeenLocal(stage);
    try {
      await source.markStage(stage);
      reload();
      // 버튼이 곧 다음 할 일이다 — 누르면 참가자 탭이다
      onTab("people");
    } catch {
      setSeenLocal(null);
    }
  }, [stage, source, reload, onTab]);

  return (
    <Overlays suspend={seatUp || (needsStage && !!stage)}>
      {/*
        바탕은 단계를 말하지 않는다 (ADR-67). `data-phase` 를 되살리지 마라 —
        옆 사람이 화면 색만 보고 이 사람이 어디쯤인지 읽는다.
      */}
      <div className="screen">
        {/* 스크롤해도 남는 자리다. 여기엔 반복해서 볼 것만 둔다 */}
        <header className="bar">
          <StatusBar
            state={state}
            /*
             * 회차 이름이 홈으로 가는 지름길이다. **홈 탭에서는 주지 않는다** —
             * 갈 곳이 없는데 눌리면 히스토리에 같은 주소가 한 칸 더 쌓이고,
             * 뒤로 가기가 "아무 일도 안 일어나는 한 번"이 된다.
             */
            onHome={tab === "home" ? undefined : () => onTab("home")}
            onHelp={() => onHelp(true)}
            inbox={{ unread: note.unread, off: inboxOff, onOpen: () => onNotes?.(true) }}
          />
        </header>

        <div className="body stack">
          {banner && tab !== "home" && tab !== "fun" && tab !== banner.tab && (
            /*
             * 최근 3분 안의 변화만 배너로. **이미 볼 수 있는 화면에서는 띄우지 않는다** —
             * 홈에는 소식 목록이 있고, 목적지 탭에는 소식 그 자체가 있다.
             * 누르면 그 알림의 목적지로 간다. 발표는 홈이 아니라 참가자 탭이다.
             *
             * **재미 탭에서는 띄우지 않는다** (ADR-129, 운영자). 이상형 찾기의 라운드는 고르던 값이 메모리에만 있는
             * 1분짜리 일이라, 눌러서 홈으로 가면 고른 얼굴이 사라지고 뒤로 가기로도 돌아오지 않는다. 그리고 프로필 투표 소식은
             * `이상형 찾기와 파티 운세 보기도 할 수 있게 됐어요` 라서 **그 말을 보고 들어온 바로 그 3분**에 라운드 위를 덮었다 —
             * 360×740 에서 `다음` 이 탭바에 걸리고 `다른 얼굴 보기` 는 화면 밖으로 밀렸다. 재미 탭에 있는 동안 놓친 소식은
             * 홈의 소식 목록에 그대로 있다. 프로필 투표와 파티의 시작은 탭과 상관없이 단계 안내 화면이 따로 알린다 —
             * 매칭 확인 · 공지 · 설문은 재미 탭을 나와 홈에서 본다 (알고 고른 대가다)
             */
            <button className="banner" onClick={() => onTab(banner.tab)}>
              <span className="icon">{banner.icon}</span>
              <span className="grow">
                <span className="name">{banner.title}</span>
                {/* 몸글의 줄바꿈을 지킨다 — 홈 소식 줄과 같은 글이다. 없으면 두 문장이 한 줄로 붙는다 */}
                {banner.body && <div className="small dim pre">{banner.body}</div>}
              </span>
            </button>
          )}
          {tab === "home" && (
            <Home
              state={state}
              onTab={onTab}
              onSeat={() => onSeat(true)}
              onHelp={() => onHelp(true)}
              // 서버가 방금 준 답을 버리고 다시 묻지 않는다 (슬라이스 17 과 같은 이유)
              onVote={async (id, choice) => setAnnouncement(await source.vote(id, choice))}
            />
          )}
          {tab === "people" && (
            <People
              state={state}
              source={source}
              reload={reload}
              setPoke={setPoke}
              setNote={setNote}
              profileId={profileId}
              onProfile={onProfile}
              noteOpen={noteOpen}
              onNote={onNote}
              onTab={onTab}
              covered={covered}
              setCovered={setCovered}
              underTakeover={seatUp}
            />
          )}
          {/*
            재미 탭 — **입구만 모인다** (ADR-125). 이상형 찾기가 **첫 카드**, 파티 운세 보기가 그 아래다 (ADR-124).
            두 기능은 각자 탭 안의 페이지에서 돈다 — 이상형은 `/ideal`(라운드 `/1..3`, 다시 찾기 `/again`), 운세는 `/fortune`.
            이상형 주소에서는 탭 본문이 그 화면이 된다 — **한 자리**라서 `/ideal` 과 라운드 사이를 오가도 같은 컴포넌트가 남아
            고르던 값이 산다 (S-B4). 열기 전에는 맨 위 한 줄이 탭 전체를 대신 말하고, 카드에는 단추가 없다.
          */}
          {tab === "fun" &&
            (idealRound !== undefined ? (
              <IdealBoundary>
                <Suspense fallback={<div />}>
                  <IdealFlow
                    round={idealRound}
                    again={!!idealAgain}
                    open={funOpen}
                    ideal={state.ideal}
                    onGo={(to, opts) => onIdeal?.(to, opts)}
                    onAgain={() => onIdealAgain?.({ replace: true })}
                    onSaved={setIdeal}
                  />
                </Suspense>
              </IdealBoundary>
            ) : fortunePage ? (
              <FortunePage state={state} onFortune={setFortune} />
            ) : (
              <>
                {!funOpen && (
                  <p className="funGate">
                    <span aria-hidden>🎲</span>
                    <span>{FUN.closed}</span>
                  </p>
                )}
                {/* 사진이 온 빌드에서만 연다 (S-C5, `lib/faces.ts`) */}
                {FACES_READY && (
                  <IdealCard
                    ideal={state.ideal}
                    open={funOpen}
                    onOpen={() => onIdeal?.(0)}
                    onAgain={() => onIdealAgain?.()}
                  />
                )}
                <FortuneCard state={state} open={funOpen} onOpen={() => onFortunePage?.(true)} />
              </>
            ))}
          {tab === "me" && (
            <Me state={state} source={source} reload={reload} editing={!!editing} onEdit={onEdit} />
          )}
        </div>

        <Tabs tab={tab} onTab={onTab} />

        {/*
          아직 안 본 사람에게는 **자동으로** 덮치고 확인을 받는다.
          이미 본 사람이 홈에서 다시 연 경우(`/seat`)에는 닫기만 있다 —
          이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
        */}
        {seatUp && state.seat && <SeatTakeover seat={state.seat} started={started} onAck={ack} />}
        {!needsSeatAck && seatOpen && state.seat && (
          <SeatTakeover seat={state.seat} started={started} onClose={() => onSeat(false)} />
        )}

        {/* 단계가 열릴 때의 안내 — 자리 확인 뒤, 그리고 열린 시트가 닫힌 뒤에 선다 (ADR-96, 위 `stageUp`) */}
        {stageUp && stage && (
          <StageTakeover
            stage={stage}
            count={state.poke.budget.party.max}
            notify={!!state.event.config.pokeNotify}
            onDone={seeStage}
          />
        )}

        {/*
          익명 쪽지함 (ADR-98 후기 3). 어느 탭에서 열든 같은 것이 뜬다.
          읽음 배지는 굳히지 않는다 — 열려 있는 동안에도 상대가 읽으면 바로 바뀐다 (ADR-120).
        */}
        <Sheet open={!!notesOpen && inboxLive && !seatUp} onClose={() => onNotes?.(false)} title={NOTE.inbox.title}>
          {notesOpen && inboxLive && (
            <NoteBox
              note={note}
              roster={state.roster}
              seg={inboxSeg}
              onSeg={setInboxSeg}
              open={canNote(state.event.phase) && (state.event.config.maxNotes ?? 0) > 0}
              onClose={() => onNotes?.(false)}
            />
          )}
        </Sheet>

        {/* 파티 룰 도움말. 어느 탭에서 열든 같은 것이 뜬다 */}
        <Sheet open={!!helpOpen && !seatUp} onClose={() => onHelp(false)} title={HELP.title}>
          <Help state={state} />
          {/*
            **읽기를 마친 손가락이 그 자리에서 닫는다.** 도움말은 화면을 거의 덮고
            등록을 마치면 저절로 열리는데, 그때까지 닫는 길은 뒤로 가기와 바깥 누르기뿐이라
            **처음 들어온 사람이 나갈 곳을 찾아 헤맸다** — 하필 그 사람이 이 글의 독자다.
            프로필 시트가 이미 같은 자리에 같은 버튼을 둔다 (`People.tsx`).

            닫기는 여전히 **뒤로 가기**다 (ROUTES.md) — 이 버튼도 `navigate(-1)` 로 간다.
            여기서 주소를 직접 갈아끼우면 히스토리에 도움말이 남아 뒤로 가기가 다시 연다.
          */}
          <button className="btn block ghost" onClick={() => onHelp(false)}>
            {BTN.close}
          </button>
        </Sheet>
      </div>
    </Overlays>
  );
}

/**
 * 참가자 화면이 열리지 않는 세 경우.
 *
 *   401  세션이 없다 → 문 앞으로 돌려보낸다
 *   404  회차는 있는데 **내가 없다** — 운영자가 지웠다. 그렇다고 말한다
 *   그 밖  서버가 준 문장을 그대로
 *
 * 404 를 "그런 파티가 없어요" 로 뭉뚱그리면 참가자는 링크를 의심하고 운영자에게
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
   * **이 전부가 "그런 파티가 없어요" 로 떨어지고 있었다.** `apiError()` 는 `message` 를
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
   * **회차를 잃었다** (ADR-71). 다시 물어도 같은 답이고, 이 앱에서 회차에 들어가는 길은
   * **참가 링크 하나**다 (ADR-13·15·32) — 앱이 대신 눌러줄 수 있는 것이 없다.
   *
   * 예전에는 여기에 `처음으로`·`다시 입장하기` 를 두고 `/` 로 보냈다. 그런데 `/` 는
   * **세션이 있으면 그 회차로 옮기는 문**이다. 지워진 회차를 묻고 없다는 답을 들은 사람이
   * 그 버튼을 누르면 **참석 중인 다른 파티 안에 서 있었다** — 게다가 `처음으로` 라는 이름은
   * 자기가 어디로 가는지 말하지 않아서, 옮겨간 줄도 모른다. 실제로 나온 신고다.
   *
   * `/` 의 그 이동은 **주소만 치고 들어온 사람**을 위한 것이라 그 자리에서는 맞다.
   * 여기 오는 사람은 회차 하나를 물은 사람이라, 묻지 않은 회차로 데려가면 안 된다.
   */
  /*
   * **막힌 나라는 예외다** (ADR-92). 위의 "다시 물어도 같은 답" 이 여기서만 틀리다 —
   * VPN 을 끄거나 한국 망으로 옮기면 **같은 요청이 다르게 답한다.** 그래서 버튼을 남긴다.
   * 문구가 `끄고 다시 열어주세요` 라고 말하는데 누를 것이 없으면 그 문장이 헛말이 된다.
   */
  const blockedHere = error.code === "region_blocked";
  const stuck = removed || (sessionGone && !blockedHere);
  /*
   * **망 문제에 `location.reload()` 를 걸면 안 된다.** 앱을 통째로 버리고 `index.html`
   * 부터 다시 받는 일인데, 망이 흔들리는 바로 그 순간에 가장 하면 안 되는 것이다.
   * 실패하면 브라우저의 오류 화면으로 넘어가고 거기서는 우리가 할 수 있는 게 없다.
   * 요청 하나만 다시 보내면 된다 — 성공하면 그 자리에서 화면이 돌아온다.
   */
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        {/*
          설명 없이 온 401 은 세션이 아예 없는 것이다. `화면을 불러오지 못했어요` 로는
          할 일을 알 수 없어서 **문이 어디인지** 말한다 — 버튼을 걷어낸 자리를 이 줄이 맡는다.
        */}
        <p className="dim pre">
          {error.userMessage ?? (removed ? ENTRY.notFound : sessionGone ? ENTRY.linkOnly : FAIL.title)}
        </p>
        {!stuck && (
          <button className="btn primary" disabled={offline && busy} onClick={() => (offline ? onRetry() : location.reload())}>
            {offline ? (busy ? FAIL.reconnecting : FAIL.reconnect) : FAIL.retry}
          </button>
        )}
        {/* 파티장에는 운영자가 눈앞에 있다. 실패를 사람에게 넘길 수 있는 앱은 흔치 않다 */}
        {(offline || broken) && <p className="tiny dim">{FAIL.askHost}</p>}
      </div>
    </div>
  );
}
