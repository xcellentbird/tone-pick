import { useNavigate } from "react-router";
import { BTN, SCREEN_TITLE } from "../../shared/copy.ts";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <h1>{SCREEN_TITLE.notFound}</h1>
        <button className="btn primary" onClick={() => navigate("/")}>
          {BTN.home}
        </button>
      </div>
    </div>
  );
}
