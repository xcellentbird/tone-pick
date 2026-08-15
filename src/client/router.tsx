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
 * 참가자 탭·프로필 시트는 한 컴포넌트가 URL 을 읽어 그린다. 데모 뷰가 같은 컴포넌트를
 * URL 없이 쓰기 때문이다 (ADR-7) — 그래서 자식 라우트로 쪼개지 않는다.
 */
import { createBrowserRouter } from "react-router";

import Entry from "./routes/Entry.tsx";
import Join from "./routes/Join.tsx";
import Register from "./routes/Register.tsx";
import Participant from "./routes/Participant.tsx";
import Demo from "./routes/Demo.tsx";
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

export const router = createBrowserRouter([
  { path: "/", element: plain(<Entry />) },

  // 참가자
  // 참가 링크는 **회차 아이디**를 가리킨다. 입장 코드는 링크에 담지 않는다 (ADR-13)
  { path: "/j/:id", element: plain(<Join />) },
  { path: "/j/:id/register/:step", element: plain(<Register />) },
  { path: "/e/:code", element: <Participant /> },
  { path: "/e/:code/fortune", element: <Participant /> },
  { path: "/e/:code/people", element: <Participant /> },
  // 알림 탭은 홈으로 합쳤다. 폰에 열어둔 옛 주소가 막다른 길이 되지 않게 남겨둔다
  { path: "/e/:code/alerts", element: <Participant /> },
  { path: "/e/:code/me", element: <Participant /> },
  // 프로필 시트도 라우트다 — 뒤로 가기로 닫히게 하기 위해
  { path: "/e/:code/p/:pid", element: <Participant /> },

  // 운영자
  { path: "/host", element: plain(<HostPin />) },
  { path: "/host/events", element: plain(<HostEvents />) },
  { path: "/host/defaults", element: plain(<HostDefaults />) },
  { path: "/host/new/:step", element: plain(<HostWizard />) },
  {
    path: "/host/:id",
    element: <HostConsole />,
    children: [
      { index: true, element: <Dash /> },
      { path: "players", element: <Players /> },
      { path: "players/:pid", element: <Players /> },   // 상세 시트
      { path: "seats", element: <Seats /> },
      // 테이블 수 고르는 시트도 라우트다 — 뒤로 가기로 닫힌다
      { path: "seats/:mode", element: <Seats /> },
      { path: "settings", element: <Settings /> },
    ],
  },

  // 데모 뷰는 폰 3대의 상태를 URL 에 담지 않는다.
  // 운영자 시연용이라 뒤로 가기로 폰 하나의 탭만 되돌아가면 오히려 혼란스럽다.
  { path: "/demo/:id", element: plain(<Demo />) },

  { path: "*", element: plain(<NotFound />) },
]);
