/**
 * 참가자 탭.
 *
 * 카드 높이는 고정이다 — 매력이 문장으로 들어와도 카드가 흔들리면 목록이 읽히지 않는다.
 * 전문은 프로필 시트에서 본다.
 *
 * 콕은 확인을 거친다 — 예산이 줄고 상대에게 알림이 간다 (ADR-6).
 * 되돌리기는 지금 화면에 두지 않는다. 그래서 확인창이 "되돌릴 수 없다"고 분명히 말한다.
 */
import { useRef, useState } from "react";
import { ACT, BTN, ME, PEOPLE, POKE, REVEAL, SEAT, UNIT } from "../../shared/copy.ts";
import type { MatchInfo, MyPokeState, ParticipantState, Phase, Player, PokeRound, PublicPlayer } from "../../shared/types.ts";
import type { Tab } from "./Participant.tsx";
import { canPoke } from "../../shared/phase.ts";
import { afterPoke } from "../../shared/poke.ts";
import { useCovered } from "../lib/covered.ts";
import { rosterOpen, toPublic } from "../../shared/types.ts";
import { ApiError } from "../lib/api.ts";
import { now } from "../lib/serverTime.ts";
import type { ParticipantSource } from "../lib/participant.ts";
import { useOverlay } from "../ui/Overlays.tsx";
import Avatar from "../ui/Avatar.tsx";
import Mbti from "../ui/Mbti.tsx";
import Sheet from "../ui/Sheet.tsx";

interface Props {
  state: ParticipantState;
  source: ParticipantSource;
  reload: () => void;
  /** 내 콕 한 칸만 갈아끼운다. 서버를 기다리지 않고 화면을 먼저 바꾸는 통로다 */
  setPoke: (poke: MyPokeState) => void;
  profileId?: string;
  onProfile: (playerId: string | null) => void;
  onTab: (tab: Tab) => void;
}

export default function People({ state, source, reload, setPoke, profileId, onProfile, onTab }: Props) {
  // 동성에게도 찌를 수 있는 회차라면 처음부터 전체를 보여준다 — 반쪽만 보이면 설정이 무색해진다
  const sameGenderOk = state.event.config.allowSameGender !== false;
  const [onlyOpposite, setOnlyOpposite] = useState(!sameGenderOk);
  const { confirm, toast } = useOverlay();

  const round = state.event.phase === "prevote" ? "pre" : "party";
  const budget = state.poke.budget[round];
  /*
   * 매력 투표는 **시각으로** 닫힌다 (ADR-37). 서버 시각으로 재고, 폰 시계는 쓰지 않는다.
   * 닫히는 순간 화면이 저절로 바뀌지는 않는다 — 그때 누르면 서버가 같은 이유로 거절하고
   * `POKE.blocked` 가 뜬다. 1초마다 다시 그리는 것보다 그 편이 조용하다.
   */
  const open = canPoke(state.event.phase, now(), state.event.schedule);
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

  /*
   * 보내는 중에는 다시 안 보낸다. 예전에는 **왕복이 우연히 막고 있었다** —
   * 느려서가 아니라 버튼이 안 바뀌어서 누를 마음이 안 들었을 뿐이다.
   * 즉시 바뀌게 만들면 그 우연이 사라진다.
   */
  const sending = useRef(false);
  const [covered, setCovered] = useCovered();

  /** 되돌릴 수 있나 (ADR-34). **라운드마다 따로** 정한다. 없으면 무를 수 있다 */
  const canUndo =
    round === "pre"
      ? state.event.config.allowUndoPre !== false
      : state.event.config.allowUndo !== false;

  /** 되돌리기. **확인창을 붙이지 않는다** — 되돌리는 것 자체가 되돌리기다 */
  async function undo(target: PublicPlayer) {
    if (sending.current) return;
    sending.current = true;
    const before = state.poke;
    try {
      setPoke(await source.unpoke(target.id));
      toast(POKE.undo.done(target.nickname));
    } catch (e) {
      setPoke(before);
      toast(e instanceof ApiError && e.userMessage ? e.userMessage : closedWhy);
    } finally {
      sending.current = false;
    }
  }

  /**
   * 왜 못 찌르나. **마감돼서 닫힌 것과 아직 안 열린 것은 다르다** (ADR-37) —
   * "시간이 아니에요" 는 *곧 열린다* 로 읽히는데, 매력 투표 마감 뒤에는 그게 거짓말이다.
   */
  const voteEnded = !open && state.event.phase === "prevote" && !!state.event.schedule.voteEndAt;
  const closedWhy = voteEnded ? POKE.blocked.voteEnded : POKE.blocked.closed(round);

  async function send(target: PublicPlayer) {
    const already = state.poke.sentTo[target.id] ?? 0;
    if (!open) return toast(closedWhy);
    if (!sameGenderOk && target.gender === state.me.gender) return toast(POKE.blocked.sameGender);
    if (budget.used >= budget.max) return toast(POKE.blocked.noBudget(round, budget.max));

    // 확인창은 무엇이 어떻게 바뀌는지 숫자로 보여준다
    confirm(
      {
        btn: POKE.confirm.submit(round),
        title: POKE.confirm.title(round, already),
        note: POKE.confirm.note(round, canUndo),
        facts: [
          [POKE.confirm.rowTarget(round), UNIT.times(already + 1)],
          [POKE.confirm.rowBudget(round), UNIT.times(budget.max - budget.used - 1)],
        ],
        // 이미 보낸 적이 있고 되돌릴 수 있을 때만. 창이 숫자를 이미 보여주고 있다
        ...(already > 0 && canUndo ? { second: { label: POKE.undo.btn, run: () => undo(target) } } : {}),
      },
      async () => {
        /*
         * **누른 즉시 바뀐다** (슬라이스 17). 예전에는 왕복을 두 번 —
         * 보내고, 화면 전체를 다시 읽고 — 기다린 뒤에야 버튼이 바뀌었다.
         * 그동안 화면이 아무 말도 안 해서 **사람이 다시 눌렀다.**
         * 콕 상한이 있는 앱에서 그건 가벼운 문제가 아니다.
         *
         * 서버 답이 오면 그 값으로 덮어쓴다 — **서버가 항상 이긴다.**
         * 다른 기기에서 이미 찔렀거나 운영자가 상한을 바꿨을 수 있다.
         * 그래서 `reload()` 가 통째로 없어졌다. 서버가 방금 준 답을 버리고
         * 다시 묻고 있던 것뿐이었다.
         */
        if (sending.current) return;
        sending.current = true;
        const before = state.poke;
        setPoke(afterPoke(before, target.id, round));
        try {
          setPoke(await source.poke(target.id));
          toast(POKE.sent(round, target.nickname));
        } catch (e) {
          // 되돌리지 않으면 **쓰지도 않은 콕이 쓴 것으로 보인다**
          setPoke(before);
          toast(e instanceof ApiError && e.userMessage ? e.userMessage : closedWhy);
        } finally {
          sending.current = false;
        }
      },
    );
  }

  return (
    <>
      {/*
        내 카드는 **필터 위**에 있다. 한동안 목록 맨 줄에 뒀었는데 — 같은 모양이라야
        "남들에게 이렇게 보인다" 가 성립한다고 봤다 — 필터가 다스리지 않는 것이
        필터와 목록 **사이**에 끼어 있는 모양이었다. `이성만` 을 눌러도 내가 남아 있으니
        필터가 안 먹은 것으로 읽힌다. 거르는 버튼은 **걸러지는 것 바로 위**에 있어야 한다.

        옮겨도 "이렇게 보인다" 는 그대로다 — 같은 카드, 같은 `toPublic()` 결과다.
        잃은 건 목록과 붙어 있음 하나인데, 그 붙어 있음이 오해를 만들고 있었다.

        덤으로 하나 더 고쳐진다: 오른쪽 `남은 콕` 이 남들 줄의 👉 와 같은 세로줄에 나란히 있으면
        **눌리지 않는 내 콕 버튼**으로 읽힌다. 사이에 필터 줄이 들어가면 그 오해가 사라진다.
      */}
      <div className="row">
        <MyCard me={state.me} phase={state.event.phase} onOpen={() => onTab("me")} />
        {/* 폭은 남들 줄의 👉 칸과 같다. 그래야 카드 오른쪽 끝이 아래와 맞는다 */}
        {open && (
          <div className="mineCell">
            <span className="n">{UNIT.times(budget.max - budget.used)}</span>
            <span className="t">{PEOPLE.pokeLeftLabel(round)}</span>
          </div>
        )}
      </div>
      {/*
        **마감되면 남은 횟수 칸이 사라진다** — 그 자리가 그냥 비면 앱이 고장 난 것으로 읽힌다.
        버튼도 잠기는데 잠긴 버튼은 눌러도 아무 말이 없어서, 이유를 말할 자리가 여기뿐이다 (ADR-37).
      */}
      {voteEnded && <p className="tiny dim center">{POKE.blocked.voteEndedLine}</p>}

      {/*
        필터는 **전체 폭**을 쓴다. 옆에 글자를 붙이면 알약 컨테이너와 맨 글자가 한 줄에서
        서로 다른 층위로 읽히고, 늘어난 필터와 오른쪽 글자 사이에 빈 공간이 남는다.

        **기본값이 왼쪽이다** — `전체` 가 기본이라(ADR-17) 켜져 있는 쪽이 먼저 읽혀야 한다.

        **인원 수는 여기 없다.** 이 버튼이 답하는 건 "누구를 볼까" 하나이고,
        "몇 명 모였나" 는 홈 탭이 맡는다 (`HOME` 의 `함께하는 사람`).

        거를 것이 아예 없으면 그리지 않는다. 다만 판단은 **거르기 전 명단**으로 한다 —
        `이성만` 이 0명이라고 버튼을 감추면 `전체` 로 돌아갈 길이 사라진다.
      */}
      {state.roster.length > 0 && (
        <div className="choice">
          {[
            { on: false, label: PEOPLE.everyone },
            { on: true, label: PEOPLE.onlyOpposite },
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
      )}

      {/* 이 문구는 **남들에 대한 말**이다. 내 카드가 생겼다고 지우지 않는다 */}
      {list.length === 0 && (
        <p className="dim center pre">{rosterOpen(state.event.phase) ? PEOPLE.empty : PEOPLE.notOpenYet}</p>
      )}

      {/*
        아래 사람들에 대한 안내. 남은 콕은 **내 카드 오른쪽 칸**으로 옮겼다 —
        콕을 쓰는 세로줄에 얼마나 남았는지가 함께 있는 게 맞다.
        볼 사람이 없으면 이 줄도 없다.
      */}
      {/*
        **이 줄은 단계와 무관하게 남는다** (슬라이스 16). 예전에는 안내문이 있을 때만 그렸는데,
        그러면 파티가 시작되는 순간 줄이 통째로 사라지면서 가리기 버튼도 함께 없어졌다 —
        **어깨너머가 가장 위험한 때가 정확히 그때다.** 다들 한 테이블에 앉아 있다.
        이제 안내문은 이 줄의 왼쪽 칸일 뿐이고, 비어 있어도 줄은 남는다.
      */}
      {list.length > 0 && (
        <div className="noteRow">
          <span className="small dim ellipsis">{agesHidden ? PEOPLE.agesAtParty : ""}</span>
          <button
            type="button"
            className="coverToggle"
            aria-pressed={covered}
            onClick={() => setCovered(!covered)}
          >
            {covered ? PEOPLE.uncover : PEOPLE.cover}
          </button>
        </div>
      )}

      <div className="stack">
        {list.map((p) => {
          /*
           * 가린 동안은 매칭 표시도 덮는다. 두 사람에게는 공개된 사이지만
           * **옆 사람에게는 아니다.**
           *
           * 다만 **정렬 순서는 그대로 둔다.** 순서까지 되돌리면 토글할 때마다 목록이
           * 통째로 재배열되는데, 그 움직임이 옆 사람 눈을 끄는 게 순서가 흘리는 것보다 크다.
           */
          const match = covered ? undefined : matched.get(p.id);
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
                <PokeControls
                  count={state.poke.sentTo[p.id] ?? 0}
                  disabled={!open}
                  covered={covered}
                  onSend={() => send(p)}
                  round={round}
                />
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
                  round={round}
                  disabled={!open}
                  covered={covered}
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
 * **누르면 내 정보 탭으로 간다.** 남들 카드는 눌러서 프로필 시트를 여는데,
 * 여기서 같은 시트를 열 수는 없다 — 시트는 `roster` 에서 상대를 찾고 거기 나는 없다.
 * 그렇다고 혼자 못 누르는 카드로 두면, 이 줄에서 더 보고 싶은 것(매력 전문·내가 낸 것 전부)이
 * 어디 있는지 알 길이 없다. 그게 이미 **내 정보 탭**에 있으니 거기로 보낸다.
 *
 * 탭 이동은 `onTab` 이 맡는다 — push/replace 규칙이 거기 한 곳에 있다 (`docs/ROUTES.md`).
 * 여기서 `navigate` 를 직접 부르면 그 규칙이 두 곳으로 갈라진다.
 */
function MyCard({ me, phase, onOpen }: { me: Player; phase: Phase; onOpen: () => void }) {
  const seenAs: Phase = phase === "party" || phase === "done" ? phase : "prevote";
  const shown = toPublic(me, seenAs);
  return (
    <button type="button" className="person grow" onClick={onOpen}>
      {/* "나" 는 아바타 위에 얹는다. 이름 줄은 닉네임·나이·MBTI 로 이미 꽉 차 있다 */}
      <span className="avatarMine">
        <Avatar nickname={shown.nickname} gender={shown.gender} />
        <span className="mineTag">{PEOPLE.mine}</span>
      </span>
      <span className="meta">
        <span className="name">
          <span className="who">{shown.nickname}</span>
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
      {/*
        화살표 같은 표시는 붙이지 않는다 — 이 줄에만 붙으면 남들 카드보다 더 눌러도 되는 것처럼
        보인다. 둘 다 눌리는 카드다. 다만 **어디로 가는지는 글자로** 말해야 해서,
        보이지 않는 한 줄로 목적지를 남긴다.
      */}
      <span className="srOnly">{PEOPLE.mineOpen}</span>
    </button>
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
  covered,
  round,
  onSend,
}: {
  count: number;
  disabled: boolean;
  /** 라운드가 이름과 이모지를 정한다 (ADR-34) */
  round: PokeRound;
  /** 어깨너머 가리기 (슬라이스 16) */
  covered?: boolean;
  onSend: () => void;
}) {
  /*
   * **찌른 버튼과 안 찌른 버튼이 구별되지 않아야 한다.** 이 슬라이스의 유일한 불변식이다.
   *
   * 그래서 `count` 를 받기 전에 통째로 갈라져 나간다 — 아래에서 클래스만 지우는 식이면
   * 언젠가 누가 조건을 하나 더 붙이고 그 틈으로 다시 샌다.
   * 여기서는 **셀 수 있는 것이 애초에 안 들어온다.**
   *
   * 멀리서 새는 건 숫자가 아니라 `.on` 의 분홍→보라 그라데이션이다. 그것부터 없앤다.
   * 누를 수는 없다 — 남이 보는 중에 👉 를 누르면 *지금* 찌르는 상대가 실시간으로 샌다.
   */
  if (covered) {
    return (
      <div className="pokeCell">
        <button className="pokeBtn covered" disabled aria-label={PEOPLE.coveredPoke}>
          <span aria-hidden>🙈</span>
        </button>
      </div>
    );
  }
  /**
   * 카드와 **같은 키, 같은 모서리**다. 44px 알약이던 시절에는 74px 카드 옆에서
   * 혼자 작고 동그래서 짝이 안 맞았다 — 지금은 한 줄이 두 덩어리로 읽힌다.
   *
   * 찌른 횟수는 **버튼 안**에 있다. 밖에 두면 폭이 흔들리지 않게 자리를 늘 비워둬야 했는데,
   * 안에 넣으면 그 문제가 없어지고 숫자가 무엇에 대한 것인지도 붙어서 읽힌다.
   */
  return (
    <div className="pokeCell">
      {/*
        **버튼은 하나뿐이다.** 되돌리기를 옆에 두면 한 줄에 둘이 되어 카드가 화면 밖으로 밀린다 —
        그리고 가린 동안 그 버튼이 보이면 "이 사람을 골랐다" 가 그대로 샌다.
        되돌리기는 **확인창 안**으로 갔다 (ADR-34).
      */}
      <button
        className={`pokeBtn ${count > 0 ? "on" : ""}`}
        disabled={disabled}
        onClick={onSend}
        aria-label={POKE.confirm.submit(round)}
      >
        <span aria-hidden>{ACT.emoji(round)}</span>
        {count > 0 && <span className="n">{count}</span>}
      </button>
    </div>
  );
}
