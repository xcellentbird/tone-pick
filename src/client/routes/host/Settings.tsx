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
 * **콕이 오가기 시작하면 규칙 넷과 일정이 굳는다** (ADR-35) — 대상·되돌리기 둘·알림·일정 셋.
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
import { NOTIFY_OPTIONS, TARGET_OPTIONS, Toggle, UNDO_OPTIONS } from "./HostDefaults.tsx";
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
  const [maxPre, setMaxPre] = useState(meta.config.maxPre);
  const [maxParty, setMaxParty] = useState(meta.config.maxParty);
  const [allowSameGender, setAllowSameGender] = useState(meta.config.allowSameGender !== false);
  // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
  const [allowUndo, setAllowUndo] = useState(meta.config.allowUndo !== false);
  const [allowUndoPre, setAllowUndoPre] = useState(meta.config.allowUndoPre !== false);
  const [preNotify, setPreNotify] = useState(meta.config.preNotify === true);
  const [pokeNotify, setPokeNotify] = useState(meta.config.pokeNotify === true);
  const [schedule, setSchedule] = useState<EventSchedule>(meta.schedule);
  const [error, setError] = useState<string | null>(null);
  /** 지금 보고 있는 묶음. 라우트가 아니다 — 여는 게 아니라 거르는 것이라 닫을 것이 없다 */
  const [group, setGroup] = useState<Group>("identity");

  /** 굳었나 (ADR-35). 서버도 같은 판단을 하니, 여기서는 **못 고르게** 하는 것까지만 한다 */
  const frozen = rulesLocked(meta.fired);

  useEffect(() => {
    setName(meta.name);
    setMaxPre(meta.config.maxPre);
    setMaxParty(meta.config.maxParty);
    setAllowSameGender(meta.config.allowSameGender !== false);
    setAllowUndo(meta.config.allowUndo !== false);
    setAllowUndoPre(meta.config.allowUndoPre !== false);
    setPreNotify(meta.config.preNotify === true);
    setPokeNotify(meta.config.pokeNotify === true);
    setPlace(meta.place ?? "");
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
    changed("rules", HOST_UI.fields.maxPre, UNIT.times(meta.config.maxPre), UNIT.times(maxPre));
    changed("rules", HOST_UI.fields.maxParty, UNIT.times(meta.config.maxParty), UNIT.times(maxParty));
    changed(
      "rules",
      HOST_UI.fields.pokeTarget,
      meta.config.allowSameGender === false ? HOST_UI.fields.pokeTargetOpposite : HOST_UI.fields.pokeTargetAll,
      allowSameGender ? HOST_UI.fields.pokeTargetAll : HOST_UI.fields.pokeTargetOpposite,
    );
    const undoWord = (on: boolean) => (on ? HOST_UI.fields.undoOn : HOST_UI.fields.undoOff);
    const notifyWord = (on: boolean) => (on ? HOST_UI.fields.pokeNotifyOn : HOST_UI.fields.pokeNotifyOff);
    changed("rules", HOST_UI.fields.undoPre, undoWord(meta.config.allowUndoPre !== false), undoWord(allowUndoPre));
    changed("rules", HOST_UI.fields.undoParty, undoWord(meta.config.allowUndo !== false), undoWord(allowUndo));
    changed("rules", HOST_UI.fields.preNotify, notifyWord(meta.config.preNotify === true), notifyWord(preNotify));
    changed("rules", HOST_UI.fields.pokeNotify, notifyWord(meta.config.pokeNotify === true), notifyWord(pokeNotify));
    // 시간 순으로 센다 — 확인창에 뜨는 순서가 화면 순서와 같아야 어디를 고쳤는지 짚인다
    for (const key of SCHED_ORDER) {
      changed("schedule", HOST_UI.fields[key], formatWhen(meta.schedule[key]) || "—", formatWhen(schedule[key]) || "—");
    }
    return out;
  }

  const dirty = pending();

  function askSave() {
    // **묶음과 상관없이 전부 보여준다.** 접힌 자리에서 고친 것이 확인창에서 빠지면 안 된다
    const facts = GROUPS.flatMap((g) => dirty[g]);

    // 아무것도 안 바꾸고 누른 경우. 빈 확인창을 띄우느니 그렇다고 말한다
    if (facts.length === 0) return toast(HOST_UI.applyNothing);
    confirm({ btn: HOST_UI.applySettings, title: HOST_UI.applyTitle, facts }, save);
  }

  async function save() {
    setError(null);
    try {
      await put<EventMeta>(`/host/events/${meta.id}`, {
        name,
        place,
        config: { maxPre, maxParty, allowSameGender, allowUndo, allowUndoPre, preNotify, pokeNotify },
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
        **예약. 위저드 2스텝과 같은 시간 순이다** — 등록 시작 → 매력 투표 시작 → 마감 →
        파티 시작 → 커플 발표. 두 화면이 다른 순서면 고치러 온 사람이 어느 칸인지 다시 찾는다.
        (위저드에 없는 `등록 시작` 만 맨 앞에 더 있다. 이미 지나간 기록이라 늘 잠겨 있다.)

        잠긴 줄도 지우지 않는다 — "예약은 21:00 이었는데 20:45 에 진행했다" 를 보여줄 수 있어야 한다.
      */}
      {group === "schedule" && (
        <>
          {/*
            등록 시작은 **회차를 만든 시각**이라 늘 잠겨 있다 (ADR-38) —
            고칠 길이 없으니 고치는 손잡이도 두지 않는다. 줄은 기록으로 남긴다.
          */}
          <When label={HOST_UI.fields.regOpenAt} value={schedule.regOpenAt} locked />
          <When
            label={HOST_UI.fields.prevoteAt}
            value={schedule.prevoteAt}
            locked={schedLocked(meta.fired, "prevoteAt")}
            onChange={(v) => setSchedule({ ...schedule, prevoteAt: v })}
          />
          {/*
            매력 투표 마감 (ADR-39). **파티가 시작될 때까지 열려 있다** — 파티가 늦어지면
            마감도 미뤄야 하기 때문이다. 그래서 일정 잠금을 규칙 잠금에서 갈랐다.
          */}
          <When
            label={HOST_UI.fields.voteEndAt}
            value={schedule.voteEndAt}
            locked={schedLocked(meta.fired, "voteEndAt")}
            hint={HOST_UI.fields.voteEndHint}
            onChange={(v) => setSchedule({ ...schedule, voteEndAt: v })}
          />
          {/* 파티 시작만 예약이 아니다 (ADR-14). 그 사실을 **그 칸에서** 말한다 */}
          <When
            label={HOST_UI.fields.partyAt}
            value={schedule.partyAt}
            locked={schedLocked(meta.fired, "partyAt")}
            hint={HOST_UI.fields.partyHint}
            onChange={(v) => setSchedule({ ...schedule, partyAt: v })}
          />
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
          */}
          <Toggle
            label={HOST_UI.fields.pokeTarget}
            value={allowSameGender}
            options={TARGET_OPTIONS}
            note={HOST_UI.fields.pokeTargetNote}
            locked={frozen}
            onChange={setAllowSameGender}
          />
          <Toggle
            label={HOST_UI.fields.undoPre}
            value={allowUndoPre}
            options={UNDO_OPTIONS}
            locked={frozen}
            onChange={setAllowUndoPre}
          />
          <Toggle
            label={HOST_UI.fields.undoParty}
            value={allowUndo}
            options={UNDO_OPTIONS}
            locked={frozen}
            onChange={setAllowUndo}
          />
          {/* 알림도 라운드마다 따로다 (ADR-43). 되돌리기와 같은 순서 — 매력 투표가 먼저 */}
          <Toggle
            label={HOST_UI.fields.preNotify}
            value={preNotify}
            options={NOTIFY_OPTIONS}
            note={HOST_UI.fields.preNotifyNote}
            locked={frozen}
            onChange={setPreNotify}
          />
          <Toggle
            label={HOST_UI.fields.pokeNotify}
            value={pokeNotify}
            options={NOTIFY_OPTIONS}
            note={HOST_UI.fields.pokeNotifyNote}
            locked={frozen}
            onChange={setPokeNotify}
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

/** 예약 칸의 **시간 순.** 화면도 확인창도 이 순서를 쓴다 */
const SCHED_ORDER = ["regOpenAt", "prevoteAt", "voteEndAt", "partyAt", "revealAt"] as const;

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
