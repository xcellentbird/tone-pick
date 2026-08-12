import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router.tsx";
import EnvBadge from "./ui/EnvBadge.tsx";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 라우터 밖에 둔다 — 어느 화면에 있든 한 번만 뜬다 */}
    <EnvBadge />
    <RouterProvider router={router} />
  </StrictMode>,
);
