/**
 * 뿌리 화면(`/`). **여기서 할 수 있는 일은 없다.**
 *
 * 문은 참가 링크 하나뿐이다 (ADR-13·15). 예전에는 여기서 입장 코드 여섯 자리를 물었는데,
 * 운영자는 보통 링크만 준다 — 참가자가 링크를 열었다 뒤로 가면 **알지도 못하는 코드를
 * 요구받는 막다른 길**이 됐고, 코드를 다시 물으러 운영자에게 돌아가야 했다.
 *
 * 다만 **이미 어느 회차에 들어가 있는 사람은 그리로 보낸다.** 주소만 치고 들어온 사람에게
 * "링크로 오세요" 라고 하는 건, 이미 들어와 있는 사람에게는 거짓말이다.
 *
 * ⚠️ **그래서 실패 화면을 여기로 보내면 안 된다** (ADR-71). 여기 오는 사람은 아무것도 안
 * 물은 사람이라는 게 저 이동의 전제인데, `그런 회차가 없어요` 를 읽고 온 사람은 회차 하나를
 * 물은 사람이다 — 그 사람을 **묻지 않은 회차 안에** 데려다 놓는다. 실제로 나온 신고다.
 *
 * 운영자 진입 버튼도 뺐다. 운영자는 `/host` 를 직접 연다 — 참가자에게 관리 경로를 광고할 이유가 없다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ENTRY, SCREEN_TITLE } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { api } from "../lib/api.ts";

export default function Entry() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    api<ParticipantState>("/me")
      // 뒤로 가기로 이 빈 화면에 되돌아오지 않게 replace 로 넘긴다
      .then((state) => alive && navigate(`/e/${state.event.code}`, { replace: true }))
      .catch(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (checking) return <div className="screen" />;

  return (
    <div className="screen">
      <header>
        <h1 className="grow">{SCREEN_TITLE.entry}</h1>
      </header>
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim">{ENTRY.linkOnly}</p>
        <p className="tiny dim">{ENTRY.linkOnlyNote}</p>
      </div>
    </div>
  );
}
