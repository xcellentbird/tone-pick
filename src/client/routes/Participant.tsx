import { NavLink, Outlet, useParams } from "react-router";

/** 참가자 메인 레이아웃. 탭 이동은 push 라서 뒤로 가기 = 직전 탭. */
export default function Participant() {
  const { code } = useParams();
  const base = `/e/${code}`;
  return (
    <div className="phone">
      {/* TODO: 상태 셀(단계별 문구) + phase 배너 + seat 배너 */}
      <section className="body">
        <Outlet />
      </section>
      <nav className="tabbar">
        <NavLink to={base} end>👥 참가자</NavLink>
        <NavLink to={`${base}/alerts`}>🔔 알림</NavLink>
        <NavLink to={`${base}/me`}>🙋 내 정보</NavLink>
      </nav>
    </div>
  );
}
