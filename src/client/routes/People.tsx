/**
 * 참가자 탭.
 *
 * 카드 높이는 고정이다 — 매력이 문장으로 들어와도 카드가 흔들리면 목록이 읽히지 않는다.
 * 전문은 프로필 시트에서 본다.
 *
 * `+` 는 확인을 거치고, `−`(되돌리기)는 즉시 실행한다. 되돌릴 수 있는 행동에
 * 확인을 붙이면 마찰만 늘어난다 (ADR-6).
 */
import { useState } from "react";
import { BTN, PEOPLE, POKE, UNIT } from "../../shared/copy.ts";
import type { ParticipantState, PublicPlayer } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { ApiError } from "../lib/api.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { useOverlay } from "../ui/Overlays.tsx";

interface Props {
  state: ParticipantState;
  source: ParticipantSource;
  reload: () => void;
  profileId?: string;
  onProfile: (playerId: string | null) => void;
}

export default function People({ state, source, reload, profileId, onProfile }: Props) {
  const [onlyOpposite, setOnlyOpposite] = useState(true);
  const { confirm, toast } = useOverlay();

  const round = state.event.phase === "prevote" ? "pre" : "party";
  const budget = state.poke.budget[round];
  const open = canPoke(state.event.phase);
  const list = state.roster.filter((p) => !onlyOpposite || p.gender !== state.me.gender);
  const profile = state.roster.find((p) => p.id === profileId);

  async function send(target: PublicPlayer) {
    const already = state.poke.sentTo[target.id] ?? 0;
    if (!open) return toast(POKE.blocked.closed);
    if (target.gender === state.me.gender) return toast(POKE.blocked.sameGender);
    if (budget.used >= budget.max) return toast(POKE.blocked.noBudget(budget.max));

    // 확인창은 무엇이 어떻게 바뀌는지 숫자로 보여준다
    confirm(
      {
        btn: POKE.confirm.submit,
        title: POKE.confirm.title(already),
        note: POKE.confirm.note,
        facts: [
          [POKE.confirm.rowTarget, POKE.confirm.count(already + 1)],
          [POKE.confirm.rowBudget(round), POKE.confirm.count(budget.max - budget.used - 1)],
        ],
      },
      async () => {
        try {
          const next = await source.poke(target.id);
          const left = next.budget[round].max - next.budget[round].used;
          toast(POKE.sent(target.nickname, next.sentTo[target.id] ?? 1, left));
          reload();
        } catch (e) {
          toast(e instanceof ApiError && e.userMessage ? e.userMessage : POKE.blocked.closed);
        }
      },
    );
  }

  async function undo(target: PublicPlayer) {
    try {
      const next = await source.unpoke(target.id);
      toast(POKE.removed(next.budget[round].max - next.budget[round].used));
      reload();
    } catch (e) {
      toast(e instanceof ApiError && e.userMessage ? e.userMessage : POKE.blocked.closed);
    }
  }

  return (
    <>
      <div className="row between">
        <button
          className="btn ghost"
          aria-pressed={onlyOpposite}
          onClick={() => setOnlyOpposite((v) => !v)}
        >
          {PEOPLE.onlyOpposite}
        </button>
        {open && <span className="small dim">{ME_LEFT(budget.max - budget.used)}</span>}
      </div>

      {list.length === 0 && <p className="dim center">{PEOPLE.empty}</p>}

      <div className="stack">
        {list.map((p) => (
          <div className="row" key={p.id}>
            <button className="person grow" onClick={() => onProfile(p.id)}>
              <span className="avatar">{p.gender === "M" ? "🙋‍♂️" : "🙋‍♀️"}</span>
              <span className="meta">
                <span className="name ellipsis">
                  {p.nickname} · {UNIT.age(p.age)} · {p.mbti}
                </span>
                <span className="charm ellipsis">{p.charms[0]}</span>
              </span>
            </button>
            <PokeControls
              count={state.poke.sentTo[p.id] ?? 0}
              undoable={(state.poke.sentThisRound[p.id] ?? 0) > 0}
              disabled={!open}
              onSend={() => send(p)}
              onUndo={() => undo(p)}
            />
          </div>
        ))}
      </div>

      {profile && (
        <div className="scrim" onClick={() => onProfile(null)} role="presentation">
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="row">
              <span className="avatar">{profile.gender === "M" ? "🙋‍♂️" : "🙋‍♀️"}</span>
              <div className="grow">
                <div className="name">{profile.nickname}</div>
                <div className="small dim">
                  {UNIT.age(profile.age)} · {profile.mbti}
                </div>
              </div>
              <PokeControls
                count={state.poke.sentTo[profile.id] ?? 0}
                undoable={(state.poke.sentThisRound[profile.id] ?? 0) > 0}
                disabled={!open}
                onSend={() => send(profile)}
                onUndo={() => undo(profile)}
              />
            </div>

            <p className="kicker" style={{ marginTop: 16 }}>
              {PEOPLE.charmTitle}
            </p>
            <div className="stack">
              {/* 카드에서는 한 줄로 잘랐던 매력을 여기서는 전문으로 */}
              {profile.charms.map((c, i) => (
                <div className="fact" key={i}>
                  <span className="grow pre">{c}</span>
                </div>
              ))}
            </div>

            <button className="btn block ghost" style={{ marginTop: 16 }} onClick={() => onProfile(null)}>
              {BTN.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * `−` 는 **이번 라운드에 보낸 콕이 있을 때만** 뜬다.
 * 사전 투표에서 보낸 건 파티 라운드에서 되돌릴 수 없다 — 예산이 라운드별로 분리돼 있어서다.
 */
function PokeControls({
  count,
  undoable,
  disabled,
  onSend,
  onUndo,
}: {
  count: number;
  undoable: boolean;
  disabled: boolean;
  onSend: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {count > 0 && (
        <>
          {undoable && !disabled && (
            <button className="pokeBtn" onClick={onUndo} aria-label={POKE.confirm.rowTarget}>
              −
            </button>
          )}
          <span className="pokeCount">{POKE.confirm.count(count)}</span>
        </>
      )}
      <button
        className={`pokeBtn ${count > 0 ? "on" : ""}`}
        disabled={disabled}
        onClick={onSend}
        aria-label={POKE.confirm.submit}
      >
        👉
      </button>
    </div>
  );
}

const ME_LEFT = (left: number) => POKE.confirm.count(left);
