/**
 * **익명 쪽지함** (ADR-98 후기 3). 받은 쪽지와 보낸 쪽지가 여기에만 있다.
 *
 * 한동안 받은 쪽지는 홈 `지금까지의 소식` 에 한 줄씩 섰고, 보낸 쪽지는 그 사람의 프로필 시트에 있었다.
 * 운영자가 한곳으로 모았다 — 쪽지는 소식이 아니라 **나에게 온 글**이라 따로 두는 것이 맞고,
 * 상단 바의 ✉️ 가 안 읽은 수를 말한다.
 *
 * 지키는 것은 그대로다 —
 *   · 받은 줄에 누를 수 있는 것은 **지우기 하나**다. 답장·반응·신고가 없다 (ADR-98)
 *   · 가리기 중에는 **본문만 덮고 줄은 남긴다.** 보낸 쪽지는 통째로 감춘다 — 누구에게 보냈는지가 먼저 샌다
 *   · 보낸 쪽지의 읽음 배지는 **이 시트를 연 순간의 값으로 굳는다** (S-B4) — 이 컴포넌트는
 *     시트가 열릴 때 붙고 닫히면 떨어지므로, 붙는 순간 한 번 받아 둔 값이 곧 그 값이다
 *
 * 읽음을 찍는 것은 여기가 아니라 `Participant` 다 — 덮개가 덮고 있는지를 거기서 안다.
 * 그래서 **어느 쪽을 보고 있는지(`seg`)도 거기 있다** — 보낸 쪽지를 보는 동안 새로 온 쪽지는 읽은 것이 아니다.
 */
import { useState } from "react";
import { BTN, NOTE, PEOPLE } from "../../shared/copy.ts";
import type { MyNoteState, PublicPlayer, SentNote } from "../../shared/types.ts";
import { tap } from "../lib/pulse.ts";
import { useOverlay } from "./Overlays.tsx";

/** 쪽지함의 두 쪽 */
export type InboxSeg = "received" | "sent";

export default function NoteBox({
  note,
  roster,
  seg,
  onSeg,
  open,
  covered,
  setCovered,
  onRemove,
  onClose,
}: {
  note: MyNoteState;
  roster: PublicPlayer[];
  /** 지금 보고 있는 쪽. **열면 늘 받은 쪽지부터다** — 여는 쪽(`Participant`)이 되돌려 둔다 */
  seg: InboxSeg;
  onSeg: (seg: InboxSeg) => void;
  /** 지금 쪽지를 보낼 수 있나 (파티 중 · 이 회차에 쪽지가 있다). 남은 장 수와 빈 칸 문구가 갈린다 */
  open: boolean;
  covered: boolean;
  setCovered: (on: boolean) => void;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { confirm } = useOverlay();
  /** 읽음 배지는 이 시트를 연 순간의 값으로 굳는다 (S-B4). 붙을 때 한 번만 받는다 */
  const [frozen] = useState<Record<string, SentNote[]>>(() => note.sent);
  const left = Math.max(0, note.budget.max - note.budget.used);
  /*
   * 명단에 없는 사람(운영자가 내보낸 사람)에게 보낸 것은 세우지 않는다 — 본문이 이미 비었고(S-E1),
   * 이름을 댈 수도 없다. 프로필 시트에 있던 시절에도 그 사람의 시트는 열 수 없었다.
   */
  const sentTo = roster.filter((p) => (frozen[p.id]?.length ?? 0) > 0);

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

      {/* 참가자 탭과 같은 줄이다 — 왼쪽은 안내, 오른쪽은 가리기 (상태는 하나다, `useCovered`) */}
      <div className="noteRow">
        {/* 홈 kicker·확인창과 **같은 이름**이다 — 같은 숫자에 이름이 둘이면 다른 숫자로 읽힌다 */}
        <span className="small dim ellipsis">{open ? NOTE.left(left) : ""}</span>
        <button
          type="button"
          className="coverToggle"
          aria-pressed={covered}
          onClick={() => {
            tap("cover");
            setCovered(!covered);
          }}
        >
          {covered ? PEOPLE.uncover : PEOPLE.cover}
        </button>
      </div>

      {seg === "received" ? (
        note.received.length === 0 ? (
          <p className="small dim center">{NOTE.inbox.empty}</p>
        ) : (
          <div className="stack">
            {note.received.map((n) => (
              <div className="banner" key={n.id}>
                <span className="icon">✉️</span>
                {/*
                  본문은 **`dim` 이 아니다** — 곁설명이 아니라 내용이다.
                  가리면 줄을 지우지 말고 본문만 덮는다 — 가린 사람이 온 줄도 모르면 안 된다.
                */}
                <span className="grow">
                  {covered ? (
                    <span className="small dim">{NOTE.inbox.covered}</span>
                  ) : (
                    <span className="small pre">{n.text}</span>
                  )}
                </span>
                {/*
                  누를 수 있는 것은 지우기 하나다 — 답장도 반응도 신고도 없다 (ADR-98).
                  가린 채로도 지울 수 있다 — 그것이 **안 읽고 지우는 유일한 길**이다.
                */}
                <button
                  type="button"
                  className="anonDel"
                  onClick={() =>
                    confirm(
                      {
                        btn: NOTE.remove,
                        danger: true,
                        title: NOTE.removeConfirm.title,
                        note: NOTE.removeConfirm.note,
                        facts: NOTE.removeConfirm.facts,
                      },
                      async () => {
                        tap("note_remove");
                        await onRemove(n.id);
                      },
                    )
                  }
                >
                  {NOTE.remove}
                </button>
              </div>
            ))}
          </div>
        )
      ) : covered ? (
        /* 보낸 쪽지는 통째로 감춘다 — 본문보다 **누구에게 보냈는지**가 먼저 샌다 */
        <p className="small dim center">{NOTE.inbox.covered}</p>
      ) : sentTo.length === 0 ? (
        <p className="small dim center">{open ? NOTE.inbox.sentEmpty : NOTE.inbox.sentNone}</p>
      ) : (
        <div className="stack">
          {sentTo.map((p) => (
            <div className="stack" key={p.id}>
              <p className="kicker" style={{ margin: 0 }}>
                {NOTE.inbox.to(p.nickname)}
              </p>
              {frozen[p.id].map((n, i) => (
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
