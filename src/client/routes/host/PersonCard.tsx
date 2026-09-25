/**
 * 운영자 콘솔의 사람 카드 — 실명이 앞이다 (ADR-33). 카드 전체가 손잡이고, 오른쪽에 붙던 참석 칩은 걷어냈다 (ADR-45).
 * 참가자 탭 목록 · 떨어뜨릴 사람 고르기 · 설문에 답한 사람 목록이 **같은 카드**를 쓴다.
 *
 * **받은 콕은 보여주지 않는다** — 알면 그 사람을 다르게 대하게 된다 (ADR-22). MBTI 와 콕 횟수는 상세로 갔다.
 * 둘째 줄의 전화번호는 부르는 쪽이 고른다 — 연락할 목록에만 (운영자 화면이라 된다, 원칙 3).
 */
import { UNIT } from "../../../shared/copy.ts";
import { formatPhone } from "../../../shared/constants.ts";
import type { Player } from "../../../shared/types.ts";
import Avatar from "../../ui/Avatar.tsx";

export default function PersonCard({ p, phone, onOpen }: { p: Player; phone?: boolean; onOpen: () => void }) {
  return (
    <div className="person">
      <button type="button" className="open" onClick={onOpen}>
        <Avatar nickname={p.nickname} gender={p.gender} />
        <span className="meta">
          <span className="name ellipsis">
            {p.realName} · {p.nickname} · {UNIT.age(p.age)}
          </span>
          {phone && <span className="charm ellipsis">{formatPhone(p.phone)}</span>}
        </span>
      </button>
    </div>
  );
}
