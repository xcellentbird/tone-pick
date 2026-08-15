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
import { BTN, ME, PEOPLE, POKE, REVEAL, SEAT, STATUS, UNIT } from "../../shared/copy.ts";
import type { MatchInfo, ParticipantState, PublicPlayer } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { rosterOpen } from "../../shared/types.ts";
import { ApiError } from "../lib/api.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { useOverlay } from "../ui/Overlays.tsx";
import Avatar from "../ui/Avatar.tsx";
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
  const sameGenderOk = state.event.config.allowSameGender !== false;
  const [onlyOpposite, setOnlyOpposite] = useState(!sameGenderOk);
  const { confirm, toast } = useOverlay();

  const round = state.event.phase === "prevote" ? "pre" : "party";
  const budget = state.poke.budget[round];
  const open = canPoke(state.event.phase);
  const profile = state.roster.find((p) => p.id === profileId);
  /**
   * 발표 후에만 채워진다. 서로 찌른 사람은 **목록에서** 눈에 띄어야 한다 —
   * 결과를 다른 탭에 숨겨두면 파티장에서 그 사람을 앞에 두고 화면을 뒤진다.
   * 발표 전에는 비어 있으므로 목록에 아무 표시도 생기지 않는다.
   */
  const matched = new Map(state.poke.matches.map((m) => [m.player.id, m]));

  /**
   * 발표 후에는 서로 찌른 사람이 **맨 위**로 온다.
   * 스무 명 목록에서 그 사람을 찾아 내려가게 두면, 결과를 다른 탭에 숨긴 것과 다를 게 없다.
   * 발표 전에는 `matched` 가 비어 있어 순서가 그대로다 — 그 자체로 힌트가 되면 안 된다.
   */
  const list = state.roster
    .filter((p) => !onlyOpposite || p.gender !== state.me.gender)
    .slice()
    .sort((a, b) => Number(matched.has(b.id)) - Number(matched.has(a.id)));

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
        {open && <span className="small dim">{STATUS.roundLeft(round, budget.max - budget.used)}</span>}
      </div>

      {list.length === 0 && (
        <p className="dim center pre">{rosterOpen(state.event.phase) ? PEOPLE.empty : PEOPLE.notOpenYet}</p>
      )}

      <div className="stack">
        {list.map((p) => {
          const match = matched.get(p.id);
          return (
            <div className="row" key={p.id}>
              <button className={`person grow ${match ? "matched" : ""}`} onClick={() => onProfile(p.id)}>
                <Avatar nickname={p.nickname} gender={p.gender} />
                <span className="meta">
                  <span className="name">
                    <span className="who">{p.nickname}</span>
                    {/* 나이·MBTI 는 파티가 시작돼야 온다. 그 전에는 자리가 통째로 빈다 (ADR-21) */}
                    {p.age && <span className="age">{p.age}</span>}
                    {p.mbti && <span className="badge">{p.mbti}</span>}
                  </span>
                  {/* 색만으로 말하지 않는다. 매칭이면 매력 대신 그 사실을 적는다 */}
                  {match ? (
                    <span className="charm matchLine ellipsis">
                      {REVEAL.matchBadge}
                      {match.sameTable ? ` · ${SEAT.banner(match.sameTable)}` : ""}
                    </span>
                  ) : (
                    <span className="charms">
                      {p.charms.map((c, i) => (
                        <span className="chip" key={i}>
                          {c}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
              <PokeControls count={state.poke.sentTo[p.id] ?? 0} disabled={!open} onSend={() => send(p)} />
            </div>
          );
        })}
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
            {matched.has(profile.id) && (
              <div className="card stack matchCard">
                <div className="kicker">{REVEAL.matchBadge}</div>
                <span className="small">
                  {matched.get(profile.id)!.sameTable
                    ? REVEAL.hintSameTable(matched.get(profile.id)!.sameTable!)
                    : REVEAL.hintOther}
                </span>

                {/* 연락처는 **서로 찌른 사이에게만** 열린다 (ADR-19) */}
                <div className="kicker">{REVEAL.contactTitle}</div>
                <Contact match={matched.get(profile.id)!} />
                <span className="tiny dim">{REVEAL.contactNote}</span>
              </div>
            )}
            <div className="row">
              <Avatar nickname={profile.nickname} gender={profile.gender} size="lg" />
              <div className="grow">
                <div className="name">{profile.nickname}</div>
                {(profile.age || profile.mbti) && (
                  <div className="small dim">
                    {[profile.age && UNIT.age(profile.age), profile.mbti].filter(Boolean).join(" · ")}
                  </div>
                )}
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

/**
 * 서로 찌른 상대의 연락처.
 *
 * 전화와 인스타는 **누를 수 있게** 둔다 — 파티장에서 번호를 손으로 옮겨 적게 하지 않는다.
 * 이 컴포넌트는 `MatchInfo` 없이는 그려지지 않는다. 그 타입이 곧 "발표 후 서로 찌른 쌍"이다.
 */
function Contact({ match }: { match: MatchInfo }) {
  const { realName, phone, instagram } = match.contact;
  return (
    <div className="stack">
      <div className="row between">
        <span className="small dim">{ME.labels.realName}</span>
        <span>{realName}</span>
      </div>
      <div className="row between">
        <span className="small dim">{ME.labels.phone}</span>
        <a href={`tel:${phone}`}>{phone}</a>
      </div>
      {instagram && (
        <div className="row between">
          <span className="small dim">{ME.labels.instagram}</span>
          <a href={`https://instagram.com/${instagram}`} target="_blank" rel="noreferrer">
            @{instagram}
          </a>
        </div>
      )}
    </div>
  );
}

function PokeControls({
  count,
  disabled,
  onSend,
}: {
  count: number;
  disabled: boolean;
  onSend: () => void;
}) {
  /**
   * 숫자는 버튼 **오른쪽**에 둔다.
   * 왼쪽에 두면 찌른 사람과 안 찌른 사람의 카드 폭이 달라져 목록이 들쭉날쭉해진다.
   * 오른쪽 끝은 어차피 비어 있는 자리고, 자리를 늘 비워두면 폭도 흔들리지 않는다.
   */
  return (
    <div className="pokeCell">
      <button
        className={`pokeBtn ${count > 0 ? "on" : ""}`}
        disabled={disabled}
        onClick={onSend}
        aria-label={POKE.confirm.submit}
      >
        👉
      </button>
      <span className="pokeCount">{count > 0 ? count : ""}</span>
    </div>
  );
}
