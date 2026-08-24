/**
 * 설정 탭.
 *
 * **지나온 일정 항목만 잠근다** — 등록이 시작됐어도 발표 시각은 여전히 수정 가능하다 (ADR-2).
 * 예약 값 자체는 지우지 않는다. "예약은 21:00 이었는데 20:45 에 진행했다"를 보여줄 수 있어야 한다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BTN, DELETE_EVENT, HOST_UI, UNIT } from "../../../shared/copy.ts";
import type { EventMeta, EventSchedule } from "../../../shared/types.ts";
import { LIMITS, RETENTION_DAYS } from "../../../shared/constants.ts";
import { schedLocked } from "../../../shared/phase.ts";
import { SCHEDULE_STEP_MIN, formatWhen, fromLocalInput, snapSchedule, toLocalInput } from "../../../shared/time.ts";
import { ApiError, del, put } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import { Num } from "./HostDefaults.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Settings() {
  const { state, reload } = useConsole();
  const { confirm, toast } = useOverlay();
  const navigate = useNavigate();
  const meta = state.meta;

  const [name, setName] = useState(meta.name);
  const [maxPre, setMaxPre] = useState(meta.config.maxPre);
  const [maxParty, setMaxParty] = useState(meta.config.maxParty);
  const [allowSameGender, setAllowSameGender] = useState(meta.config.allowSameGender !== false);
  const [prevoteNotice, setPrevoteNotice] = useState(meta.config.prevoteNotice !== false);
  const [retentionDays, setRetentionDays] = useState(meta.config.retentionDays ?? RETENTION_DAYS);
  const [schedule, setSchedule] = useState<EventSchedule>(meta.schedule);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(meta.name);
    setMaxPre(meta.config.maxPre);
    setMaxParty(meta.config.maxParty);
    setAllowSameGender(meta.config.allowSameGender !== false);
    setPrevoteNotice(meta.config.prevoteNotice !== false);
    setRetentionDays(meta.config.retentionDays ?? RETENTION_DAYS);
    setSchedule(meta.schedule);
  }, [meta]);

  /**
   * 무엇이 어떻게 바뀌는지 항목으로 보여준다 (CLAUDE.md 규칙 4).
   * 여기서 저장하면 **참가자 전원의 화면**이 바뀐다 — 콕 횟수도, 일정도.
   */
  function askSave() {
    const facts: Array<[string, string]> = [];
    const changed = (label: string, before: string, after: string) => {
      if (before !== after) facts.push([label, `${before} → ${after}`]);
    };
    changed(HOST_UI.fields.name, meta.name, name);
    changed(HOST_UI.fields.maxPre, UNIT.times(meta.config.maxPre), UNIT.times(maxPre));
    changed(HOST_UI.fields.maxParty, UNIT.times(meta.config.maxParty), UNIT.times(maxParty));
    changed(
      HOST_UI.fields.pokeTarget,
      meta.config.allowSameGender === false ? HOST_UI.fields.pokeTargetOpposite : HOST_UI.fields.pokeTargetAll,
      allowSameGender ? HOST_UI.fields.pokeTargetAll : HOST_UI.fields.pokeTargetOpposite,
    );
    changed(
      HOST_UI.fields.prevoteNotice,
      meta.config.prevoteNotice === false ? HOST_UI.fields.prevoteNoticeOff : HOST_UI.fields.prevoteNoticeOn,
      prevoteNotice ? HOST_UI.fields.prevoteNoticeOn : HOST_UI.fields.prevoteNoticeOff,
    );
    changed(
      HOST_UI.settings.privacy,
      UNIT.days(meta.config.retentionDays ?? RETENTION_DAYS),
      UNIT.days(retentionDays),
    );
    for (const key of ["partyAt", "regOpenAt", "prevoteAt"] as const) {
      changed(HOST_UI.fields[key], formatWhen(meta.schedule[key]) || "—", formatWhen(schedule[key]) || "—");
    }

    // 아무것도 안 바꾸고 누른 경우. 빈 확인창을 띄우느니 그렇다고 말한다
    if (facts.length === 0) return toast(HOST_UI.applyNothing);
    confirm({ btn: HOST_UI.applySettings, title: HOST_UI.applyTitle, facts }, save);
  }

  async function save() {
    setError(null);
    try {
      await put<EventMeta>(`/host/events/${meta.id}`, {
        name,
        config: { maxPre, maxParty, allowSameGender, prevoteNotice, retentionDays },
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
          pokes: state.pokeCount.pre + state.pokeCount.party,
          rounds: state.seatings.filter((s) => s.status === "published").length,
        }),
      },
      async () => {
        await del(`/host/events/${meta.id}`);
        navigate("/host/events", { replace: true });
      },
    );
  }

  return (
    <div className="stack">
      <div className="kicker">{HOST_UI.settings.identity}</div>
      <div className="field">
        <label htmlFor="sname">{HOST_UI.fields.name}</label>
        <input id="sname" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {/* 입장 코드는 만든 뒤에 바꾸지 않는다 (ADR-22) — 이미 나간 안내와 어긋난다 */}
      <div className="field">
        <label>{HOST_UI.fields.code}</label>
        <div className="fact">
          <span className="grow">{meta.code}</span>
        </div>
        <span className="tiny dim">{HOST_UI.codeFixed}</span>
      </div>
      <div className="kicker">{HOST_UI.settings.rules}</div>
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

      <div className="field">
        <label>{HOST_UI.fields.pokeTarget}</label>
        <div className="choice">
          {[
            { on: false, label: HOST_UI.fields.pokeTargetOpposite },
            { on: true, label: HOST_UI.fields.pokeTargetAll },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={allowSameGender === opt.on}
              onClick={() => setAllowSameGender(opt.on)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="tiny dim">{HOST_UI.fields.pokeTargetNote}</span>
      </div>

      <div className="kicker">{HOST_UI.settings.schedule}</div>
      {/* 파티 일시는 잠그지 않는다 — 장소가 바뀌면 시각도 바뀐다 */}
      <When
        label={HOST_UI.fields.partyAt}
        value={schedule.partyAt}
        locked={false}
        onChange={(v) => setSchedule({ ...schedule, partyAt: v })}
      />
      <When
        label={HOST_UI.fields.regOpenAt}
        value={schedule.regOpenAt}
        locked={schedLocked(meta.fired, "regOpenAt")}
        onChange={(v) => setSchedule({ ...schedule, regOpenAt: v })}
      />
      <When
        label={HOST_UI.fields.prevoteAt}
        value={schedule.prevoteAt}
        locked={schedLocked(meta.fired, "prevoteAt")}
        onChange={(v) => setSchedule({ ...schedule, prevoteAt: v })}
      />
      {/*
        위저드와 같은 자리 — 언제 여는가 바로 아래다. **이미 열린 뒤에도 잠그지 않는다**:
        소식은 파생이라 (ADR-4) 끄면 그 자리에서 사라지고 켜면 돌아온다.
        일정 칸과 달리 지나간 일을 고치는 게 아니라 지금 보이는 것을 고치는 일이다.
      */}
      <div className="field">
        <label>{HOST_UI.fields.prevoteNotice}</label>
        <div className="choice">
          {[
            { on: false, text: HOST_UI.fields.prevoteNoticeOff },
            { on: true, text: HOST_UI.fields.prevoteNoticeOn },
          ].map((opt) => (
            <button
              key={opt.text}
              type="button"
              aria-pressed={prevoteNotice === opt.on}
              onClick={() => setPrevoteNotice(opt.on)}
            >
              {opt.text}
            </button>
          ))}
        </div>
        <span className="tiny dim">{HOST_UI.fields.prevoteNoticeNote}</span>
      </div>
      {/* 예약이 없는 전환을 여기서 찾지 않도록, 없는 이유를 그 자리에 적어둔다 */}
      <p className="tiny dim">{HOST_UI.fields.manualNote}</p>

      <div className="kicker">{HOST_UI.settings.privacy}</div>
      <Num
        label={HOST_UI.fields.retentionDays}
        value={retentionDays}
        min={LIMITS.retentionDays.min}
        max={LIMITS.retentionDays.max}
        onChange={setRetentionDays}
      />
      <p className="tiny dim">{HOST_UI.retention(retentionDays)}</p>
      {/* 등록 화면의 "N일 뒤에 지워져요"가 이 값을 읽는다 — 참가자가 이미 있으면 줄이는 건 약속 위반이다 */}
      {state.players.length > 0 && <p className="tiny dim">{HOST_UI.fields.retentionNote}</p>}

      {error && <p className="err danger">{error}</p>}
      {/* 누르면 바로 저장되지 않는다. 무엇이 바뀌는지 보고 한 번 더 확인한다 */}
      <button className="btn primary block" onClick={askSave}>
        {HOST_UI.applySettings}
      </button>

      <div className="kicker">{HOST_UI.settings.danger}</div>
      <button className="btn danger block" onClick={askDelete}>
        {HOST_UI.deleteEvent}
      </button>
    </div>
  );
}

function When({
  label,
  value,
  locked,
  onChange,
}: {
  label: string;
  value?: number;
  locked: boolean;
  onChange: (v: number | undefined) => void;
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
          onChange(ts ? snapSchedule(ts) : undefined);
        }}
      />
      {/* 지나간 예약은 지우지 않는다 — 기록으로 남긴다 */}
      {locked && <span className="tiny dim">{HOST_UI.locked}</span>}
    </div>
  );
}
