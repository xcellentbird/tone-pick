/**
 * 설정 탭.
 *
 * **네 묶음으로 접혀 있다** — 기본 정보 · 예약 · 콕 설정 · 삭제. 위쪽 알약 줄에서 고르면
 * 그것만 그려진다. 칸이 스무 개 가까이 되면서 한 두루마리로는 무엇이 어디 있는지 못 찾았다.
 *
 * 앞의 셋은 **회차 만들기의 스텝과 같은 이름·같은 순서**다 (`HOST_UI.steps`). 만들 때 고른 것을
 * 나중에 고치러 오는 자리라, 이름이 다르면 어디를 눌러야 할지 다시 찾는다.
 *
 * ⚠️ **묶음은 라우트가 아니라 화면 상태다.** 이건 여는 것이 아니라 **거르는 것**이라
 * 뒤로 가기로 닫을 것이 없다 (모달·시트와 다르다 — `CLAUDE.md` 5번). 그리고 폼 하나를
 * 나눠 보는 것뿐이라, 어느 묶음에 있든 **입력값은 전부 살아 있고 `적용` 은 한꺼번에 저장한다.**
 *
 * 그래서 **접힌 자리의 변경이 안 보이는 게 유일한 위험**이다. 안 저장된 것이 있는 묶음에는
 * 점을 찍고, 확인창은 묶음과 상관없이 바뀐 것을 전부 보여준다.
 *
 * **콕이 오가기 시작하면 규칙 다섯과 일정이 굳는다** (ADR-35) —
 * 대상 · 되돌리기 둘 · 알림 둘(ADR-43 이 라운드마다 갈랐다). 콕 횟수만 일부러 열려 있다.
 * 잠긴 줄도 지우지 않고 그대로 둔다. 지금 어느 규칙으로 돌아가는 중인지는
 * 파티 도중에 가장 자주 확인하는 값이라, 감추면 확인할 자리가 사라진다.
 * 그 전에는 **지나온 일정 항목만** 잠근다.
 *
 * 예약 값 자체는 지우지 않는다. "예약은 21:00 이었는데 20:45 에 진행했다"를 보여줄 수 있어야 한다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BTN, DELETE_EVENT, HOST_UI, UNIT } from "../../../shared/copy.ts";
import type { EventMeta, EventSchedule } from "../../../shared/types.ts";
import { LIMITS } from "../../../shared/constants.ts";
import { rulesLocked, schedLocked } from "../../../shared/phase.ts";
import { SCHEDULE_STEP_MIN, formatWhen, fromLocalInput, snapSchedule, toLocalInput } from "../../../shared/time.ts";
import { ApiError, del, put } from "../../lib/api.ts";
import { NOTIFY_OPTIONS, TARGET_OPTIONS, TOPVOTE_OPTIONS, Toggle, topVoteWord } from "./HostDefaults.tsx";
import { useOverlay } from "../../ui/Overlays.tsx";
import { Num } from "./HostDefaults.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Settings() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const navigate = useNavigate();
  const meta = state.meta;

  const [name, setName] = useState(meta.name);
  const [place, setPlace] = useState("");
  const [nickHint, setNickHint] = useState("");
  const [maxPre, setMaxPre] = useState(meta.config.maxPre);
  const [maxParty, setMaxParty] = useState(meta.config.maxParty);
  /** 익명 쪽지 (슬라이스 36). 옛 회차는 키가 없고 그게 0 이다 — 값을 채워 넣지 않는다 */
  const [maxNotes, setMaxNotes] = useState(meta.config.maxNotes ?? 0);
  const [allowSameGender, setAllowSameGender] = useState(meta.config.allowSameGender !== false);
  // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
  const [preNotify, setPreNotify] = useState(meta.config.preNotify === true);
  const [pokeNotify, setPokeNotify] = useState(meta.config.pokeNotify === true);
  /** 매력 투표 1위 보너스 콕 (ADR-100). 옛 회차는 키가 없고 그게 '안 줌' 이다 */
  const [topVoteBonus, setTopVoteBonus] = useState(!!meta.config.topVoteBonus);
  const [schedule, setSchedule] = useState<EventSchedule>(meta.schedule);
  const [error, setError] = useState<string | null>(null);
  /** 지금 보고 있는 묶음. 라우트가 아니다 — 여는 게 아니라 거르는 것이라 닫을 것이 없다 */
  const [group, setGroup] = useState<Group>("identity");

  /** 굳었나 (ADR-35). 서버도 같은 판단을 하니, 여기서는 **못 고르게** 하는 것까지만 한다 */
  const frozen = rulesLocked(meta.fired);
  /** 1위 보너스는 **파티가 시작되면** 굳는다 (ADR-100) — 1위가 그때 정해지고, 보너스 콕을 쓴 뒤에 끄면 한도를 넘는다 */
  const topVoteFrozen = !!(meta.fired.party || meta.fired.done);

  useEffect(() => {
    setName(meta.name);
    setMaxPre(meta.config.maxPre);
    setMaxParty(meta.config.maxParty);
    setMaxNotes(meta.config.maxNotes ?? 0);
    setAllowSameGender(meta.config.allowSameGender !== false);
    setPreNotify(meta.config.preNotify === true);
    setPokeNotify(meta.config.pokeNotify === true);
    setTopVoteBonus(!!meta.config.topVoteBonus);
    setPlace(meta.place ?? "");
    setNickHint(meta.nickHint ?? "");
    setSchedule(meta.schedule);
  }, [meta]);

  /**
   * 바뀐 것을 **묶음별로** 모은다.
   *
   * 두 곳이 이걸 쓴다 — 확인창(무엇이 어떻게 바뀌나, `CLAUDE.md` 규칙 4)과
   * 알약 줄의 점(어느 묶음에 안 저장된 것이 있나). **한 곳에서 만든다** —
   * 따로 세면 점은 켜졌는데 확인창은 비어 있는 일이 생긴다.
   *
   * 여기서 저장하면 **참가자 전원의 화면**이 바뀐다 — 콕 횟수도, 일정도.
   */
  function pending(): Record<Group, Array<[string, string]>> {
    const out: Record<Group, Array<[string, string]>> = {
      identity: [],
      schedule: [],
      rules: [],
      // 삭제는 고칠 값이 없다 — 늘 비어 있고, 그래서 점도 안 붙는다
      danger: [],
    };
    const changed = (g: Group, label: string, before: string, after: string) => {
      if (before !== after) out[g].push([label, `${before} → ${after}`]);
    };
    changed("identity", HOST_UI.fields.name, meta.name, name);
    changed("identity", HOST_UI.fields.place, meta.place ?? "—", place || "—");
    changed("identity", HOST_UI.fields.nickHint, meta.nickHint ?? "—", nickHint || "—");
    changed("rules", HOST_UI.fields.maxPre, UNIT.times(meta.config.maxPre), UNIT.times(maxPre));
    changed("rules", HOST_UI.fields.maxParty, UNIT.times(meta.config.maxParty), UNIT.times(maxParty));
    // 단위가 **장**이다 — 콕의 `회` 와 갈라야 확인창에서 두 줄이 다른 것으로 읽힌다
    changed("rules", HOST_UI.fields.maxNotes, UNIT.sheets(meta.config.maxNotes ?? 0), UNIT.sheets(maxNotes));
    changed(
      "rules",
      HOST_UI.fields.pokeTarget,
      meta.config.allowSameGender === false ? HOST_UI.fields.pokeTargetOpposite : HOST_UI.fields.pokeTargetAll,
      allowSameGender ? HOST_UI.fields.pokeTargetAll : HOST_UI.fields.pokeTargetOpposite,
    );
    const notifyWord = (on: boolean) => (on ? HOST_UI.fields.pokeNotifyOn : HOST_UI.fields.pokeNotifyOff);
    changed("rules", HOST_UI.fields.preNotify, notifyWord(meta.config.preNotify === true), notifyWord(preNotify));
    changed("rules", HOST_UI.fields.pokeNotify, notifyWord(meta.config.pokeNotify === true), notifyWord(pokeNotify));
    changed("rules", HOST_UI.fields.topVoteBonus, topVoteWord(!!meta.config.topVoteBonus), topVoteWord(topVoteBonus));
    // 시간 순으로 센다 — 확인창에 뜨는 순서가 화면 순서와 같아야 어디를 고쳤는지 짚인다
    for (const key of SCHED_ORDER) {
      // 파티 시작은 `기본 정보` 묶음에 있다 (ADR-54) — 고쳤다는 점도 거기 붙어야 한다
      const g = key === "partyAt" ? "identity" : "schedule";
      changed(g, HOST_UI.fields[key], formatWhen(meta.schedule[key]) || "—", formatWhen(schedule[key]) || "—");
    }
    return out;
  }

  const dirty = pending();

  function askSave() {
    // **묶음과 상관없이 전부 보여준다.** 접힌 자리에서 고친 것이 확인창에서 빠지면 안 된다
    const facts = GROUPS.flatMap((g) => dirty[g]);

    // 아무것도 안 바꾸고 누른 경우. 빈 확인창을 띄우느니 그렇다고 말한다
    if (facts.length === 0) return toast(HOST_UI.applyNothing);
    /*
     * 익명 쪽지를 **0 으로 내리는 것은 숫자가 아니라 스위치다** (슬라이스 36).
     * `익명 쪽지 · 2장 → 0장` 만으로는 그게 안 보인다 — 규칙 4 가 말하는 *무엇이 어떻게 바뀌나* 가
     * 여기서는 숫자가 아니라서다. 그리고 **이미 간 것은 안 사라진다**를 함께 적어야
     * 운영자가 이 버튼을 *없던 일로 만드는 것* 으로 오해하지 않는다.
     */
    const off = maxNotes === 0 && (meta.config.maxNotes ?? 0) > 0;
    confirm(
      { btn: HOST_UI.applySettings, title: HOST_UI.applyTitle, facts: off ? [...facts, ...HOST_UI.noteOffFacts] : facts },
      save,
    );
  }

  async function save() {
    setError(null);
    try {
      await put<EventMeta>(`/host/events/${meta.id}`, {
        name,
        place,
        nickHint,
        config: { maxPre, maxParty, maxNotes, allowSameGender, preNotify, pokeNotify, topVoteBonus: topVoteBonus ? 1 : 0 },
      });
      await put<EventMeta>(`/host/events/${meta.id}/schedule`, schedule);
      toast(BTN.saved);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? "") : "");
    }
  }

  function askDelete() {
    confirm(
      {
        btn: BTN.delete,
        title: DELETE_EVENT.title,
        danger: true,
        note: DELETE_EVENT.note,
        facts: DELETE_EVENT.facts({
          players: state.players.length,
          votes: state.pokeCount.pre,
          pokes: state.pokeCount.party,
          rounds: state.seatings.filter((s) => s.status === "published").length,
          // 익명 쪽지 (슬라이스 36). 오간 것이 없으면 줄도 안 선다 — 안 쓴 회차에 없는 기능을 적지 않는다
          notes: Object.values(state.noteSent).reduce((a, b) => a + b, 0),
        }),
      },
      async () => {
        await del(`/host/events/${meta.id}`);
        navigate("/host/events", { replace: true });
      },
    );
  }

  /** `적용` 이 저장하는 세 묶음. 삭제에는 저장할 것이 없어서 버튼도 안 그린다 */
  const savable = group !== "danger";
  /** 지금 안 보이는 곳에 안 저장된 것이 있나 — 있으면 그 사실을 버튼 옆에서 말한다 */
  const hiddenDirty = GROUPS.some((g) => g !== group && dirty[g].length > 0);

  return (
    <div className="stack">
      {/*
        **묶음 고르기.** 상단 탭(`현황·참가자·자리·설정`)과 같은 알약 꼴이라 새로 배울 게 없다.
        다만 저건 라우트고 이건 화면 상태다 — 여는 게 아니라 거르는 것이라 닫을 것이 없다.
      */}
      <nav className="segmented" role="tablist" aria-label={HOST_UI.settings.pick}>
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={group === g}
            className={group === g ? "active" : ""}
            onClick={() => setGroup(g)}
          >
            {HOST_UI.settings[g]}
            {/* 접힌 자리의 변경은 눈에 안 보인다. 그래서 그 사실만 점으로 말한다 */}
            {dirty[g].length > 0 && <span className="dot" aria-hidden>{HOST_UI.settings.dirty}</span>}
          </button>
        ))}
      </nav>

      {group === "identity" && (
        <>
          <div className="field">
            <label htmlFor="sname">{HOST_UI.fields.name}</label>
            <input id="sname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {/* 장소는 안내문에만 쓰인다 (ADR-32). 오타가 나기 쉬워 고칠 길을 둔다 */}
          <div className="field">
            <label htmlFor="splace">{HOST_UI.fields.place}</label>
            <input id="splace" value={place} onChange={(e) => setPlace(e.target.value)} />
            <span className="tiny dim">{HOST_UI.fields.placeHint}</span>
          </div>
          {/*
            닉네임 칸의 문구 (ADR-59). **등록이 열린 뒤에도 고칠 수 있다** —
            첫 참가자가 이상하게 적는 걸 보고 바로 고치고 싶어지는 값이다.
            기본값 화면에 적어둔 것이 새 회차로 넘어오고, 여기서 이 회차만 바뀐다.
          */}
          <div className="field">
            <label htmlFor="snick">{HOST_UI.fields.nickHint}</label>
            <input
              id="snick"
              value={nickHint}
              maxLength={LIMITS.nickHintMax}
              onChange={(e) => setNickHint(e.target.value)}
            />
            <span className="tiny dim">{HOST_UI.fields.nickHintEventHint}</span>
          </div>
          {/*
            **파티 시작이 여기 있다** (ADR-54) — 위저드 1스텝과 같은 자리다.
            나머지 일정이 여기서 거꾸로 계산되는 기준점이라 **먼저 정해져야 하는 값**이다.
            ⚠️ 예약이 된 뒤에도(ADR-93) `예약` 묶음으로 옮기지 마라 —
            거기 있으면 자기 자신을 기준으로 계산하는 칸이 되고, 위저드와도 어긋난다.
          */}
          <When
            label={HOST_UI.fields.partyAt}
            value={schedule.partyAt}
            locked={schedLocked(meta.fired, "partyAt")}
            hint={HOST_UI.fields.partyHint}
            onChange={(v) => setSchedule({ ...schedule, partyAt: v })}
          />
          {/* 입장 코드는 만든 뒤에 바꾸지 않는다 (ADR-22) — 이미 나간 안내와 어긋난다 */}
          <div className="field">
            <label>{HOST_UI.fields.code}</label>
            <div className="fact">
              <span className="grow">{meta.code}</span>
            </div>
            <span className="tiny dim">{HOST_UI.codeFixed}</span>
          </div>
        </>
      )}

      {/*
        **예약. 위저드 2스텝과 같은 시간 순이다** — 매력 투표 시작 → 마감 → 커플 발표.
        두 화면이 다른 순서면 고치러 온 사람이 어느 칸인지 다시 찾는다.

        **파티 시작은 여기 없다** (ADR-54). 예약이 되고도(ADR-93) `기본 정보` 묶음에 남는다 —
        위저드 1스텝과 같은 자리라, 옮기면 만들 때와 고칠 때가 어긋난다.

        **등록 시작도 없다** (ADR-93). 회차를 만든 시각이라(ADR-38) 고칠 수도 없고
        운영자가 볼 일도 없었다 — 못 누르는 칸이 맨 위에 서서 나머지를 한 칸씩 밀었다.

        잠긴 줄은 지우지 않는다 — "예약은 21:00 이었는데 20:45 에 진행했다" 를 보여줄 수 있어야 한다.
      */}
      {group === "schedule" && (
        <>
          <When
            label={HOST_UI.fields.prevoteAt}
            value={schedule.prevoteAt}
            locked={schedLocked(meta.fired, "prevoteAt")}
            onChange={(v) => setSchedule({ ...schedule, prevoteAt: v })}
          />
          {/* 매력 투표 마감 줄은 없다 (ADR-100) — 파티가 시작될 때 함께 닫힌다 */}
          {/*
            커플 발표 (ADR-43). **파티가 시작된 뒤에도 열려 있는 유일한 일정이다** —
            파티가 길어지면 미뤄야 하는데 파티 시작에 잠그면 손쓸 방법이 없다.
            발표가 끝나면(`fired.done`) 그때 잠긴다.
          */}
          <When
            label={HOST_UI.fields.revealAt}
            value={schedule.revealAt}
            locked={schedLocked(meta.fired, "revealAt")}
            hint={HOST_UI.fields.revealHint}
            onChange={(v) => setSchedule({ ...schedule, revealAt: v })}
          />
        </>
      )}

      {group === "rules" && (
        <>
          {/*
            이미 그만큼 찌른 사람이 있으면 그 아래로는 내려가지 않는다 —
            내리면 그 사람의 남은 횟수가 음수가 되고, 이미 보낸 콕은 되물릴 수 없다.
            서버도 같은 규칙으로 거절한다. 여기서는 애초에 고를 수 없게 한다
          */}
          <Num
            label={HOST_UI.fields.maxPre}
            value={maxPre}
            min={Math.max(LIMITS.maxPre.min, state.pokeUsedMax.pre)}
            max={LIMITS.maxPre.max}
            onChange={setMaxPre}
          />
          <Num
            label={HOST_UI.fields.maxParty}
            value={maxParty}
            min={Math.max(LIMITS.maxParty.min, state.pokeUsedMax.party)}
            max={LIMITS.maxParty.max}
            onChange={setMaxParty}
          />
          {/*
            대상·되돌리기 둘·알림 둘. **다섯은 콕이 오가기 시작하면 함께 굳는다** (ADR-35) —
            도중에 바뀌면 참가자가 겪는 규칙이 갈린다. 콕 횟수만 위에서 계속 열려 있다.
            순서는 위저드 3스텝과 같다.

            **설명 줄은 없다** (ADR-54 후기 2). 고른 결과가 무엇을 뜻하는지 적어뒀었는데,
            토글 다섯에 설명 셋이 붙어 화면이 글로 덮였다 — 켜고 끄는 자리가 읽는 자리가 됐다.
            ⚠️ 되붙이지 마라. 다만 `locked` 가 쓰는 `frozen` 은 **설명이 아니라 상태**라 남는다 —
            굳은 칸이 왜 안 눌리는지는 말해줘야 한다.
          */}
          <Toggle
            label={HOST_UI.fields.pokeTarget}
            value={allowSameGender}
            options={TARGET_OPTIONS}
            locked={frozen}
            onChange={setAllowSameGender}
          />
          {/* 알림은 라운드마다 따로다 (ADR-43) — 매력 투표가 먼저 */}
          <Toggle
            label={HOST_UI.fields.preNotify}
            value={preNotify}
            options={NOTIFY_OPTIONS}
            locked={frozen}
            onChange={setPreNotify}
          />
          <Toggle
            label={HOST_UI.fields.pokeNotify}
            value={pokeNotify}
            options={NOTIFY_OPTIONS}
            locked={frozen}
            onChange={setPokeNotify}
          />
          {/* 매력 투표 1위 보너스 콕 (ADR-100). 굳는 때가 위 셋과 다르다 — 매력 투표 시작이 아니라 **파티 시작** */}
          <Toggle
            label={HOST_UI.fields.topVoteBonus}
            value={topVoteBonus}
            options={TOPVOTE_OPTIONS}
            locked={topVoteFrozen}
            onChange={setTopVoteBonus}
          />
          {/*
            익명 쪽지는 **묶음의 맨 끝에 혼자 선다** (슬라이스 36). 콕의 다섯은 콕 하나의
            규칙이라 붙어 있어야 하고, 굳는 셋이 한 덩어리로 잠기는 모양도 그대로 남는다 —
            익명 쪽지는 콕이 아니고 **굳지도 않는다** (`locked` 를 주지 않는다).

            ⚠️ **바닥은 1~5 에만 있다. 0 으로는 언제나 내려간다** — 0 이 이 회차의 익명 쪽지를
            닫는 스위치이고, 운영자가 본문도 발신자도 못 보므로 **남은 유일한 레버**다.
            이미 보낸 사람이 있다고 막으면 사고가 났을 때 쓸 수 있는 것이 없어진다.
            그래서 스테퍼는 0 과 `noteUsedMax` 위로만 오갈 수 있게 하고, 그 사이 값은 서버가 거절한다.
          */}
          <Num
            label={HOST_UI.fields.maxNotes}
            value={maxNotes}
            min={LIMITS.maxNotes.min}
            max={LIMITS.maxNotes.max}
            onChange={(v) => setMaxNotes(stepNotes(v, maxNotes, state.noteUsedMax))}
          />
        </>
      )}

      {savable && (
        <>
          {error && <p className="err danger">{error}</p>}
          {/*
            **어느 묶음에서든 같은 버튼이다.** 세 묶음을 한꺼번에 저장한다 —
            나눠 보는 것뿐이지 폼이 셋으로 갈린 게 아니다.
          */}
          <button className="btn primary block" onClick={askSave}>
            {HOST_UI.applySettings}
          </button>
          {/* 접힌 자리에 안 저장된 것이 있으면 그 사실을 여기서 말한다 — 점만으로는 놓친다 */}
          {hiddenDirty && <p className="tiny dim">{HOST_UI.settings.dirtyNote}</p>}
        </>
      )}

      {group === "danger" && (
        <button className="btn danger block" onClick={askDelete}>
          {HOST_UI.deleteEvent}
        </button>
      )}
    </div>
  );
}

/** 묶음 넷. 알약 줄의 **순서**이기도 하다 — 앞의 셋은 회차 만들기의 스텝과 같다 */
const GROUPS = ["identity", "schedule", "rules", "danger"] as const;
type Group = (typeof GROUPS)[number];

/**
 * 예약 칸의 **시간 순.** 화면도 확인창도 이 순서를 쓴다.
 * `regOpenAt` 은 없다 (ADR-93) — 화면에 줄이 없으니 확인창에 뜰 일도 없다.
 */
const SCHED_ORDER = ["prevoteAt", "partyAt", "revealAt"] as const;

/**
 * 익명 쪽지 스테퍼의 다음 값. **0 은 바닥 아래의 한 칸**이다 (슬라이스 36 S-D2).
 *
 * 이미 N장 보낸 사람이 있으면 1~N−1 은 서버가 거절한다 — 화면에서도 서지 않게 건너뛴다.
 * 바닥에서 한 번 더 내리면 **0(이 회차의 익명 쪽지 닫기)** 이고, 0 에서 올리면 바닥으로 돌아온다.
 * 건너뛰지 않으면 운영자가 고를 수 없는 숫자를 고른 뒤 저장에서 거절당한다 —
 * 콕 스테퍼가 `min` 으로 막는 그 일을, 여기서는 **0 을 살려 두면서** 해야 한다.
 */
export function stepNotes(next: number, cur: number, floor: number): number {
  if (next >= floor || next === 0) return next;
  return next < cur ? 0 : floor;
}

function When({
  label,
  value,
  locked,
  hint,
  onChange,
}: {
  label: string;
  value?: number;
  locked: boolean;
  /** 그 시각이 **무엇을 하는 시각인지** 한 줄. 없으면 안 그린다 */
  hint?: string;
  /** 늘 잠긴 줄에는 없다 */
  onChange?: (v: number | undefined) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="datetime-local"
        step={SCHEDULE_STEP_MIN * 60}
        value={toLocalInput(value)}
        disabled={locked}
        // 이미 저장된 값은 건드리지 않는다. 사람이 새로 고른 값만 30분에 맞춘다
        onChange={(e) => {
          const ts = fromLocalInput(e.target.value);
          onChange?.(ts ? snapSchedule(ts) : undefined);
        }}
      />
      {hint && !locked && <span className="tiny dim">{hint}</span>}
      {/* 지나간 예약은 지우지 않는다 — 기록으로 남긴다 */}
      {locked && <span className="tiny dim">{HOST_UI.locked}</span>}
    </div>
  );
}
