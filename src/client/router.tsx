/**
 * 화면 상태를 전부 URL 로 승격시킨다.
 *
 * 프로토타입은 `S.screen` 하나로 화면을 바꿔서 뒤로 가기가 곧 앱 이탈이었다.
 * 모바일에서는 안드로이드 백 버튼과 iOS 가장자리 스와이프까지 같은 동작이므로
 * 여기서 못 잡으면 현장에서 사고가 난다.
 *
 * 규칙 (문서 `기술스택-검토.md` §5)
 *   · 탭 이동, 시트/모달 열기, 위저드 스텝  → push
 *   · 등록 완료 → 메인, PIN 성공 → 콘솔     → replace
 *   · 단계 전환·자리 발송·발표               → URL 변경 없음 (데이터 변경이지 화면 전환이 아니다)
 */
import { createBrowserRouter } from "react-router";

import Entry from "./routes/Entry.tsx";
import Join from "./routes/Join.tsx";
import Register from "./routes/Register.tsx";
import Participant from "./routes/Participant.tsx";
import People from "./routes/People.tsx";
import Alerts from "./routes/Alerts.tsx";
import Me from "./routes/Me.tsx";
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

export const router = createBrowserRouter([
  { path: "/", element: <Entry /> },

  // 참가자
  { path: "/j/:code", element: <Join /> },
  { path: "/j/:code/register/:step", element: <Register /> },
  {
    path: "/e/:code",
    element: <Participant />,
    children: [
      { index: true, element: <People /> },
      // 프로필 시트도 라우트다 — 뒤로 가기로 닫히게 하기 위해
      { path: "p/:nick", element: <People /> },
      { path: "alerts", element: <Alerts /> },
      { path: "me", element: <Me /> },
    ],
  },

  // 운영자
  { path: "/host", element: <HostPin /> },
  { path: "/host/events", element: <HostEvents /> },
  { path: "/host/defaults", element: <HostDefaults /> },
  { path: "/host/new/:step", element: <HostWizard /> },
  {
    path: "/host/:id",
    element: <HostConsole />,
    children: [
      { index: true, element: <Dash /> },
      { path: "players", element: <Players /> },
      { path: "players/:pid", element: <Players /> },   // 상세 시트
      { path: "seats", element: <Seats /> },
      { path: "settings", element: <Settings /> },
    ],
  },

  // 데모 뷰는 폰 3대의 상태를 URL 에 담지 않는다.
  // 운영자 시연용이라 뒤로 가기로 폰 하나의 탭만 되돌아가면 오히려 혼란스럽다.
  { path: "/demo/:id", element: <Demo /> },

  { path: "*", element: <NotFound /> },
]);
