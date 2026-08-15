/**
 * 설정 탭.
 *
 * **지나온 일정 항목만 잠근다** — 등록이 시작됐어도 발표 시각은 여전히 수정 가능하다 (ADR-2).
 * 예약 값 자체는 지우지 않는다. "예약은 21:00 이었는데 20:45 에 진행했다"를 보여줄 수 있어야 한다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BTN, DELETE_EVENT, HOST_UI } from "../../../shared/copy.ts";
import type { EventMeta, EventSchedule } from "../../../shared/types.ts";
import { LIMITS, RETENTION_DAYS } from "../../../shared/constants.ts";
import { schedLocked } from "../../../shared/phase.ts";
import { SCHEDULE_STEP_MIN, fromLocalInput, snapSchedule, toLocalInput } from "../../../shared/time.ts";
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
  const [code, setCode] = useState(meta.code);
  const [maxPre, setMaxPre] = useState(meta.config.maxPre);
  const [maxParty, setMaxParty] = useState(meta.config.maxParty);
  const [allowSameGender, setAllowSameGender] = useState(meta.config.allowSameGender !== false);
  const [schedule, setSchedule] = useState<EventSchedule>(meta.schedule);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(meta.name);
    setCode(meta.code);
    setMaxPre(meta.config.maxPre);
    setMaxParty(meta.config.maxParty);
    setAllowSameGender(meta.config.allowSameGender !== false);
    setSchedule(meta.schedule);
  }, [meta]);

  async function save() {
    setError(null);
    try {
      await put<EventMeta>(`/host/events/${meta.id}`, {
        name,
        code: code !== meta.code ? code : undefined,
        config: { maxPre, maxParty, allowSameGender },
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
      <div className="field">
        <label htmlFor="scode">{HOST_UI.fields.code}</label>
        <input
          id="scode"
          value={code}
          maxLength={6}
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      <div className="kicker">{HOST_UI.settings.rules}</div>
      <Num
        label={HOST_UI.fields.maxPre}
        value={maxPre}
        min={LIMITS.maxPre.min}
        max={LIMITS.maxPre.max}
        onChange={setMaxPre}
      />
      <Num
        label={HOST_UI.fields.maxParty}
        value={maxParty}
        min={LIMITS.maxParty.min}
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
      {/* 예약이 없는 전환을 여기서 찾지 않도록, 없는 이유를 그 자리에 적어둔다 */}
      <p className="tiny dim">{HOST_UI.fields.manualNote}</p>

      {error && <p className="err danger">{error}</p>}
      <button className="btn primary block" onClick={save}>
        {BTN.save}
      </button>

      <p className="tiny dim">{HOST_UI.retention(RETENTION_DAYS)}</p>

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
