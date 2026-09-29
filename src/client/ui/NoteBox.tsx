/**
 * **익명 쪽지함** (ADR-98 후기 3). 받은 쪽지와 보낸 쪽지가 여기에만 있다.
 *
 * 한동안 받은 쪽지는 홈 `지금까지의 소식` 에 한 줄씩 섰고, 보낸 쪽지는 그 사람의 프로필 시트에 있었다.
 * 운영자가 한곳으로 모았다 — 쪽지는 소식이 아니라 **나에게 온 글**이라 따로 두는 것이 맞고,
 * 상단 바의 ✉️ 가 안 읽은 수를 말한다.
 *
 * 지키는 것은 그대로다 —
 *   · 받은 줄에는 **누를 것이 없다.** 답장·반응·신고가 없다 (ADR-98). 지우기와 가리기도 걷었다 (ADR-119) —
 *     쪽지함을 열어 받은 쪽지를 보면 그것이 곧 읽은 것이다
 *   · **실시간이다** (ADR-118 · 120). 열어 둔 채로 새 쪽지가 뜨고, 보낸 쪽지의 읽음 배지는 상대가 읽는 순간 바뀐다.
 *     한동안 배지를 시트를 연 순간의 값으로 굳혔다(S-B4) — 운영자가 실시간을 골라 걷었다. **다시 굳히지 마라**
 *   · **여기서는 쓰지 않는다** (ADR-98 후기 3 · ADR-126). 쓰는 입구는 프로필 시트의 ✉️ 하나이고, 쪽지함은 그리로 가는
 *     길만 한 줄로 말한다. 남은 장 수도 없다 — 쓸 길 없이 숫자만 서 있었다. 홈 카드와 보내기 확인창이 말한다
 *
 * 읽음을 찍는 것은 여기가 아니라 `Participant` 다 — 쪽지함이 열려 있는지를 거기서 안다.
 * 그래서 **어느 쪽을 보고 있는지(`seg`)도 거기 있다** — 보낸 쪽지를 보는 동안 새로 온 쪽지는 읽은 것이 아니다.
 */
import { BTN, NOTE } from "../../shared/copy.ts";
import type { MyNoteState, PublicPlayer } from "../../shared/types.ts";

/** 쪽지함의 두 쪽 */
export type InboxSeg = "received" | "sent";

export default function NoteBox({
  note,
  roster,
  seg,
  onSeg,
  open,
  onClose,
}: {
  note: MyNoteState;
  roster: PublicPlayer[];
  /** 지금 보고 있는 쪽. **열면 늘 받은 쪽지부터다** — 여는 쪽(`Participant`)이 되돌려 둔다 */
  seg: InboxSeg;
  onSeg: (seg: InboxSeg) => void;
  /** 지금 쪽지를 보낼 수 있나 (매력 투표 · 파티, 그리고 이 회차에 쪽지가 있다). 쓰는 곳 안내와 빈 칸 문구가 갈린다 */
  open: boolean;
  onClose: () => void;
}) {
  const sent = note.sent;
  const left = Math.max(0, note.budget.max - note.budget.used);
  /*
   * 명단에 없는 사람(운영자가 내보낸 사람)에게 보낸 것은 세우지 않는다 — 본문이 이미 비었고(S-E1),
   * 이름을 댈 수도 없다. 프로필 시트에 있던 시절에도 그 사람의 시트는 열 수 없었다.
   */
  const sentTo = roster.filter((p) => (sent[p.id]?.length ?? 0) > 0);
  /*
   * 쓰는 곳을 알려주는 한 줄 (ADR-126). **쓸 수 있고 보낸 쪽지가 비어 있을 때만** 선다 — 한 장 보낸 사람은 이미 길을 안다.
   * 두 쪽 모두 같은 자리(머리)다. 쪽지를 쓰려고 상단 바 ✉️ 부터 누른 사람은 열면 먼저 보이는 받은 쪽지에서 길을 찾는다 —
   * 한동안 `보낸 쪽지` 의 빈 칸에만 있어서 한 번 더 눌러 봐야 보였다.
   */
  const howTo = open && left > 0 && sentTo.length === 0;

  return (
    <div className="stack inbox">
      <div className="choice">
        {(
          [
            ["received", NOTE.inbox.received],
            ["sent", NOTE.inbox.sent],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={seg === key} onClick={() => onSeg(key)}>
            {label}
          </button>
        ))}
      </div>

      {/*
        남은 장 수(`익명 쪽지 N장 남음`)는 **여기 두지 않는다** (ADR-126, 운영자). 쓰는 곳이 없는 화면의 예산은
        어디서 쓰냐는 물음만 남기고, 다 쓰면 `0장` 을 들이댄다(copy.ts 규칙 3). 그 자리에 가는 길을 둔다.
      */}
      {howTo && <div className="small dim">{NOTE.inbox.howTo}</div>}

      {seg === "received" ? (
        note.received.length === 0 ? (
          <p className="small dim center">{NOTE.inbox.empty}</p>
        ) : (
          <div className="stack">
            {note.received.map((n) => (
              <div className="banner" key={n.id}>
                <span className="icon">✉️</span>
                {/* 본문은 **`dim` 이 아니다** — 곁설명이 아니라 내용이다 */}
                <span className="grow small pre">{n.text}</span>
              </div>
            ))}
          </div>
        )
      ) : sentTo.length === 0 ? (
        // 머리에 가는 길이 서 있으면 같은 말을 두 번 하지 않는다 (ADR-113)
        !howTo && <p className="small dim center">{NOTE.inbox.sentNone}</p>
      ) : (
        <div className="stack">
          {sentTo.map((p) => (
            <div className="stack" key={p.id}>
              <p className="kicker" style={{ margin: 0 }}>
                {NOTE.inbox.to(p.nickname)}
              </p>
              {sent[p.id].map((n, i) => (
                <div className="fact anonSent" key={i}>
                  <span className="grow pre">{n.text}</span>
                  {/* 둘 다 같은 흐린 글씨다 — 색으로 좋고 나쁨을 말하지 않는다. 시각도 없다 */}
                  <span className="readBadge">{n.read ? NOTE.read : NOTE.unread}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 읽기를 마친 손가락이 그 자리에서 닫는다 — 도움말·프로필 시트와 같다. 닫기도 뒤로 가기다 */}
      <div className="sheetFoot stack">
        <button className="btn block ghost" onClick={onClose}>
          {BTN.close}
        </button>
      </div>
    </div>
  );
}
