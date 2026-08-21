import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";
import { useKeyboardInset } from "./lib/keyboard.ts";
import EnvBadge from "./ui/EnvBadge.tsx";
import Boom from "./ui/Boom.tsx";
import "./styles/theme.css";

/**
 * 키보드가 가린 높이는 **화면마다가 아니라 앱 전체에** 한 번만 재면 된다.
 * 시트 안에 두면 시트가 열릴 때마다 붙였다 떼게 되고, 그 사이에 키보드가 이미 올라와 있으면
 * 첫 프레임이 가려진 채로 그려진다.
 */
function App() {
  useKeyboardInset();
  return (
    <>
      {/* 라우터 밖에 둔다 — 어느 화면에 있든 한 번만 뜬다 */}
      <EnvBadge />
      {/*
        경계도 라우터 **바깥**이다. 라우팅 자체가 터진 경우까지 덮어야 하고,
        여기서 막지 못하면 React 가 트리를 통째로 걷어내 하얀 화면이 된다.
      */}
      <Boom>
        <RouterProvider router={router} />
      </Boom>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
