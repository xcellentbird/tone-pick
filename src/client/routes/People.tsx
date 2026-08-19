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
import type { MatchInfo, ParticipantState, Phase, Player, PublicPlayer } from "../../shared/types.ts";
import { canPoke } from "../../shared/phase.ts";
import { rosterOpen, toPublic } from "../../shared/types.ts";
import { ApiError } from "../lib/api.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { useOverlay } from "../ui/Overlays.tsx";
import Avatar from "../ui/Avatar.tsx";
import Mbti from "../ui/Mbti.tsx";
import Sheet from "../ui/Sheet.tsx";

interface Props {
  state: ParticipantState;
  source: ParticipantSource;
  reload: () => void;
  profileId?: string;
  onProfile: (playerId: string | null) => void;
}

export default function People({ state, source, reload, profileId, onProfile }: Props) {
  // 동성에게도 찌를 수 있는 회차라면 처음부터 전체를 보여준다 — 반쪽만 보이면 설정이 무색해진다
  const sameGenderOk = state.event.config.allowSameGender !== false;
  const [onlyOpposite, setOnlyOpposite] = useState(!sameGenderOk);
  const { confirm, toast } = useOverlay();

  const round = state.event.phase === "prevote" ? "pre" : "party";
  const budget = state.poke.budget[round];
  const open = canPoke(state.event.phase);
  /** 나이·MBTI 가 아직 안 열린 단계인가. `toPublic()` 이 여는 시점과 같아야 한다 (ADR-21) */
  const agesHidden = state.event.phase !== "party" && state.event.phase !== "done";
  /**
   * **아직 안 열린 것과 끝난 것은 다르다.**
   * 등록 중에는 잠긴 버튼이 "곧 열린다" 를 말해주지만, 발표가 끝난 뒤에는 그 말이 거짓이다 —
   * 눌러봐야 "지금은 찌를 수 있는 시간이 아니에요" 뿐이라 아예 그리지 않는다.
   */
  const revealed = state.event.phase === "done";
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
          [POKE.confirm.rowTarget, UNIT.times(already + 1)],
          [POKE.confirm.rowBudget(round), UNIT.times(budget.max - budget.used - 1)],
        ],
      },
      async () => {
        try {
          await source.poke(target.id);
          toast(POKE.sent(target.nickname));
          reload();
        } catch (e) {
          toast(e instanceof ApiError && e.userMessage ? e.userMessage : POKE.blocked.closed);
        }
      },
    );
  }

  return (
    <>
      {/* 필터는 **전체 폭**을 쓴다. 옆에 글자를 붙이면 알약 컨테이너와 맨 글자가 한 줄에서
          서로 다른 층위로 읽히고, 늘어난 필터와 오른쪽 글자 사이에 빈 공간이 남는다 */}
      <div className="choice">
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

      {/*
        내 카드는 **필터 위**에 있지 않고 목록 맨 위에 있다 — 다른 카드와 같은 자리, 같은 모양이라야
        "남들에게 이렇게 보인다"가 성립한다. 다만 `이성만 보기`에는 걸리지 않는다:
        필터를 바꿨는데 내가 깜빡 사라지면 버그로 읽힌다.
      */}
      <MyCard me={state.me} phase={state.event.phase} />

      {/* 이 문구는 **남들에 대한 말**이다. 내 카드가 생겼다고 지우지 않는다 */}
      {list.length === 0 && (
        <p className="dim center pre">{rosterOpen(state.event.phase) ? PEOPLE.empty : PEOPLE.notOpenYet}</p>
      )}

      {/*
        목록 머리 한 줄 — 왼쪽은 **아래 사람들에 대한 안내**, 오른쪽은 **남은 콕**.
        남은 콕은 👉 버튼이 소비하는 예산이라 필터가 아니라 이 목록에 붙는다.
        오른쪽 정렬이 성립하는 건 왼쪽에 짝이 있기 때문이다 — 짝 없이 오른쪽에만 두면
        왼쪽에 빈 공간이 남아 떠 보인다 (그게 필터 옆에 있을 때의 문제였다).
        볼 사람이 없으면 줄 자체가 없다.
      */}
      {list.length > 0 && (
        <div className="row between">
          <span className="small dim">{agesHidden ? PEOPLE.agesAtParty : ""}</span>
          {open && <span className="small dim">{STATUS.roundLeft(budget.max - budget.used)}</span>}
        </div>
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
                    {p.mbti && <Mbti value={p.mbti} />}
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
              {!revealed && (
                <PokeControls count={state.poke.sentTo[p.id] ?? 0} disabled={!open} onSend={() => send(p)} />
              )}
            </div>
          );
        })}
      </div>

      <Sheet
        open={!!profile}
        onClose={() => onProfile(null)}
        title={profile?.nickname ?? ""}
        titleHidden
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
                <Contact match={matched.get(profile.id)!} />
                <span className="tiny dim">{REVEAL.contactNote}</span>
              </div>
            )}
            <div className="row">
              <Avatar nickname={profile.nickname} gender={profile.gender} size="lg" />
              <div className="grow">
                <div className="name">{profile.nickname}</div>
                {(profile.age || profile.mbti) && (
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    {profile.age && <span className="small dim">{UNIT.age(profile.age)}</span>}
                    {profile.mbti && <Mbti value={profile.mbti} />}
                  </div>
                )}
              </div>
              {!revealed && (
                <PokeControls
                  count={state.poke.sentTo[profile.id] ?? 0}
                  disabled={!open}
                  onSend={() => send(profile)}
                />
              )}
            </div>

            <p className="kicker" style={{ margin: 0 }}>
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

            <button className="btn block ghost" onClick={() => onProfile(null)}>
              {BTN.close}
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

/**
 * 목록 맨 위의 내 카드. 답하는 건 **"내가 남들에게 어떻게 보이나"** 하나다.
 *
 * `toPublic()` 을 **그대로** 쓴다. 화면에서 규칙을 다시 짜면 두 곳이 갈라지는데,
 * 하필 "이렇게 보여요" 라고 말하는 자리라 갈라지는 순간 거짓말이 된다.
 * 서버 응답은 하나도 바뀌지 않는다 — 이미 받은 `me` 를 같은 함수로 줄여 그릴 뿐이다.
 *
 * **단계를 그대로 넘기지 않는다.** `toPublic` 은 `prevote` 에서만 나이·MBTI 를 뺀다.
 * 등록 중에 그대로 부르면 나이가 나오는데 정작 사전 투표에서는 안 보인다 —
 * 그래서 **남들이 나를 처음 보게 되는 상태**로 바꿔서 부른다.
 *
 * 누를 수 없다. 매력 전문과 내가 낸 것 전부는 내 정보 탭에 있고,
 * 프로필 시트는 `roster` 에서 상대를 찾는데 거기 나는 없다.
 */
function MyCard({ me, phase }: { me: Player; phase: Phase }) {
  const seenAs: Phase = phase === "party" || phase === "done" ? phase : "prevote";
  const shown = toPublic(me, seenAs);
  return (
    <div className="person">
      <Avatar nickname={shown.nickname} gender={shown.gender} />
      <span className="meta">
        <span className="name">
          <span className="who">{shown.nickname}</span>
          <span className="mineTag">{PEOPLE.mine}</span>
          {shown.age && <span className="age">{shown.age}</span>}
          {shown.mbti && <Mbti value={shown.mbti} />}
        </span>
        <span className="charms">
          {shown.charms.map((c, i) => (
            <span className="chip" key={i}>
              {c}
            </span>
          ))}
        </span>
      </span>
    </div>
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
      {/* 이름은 신원이지 연락 수단이 아니다 — '연락처' 라벨 밖에 둔다 */}
      <div className="row between">
        <span className="small dim">{ME.labels.realName}</span>
        <span>{realName}</span>
      </div>
      <div className="kicker">{REVEAL.contactTitle}</div>
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
