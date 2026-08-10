import { NavLink, Outlet, useParams } from "react-router";

export default function HostConsole() {
  const { id } = useParams();
  const base = `/host/${id}`;
  return (
    <div className="console">
      <nav className="tabs">
        <NavLink to={base} end>현황</NavLink>
        <NavLink to={`${base}/players`}>참가자</NavLink>
        <NavLink to={`${base}/seats`}>자리</NavLink>
        <NavLink to={`${base}/settings`}>설정</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
