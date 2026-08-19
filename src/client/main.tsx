import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";
import { useKeyboardInset } from "./lib/keyboard.ts";
import EnvBadge from "./ui/EnvBadge.tsx";
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
      <RouterProvider router={router} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
