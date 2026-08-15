/**
 * 참가자 탭.
 *
 * 카드 높이는 고정이다 — 매력이 문장으로 들어와도 카드가 흔들리면 목록이 읽히지 않는다.
 * 전문은 프로필 시트에서 본다.
 *
 * 콕은 확인을 거친다 — 예산이 줄고 상대에게 알림이 간다 (ADR-6).
 * 되돌리기는 지금 화면에 두지 않는다. 그래서 확인창이 "되돌릴 수 없다"고 분명히 말한다.
 */
import { useState } from "react";
import { BTN, PEOPLE, POKE, STATUS, UNIT } from "../../shared/copy.ts";
import type { ParticipantState, PublicPlayer } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { ApiError } from "../lib/api.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { useOverlay } from "../ui/Overlays.tsx";
import Sheet from "../ui/Sheet.tsx";

interface Props {
  state: ParticipantState;
  source: ParticipantSource;
  reload: () => void;
  profileId?: string;
  onProfile: (playerId: string | null) => void;
  /** 데모 뷰의 폰 안에 그릴 때 */
  container?: HTMLElement | null;
}

export default function People({ state, source, reload, profileId, onProfile, container }: Props) {
  // 동성에게도 찌를 수 있는 회차라면 처음부터 전체를 보여준다 — 반쪽만 보이면 설정이 무색해진다
  const sameGenderOk = !!state.event.config.allowSameGender;
  const [onlyOpposite, setOnlyOpposite] = useState(!sameGenderOk);
  const { confirm, toast } = useOverlay();

  const round = state.event.phase === "prevote" ? "pre" : "party";
  const budget = state.poke.budget[round];
  const open = canPoke(state.event.phase);
  const list = state.roster.filter((p) => !onlyOpposite || p.gender !== state.me.gender);
  const profile = state.roster.find((p) => p.id === profileId);

  async function send(target: PublicPlayer) {
    const already = state.poke.sentTo[target.id] ?? 0;
    if (!open) return toast(POKE.blocked.closed);
    if (!sameGenderOk && target.gender === state.me.gender) return toast(POKE.blocked.sameGender);
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

  return (
    <>
      <div className="row between">
        <div className="choice grow">
          {[
            { on: true, label: PEOPLE.onlyOpposite },
            { on: false, label: PEOPLE.everyone },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={onlyOpposite === opt.on}
              onClick={() => setOnlyOpposite(opt.on)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {open && <span className="small dim">{STATUS.pokeLeft(budget.max - budget.used)}</span>}
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
            <PokeControls count={state.poke.sentTo[p.id] ?? 0} disabled={!open} onSend={() => send(p)} />
          </div>
        ))}
      </div>

      <Sheet
        open={!!profile}
        onClose={() => onProfile(null)}
        title={profile?.nickname ?? ""}
        titleHidden
        container={container}
      >
        {profile && (
          <>
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
                disabled={!open}
                onSend={() => send(profile)}
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
          </>
        )}
      </Sheet>
    </>
  );
}

/** 보낸 횟수와 찌르기 버튼. 되돌리기는 지금 화면에 없다 */
function PokeControls({
  count,
  disabled,
  onSend,
}: {
  count: number;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {count > 0 && <span className="pokeCount">{POKE.confirm.count(count)}</span>}
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
