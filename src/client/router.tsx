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
import { createBrowserRouter } from "react-router";

import Entry from "./routes/Entry.tsx";
import Join from "./routes/Join.tsx";
import Register from "./routes/Register.tsx";
import Participant from "./routes/Participant.tsx";
import NotFound from "./routes/NotFound.tsx";

import HostPin from "./routes/host/HostPin.tsx";
import HostEvents from "./routes/host/HostEvents.tsx";
import HostDefaults from "./routes/host/HostDefaults.tsx";
import HostWizard from "./routes/host/HostWizard.tsx";
import HostConsole from "./routes/host/HostConsole.tsx";
import Dash from "./routes/host/Dash.tsx";
import Players from "./routes/host/Players.tsx";
import Seats from "./routes/host/Seats.tsx";
import Settings from "./routes/host/Settings.tsx";
import { Overlays } from "./ui/Overlays.tsx";

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
  { path: "/e/:code", element: <Participant /> },
  { path: "/e/:code/fun", element: <Participant /> },
  { path: "/e/:code/people", element: <Participant /> },
  { path: "/e/:code/me", element: <Participant /> },
  // 내 정보 편집도 라우트다 — 뒤로 가기가 곧 취소다 (ADR-31)
  { path: "/e/:code/me/edit", element: <Participant /> },
  // 프로필 시트도 라우트다 — 뒤로 가기로 닫히게 하기 위해
  { path: "/e/:code/p/:pid", element: <Participant /> },
  // 자리 확인 화면을 **다시 여는** 길 (슬라이스 12). 자동으로 뜨는 쪽은 주소가 없다
  { path: "/e/:code/seat", element: <Participant /> },
  // 파티 룰 도움말. 시트도 라우트라 **여기 없으면 "찾을 수 없어요" 로 떨어진다**
  { path: "/e/:code/help", element: <Participant /> },
  // 파티 룰 도움말. 시트도 라우트라 **여기 없으면 "찾을 수 없어요" 로 떨어진다**

];

/**
 * 운영자 콘솔의 자식 경로들. **테스트가 이 표를 그대로 쓴다.**
 *
 * 참가자 쪽과 같은 이유다 — 베낀 표는 언젠가 어긋나고, 그때 테스트는
 * 자기 사본으로 통과한다. 실제로 `seats/new/tables` 가 그렇게 빠져
 * 화면이 404 로 떨어졌다.
 */
export const HOST_CONSOLE_ROUTES = [
    { index: true, element: <Dash /> },
    { path: "players", element: <Players /> },
    { path: "players/:pid", element: <Players /> },   // 상세 시트
    { path: "seats", element: <Seats /> },
    // 배정 시트도 라우트다 — 뒤로 가기로 닫힌다.
    // **걸음이 곧 주소다** — 뺄 사람 고르기 → 테이블 수 (ADR-45). push 라 뒤로 가면 앞 걸음이다.
    // 예전에는 `:mode` 로 `new`·`final` 둘을 받았다. 커플 자리를 걷어내며 길이 하나가 됐다 (ADR-51)
    { path: "seats/new", element: <Seats /> },
    { path: "seats/new/tables", element: <Seats /> },
    { path: "settings", element: <Settings /> },
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
  { path: "/host", element: plain(<HostPin />) },
  { path: "/host/events", element: plain(<HostEvents />) },
  { path: "/host/defaults", element: plain(<HostDefaults />) },
  { path: "/host/new/:step", element: plain(<HostWizard />) },
  { path: "/host/:id", element: <HostConsole />, children: HOST_CONSOLE_ROUTES },

  { path: "*", element: plain(<NotFound />) },
]);
