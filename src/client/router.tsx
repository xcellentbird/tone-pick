/**
 * 화면 상태를 전부 URL 로 승격시킨다.
 *
 * 프로토타입은 `S.screen` 하나로 화면을 바꿔서 뒤로 가기가 곧 앱 이탈이었다.
 * 모바일에서는 안드로이드 백 버튼과 iOS 가장자리 스와이프까지 같은 동작이므로
 * 여기서 못 잡으면 현장에서 사고가 난다.
 *
 * 규칙 (docs/ROUTES.md)
 *   · 탭 이동, 시트/모달 열기, 위저드 스텝  → push
 *   · 등록 완료 → 메인, PIN 성공 → 콘솔     → replace
 *   · 단계 전환·자리 발송·발표               → URL 변경 없음 (데이터 변경이지 화면 전환이 아니다)
 *
 * 참가자 탭·프로필 시트는 **한 컴포넌트가 URL 을 읽어** 그린다 — 자식 라우트로 쪼개지 않는다.
 * 탭을 옮겨도 상태(연 시트·읽던 자리)가 한 곳에 남아 화면이 튀지 않는다.
 */
import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router";

import Entry from "./routes/Entry.tsx";
import Join from "./routes/Join.tsx";
import Register from "./routes/Register.tsx";

/*
 * **참가자 앱도 따로 내려받는다** — `Home`·`People`·`Me`·`재미` 를 통째로 끌고 온다.
 *
 * 링크를 눌러 들어오는 사람은 `Join` → `Register` 만 지나므로 이 넷은 등록을 마칠 때까지
 * 쓰이지 않는다. 대신 **등록 폼을 채우는 동안 미리 받아둔다** (`prefetchParticipant`) —
 * 사람이 세 스텝을 채우는 십수 초면 청크 하나는 충분히 온다.
 *
 * ⚠️ **`Join`·`Register` 는 나누지 마라.** 링크를 누른 그 순간 필요한 화면이라,
 *    나누면 없애려던 기다림이 그 자리로 옮겨갈 뿐이다.
 */
const loadParticipant = () => import("./routes/Participant.tsx");
const Participant = lazy(loadParticipant);

/** 등록 화면이 부른다 — 폼을 채우는 동안 다음 화면을 미리 받아둔다 */
export const prefetchParticipant = () => void loadParticipant().catch(() => {});
import NotFound from "./routes/NotFound.tsx";

/*
 * **운영자 콘솔은 따로 내려받는다.**
 *
 * 참가자는 이 아홉 화면(2791줄)을 **한 번도 열지 않는데** 링크를 눌렀을 때 함께 받고 있었다.
 * 4G 에서 재보니 번들 내려받기가 1040ms 로 첫 화면 시간의 74% 였고, 회차 조회는 그게
 * 끝난 뒤에야 나갔다.
 *
 * ⚠️ **참가자 화면(`Join`·`Register`·`Participant`)은 나누지 마라.** 링크를 누른 사람이
 *    곧바로 지나는 길이라, 나누면 그 자리에서 청크를 한 번 더 기다린다 — 지금 없애려는 게
 *    바로 그 기다림이다.
 */
const HostPin = lazy(() => import("./routes/host/HostPin.tsx"));
const HostEvents = lazy(() => import("./routes/host/HostEvents.tsx"));
const HostDefaults = lazy(() => import("./routes/host/HostDefaults.tsx"));
const HostWizard = lazy(() => import("./routes/host/HostWizard.tsx"));
const HostConsole = lazy(() => import("./routes/host/HostConsole.tsx"));
const Dash = lazy(() => import("./routes/host/Dash.tsx"));
const Players = lazy(() => import("./routes/host/Players.tsx"));
const Seats = lazy(() => import("./routes/host/Seats.tsx"));
const Settings = lazy(() => import("./routes/host/Settings.tsx"));
import { Overlays } from "./ui/Overlays.tsx";

/**
 * 청크를 기다리는 동안의 자리.
 *
 * **빈 `.screen` 이다** — 스피너를 두지 않는다. 운영자 콘솔은 같은 기기에서 반복해 열고
 * 두 번째부터는 캐시라 거의 즉시인데, 그때마다 스피너가 번쩍이면 오히려 느려 보인다.
 * (`Join` 이 회차를 기다릴 때 쓰는 것과 같은 모양이다.)
 */
const chunk = (element: React.ReactElement) => (
  <Suspense fallback={<div className="screen" />}>{element}</Suspense>
);

/** 확인창·토스트가 필요한 화면은 각자 감싼다. 여기서는 단순한 화면만 감싸준다 */
const plain = (element: React.ReactElement) => <Overlays>{element}</Overlays>;

/**
 * 참가자 화면의 경로들. **테스트가 이 표를 그대로 쓴다.**
 *
 * 예전에는 테스트가 "실제 라우터와 같은 모양으로" 베껴 갖고 있었는데,
 * 그러면 여기 새 경로를 넣는 걸 잊어도 테스트는 자기 사본으로 통과한다 —
 * 실제로 `/help` 가 그렇게 빠져서 참가자에게 "찾을 수 없어요" 가 떴다.
 * 베낀 표는 언젠가 반드시 어긋난다.
 */
export const PARTICIPANT_ROUTES = [
  { path: "/e/:code", element: chunk(<Participant />) },
  { path: "/e/:code/fun", element: chunk(<Participant />) },
  { path: "/e/:code/people", element: chunk(<Participant />) },
  { path: "/e/:code/me", element: chunk(<Participant />) },
  // 내 정보 편집도 라우트다 — 뒤로 가기가 곧 취소다 (ADR-31)
  { path: "/e/:code/me/edit", element: chunk(<Participant />) },
  // 프로필 시트도 라우트다 — 뒤로 가기로 닫히게 하기 위해
  { path: "/e/:code/p/:pid", element: chunk(<Participant />) },
  // 자리 확인 화면을 **다시 여는** 길 (슬라이스 12). 자동으로 뜨는 쪽은 주소가 없다
  { path: "/e/:code/seat", element: chunk(<Participant />) },
  // 파티 룰 도움말. 시트도 라우트라 **여기 없으면 "찾을 수 없어요" 로 떨어진다**
  { path: "/e/:code/help", element: chunk(<Participant />) },
];

/**
 * 운영자 콘솔의 자식 경로들. **테스트가 이 표를 그대로 쓴다.**
 *
 * 참가자 쪽과 같은 이유다 — 베낀 표는 언젠가 어긋나고, 그때 테스트는
 * 자기 사본으로 통과한다. 실제로 `seats/new/tables` 가 그렇게 빠져
 * 화면이 404 로 떨어졌다.
 */
export const HOST_CONSOLE_ROUTES = [
    { index: true, element: chunk(<Dash />) },
    { path: "players", element: chunk(<Players />) },
    { path: "players/:pid", element: chunk(<Players />) },   // 상세 시트
    { path: "seats", element: chunk(<Seats />) },
    // 배정 시트도 라우트다 — 뒤로 가기로 닫힌다.
    // **걸음이 곧 주소다** — 뺄 사람 고르기 → 테이블 수 (ADR-45). push 라 뒤로 가면 앞 걸음이다.
    // 예전에는 `:mode` 로 `new`·`final` 둘을 받았다. 커플 자리를 걷어내며 길이 하나가 됐다 (ADR-51)
    { path: "seats/new", element: chunk(<Seats />) },
    { path: "seats/new/tables", element: chunk(<Seats />) },
    { path: "settings", element: chunk(<Settings />) },
];

export const router = createBrowserRouter([
  { path: "/", element: plain(<Entry />) },

  // 참가자
  /*
   * 참가 링크는 **회차 아이디 + 그 사람의 토큰**이다 (ADR-32). 입장 코드는 담지 않는다 (ADR-13).
   * **토큰 없는 `/j/:id` 를 되살리지 마라** — 번호를 아는 사람이 그 사람이 되던 구멍이 그것이었다.
   */
  { path: "/j/:id/:token", element: plain(<Join />) },
  { path: "/j/:id/:token/register/:step", element: plain(<Register />) },
  ...PARTICIPANT_ROUTES,

  // 운영자
  { path: "/host", element: plain(chunk(<HostPin />)) },
  { path: "/host/events", element: plain(chunk(<HostEvents />)) },
  { path: "/host/defaults", element: plain(chunk(<HostDefaults />)) },
  { path: "/host/new/:step", element: plain(chunk(<HostWizard />)) },
  { path: "/host/:id", element: chunk(<HostConsole />), children: HOST_CONSOLE_ROUTES },

  { path: "*", element: plain(<NotFound />) },
]);
