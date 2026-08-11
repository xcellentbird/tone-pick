/**
 * 회차 기본 설정 (공통 PIN 전용).
 *
 * 되돌리기는 **콕 횟수와 일정 오프셋만** 되돌린다. 공통 PIN 과 이미 만든 회차는 그대로다 —
 * 확인창에서 그 사실을 숫자와 함께 보여준다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BTN, HOST, HOST_UI, SCREEN_TITLE, UNIT } from "../../../shared/copy.ts";
import type { Defaults } from "../../../shared/types.ts";
import { DEFAULTS, LIMITS } from "../../../shared/constants.ts";
import { ApiError, api, post, put } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { useOverlay } from "../../ui/Overlays.tsx";

export default function HostDefaults() {
  const navigate = useNavigate();
  const loaded = useLoad(() => api<Defaults>("/host/defaults"));
  useAuthRedirect(loaded.error);
  const { confirm, toast } = useOverlay();

  const [form, setForm] = useState<Defaults | null>(null);
  const [masterPin, setMasterPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(loaded.data), [loaded.data]);

  if (!form) return <div className="screen" />;

  const set = <K extends keyof Defaults,>(key: K, value: Defaults[K]) => {
    setForm({ ...form, [key]: value });
    setError(null);
  };

  async function save() {
    try {
      const next = await put<Defaults>("/host/defaults", { ...form, masterPin: masterPin || undefined });
      loaded.set(next);
      setMasterPin("");
      toast(BTN.saved);
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? HOST.pin.usedByEvent) : HOST.pin.usedByEvent);
    }
  }

  function askReset() {
    confirm(
      {
        btn: HOST.defaults.resetTitle,
        title: HOST.defaults.resetTitle,
        note: HOST.defaults.resetNote,
        facts: [
          [HOST_UI.fields.maxPre, `${UNIT.times(form!.maxPre)} → ${UNIT.times(DEFAULTS.maxPre)}`],
          [HOST_UI.fields.maxParty, `${UNIT.times(form!.maxParty)} → ${UNIT.times(DEFAULTS.maxParty)}`],
          [HOST_UI.fields.regOpenAt, `${form!.regOpenAfterH}h → ${DEFAULTS.regOpenAfterH}h`],
          [HOST_UI.fields.voteCloseAt, `${form!.voteWindowH}h → ${DEFAULTS.voteWindowH}h`],
        ],
      },
      async () => {
        const next = await post<Defaults>("/host/defaults/reset");
        loaded.set(next);
        setForm(next);
      },
    );
  }

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => navigate(-1)}>
          {BTN.back}
        </button>
        <h1 className="grow">{SCREEN_TITLE.hostDefaults}</h1>
      </header>

      <div className="body stack">
        <Num
          label={HOST_UI.fields.maxPre}
          value={form.maxPre}
          min={LIMITS.maxPre.min}
          max={LIMITS.maxPre.max}
          onChange={(v) => set("maxPre", v)}
        />
        <Num
          label={HOST_UI.fields.maxParty}
          value={form.maxParty}
          min={LIMITS.maxParty.min}
          max={LIMITS.maxParty.max}
          onChange={(v) => set("maxParty", v)}
        />
        <Num
          label={HOST_UI.fields.regOpenAfterH}
          value={form.regOpenAfterH}
          min={0}
          max={720}
          onChange={(v) => set("regOpenAfterH", v)}
        />
        <Num
          label={HOST_UI.fields.voteWindowH}
          value={form.voteWindowH}
          min={1}
          max={720}
          onChange={(v) => set("voteWindowH", v)}
        />

        <div className="field">
          <label htmlFor="master">{HOST_UI.fields.masterPin}</label>
          <input
            id="master"
            value={masterPin}
            inputMode="numeric"
            type="password"
            autoComplete="off"
            onChange={(e) => setMasterPin(e.target.value.replace(/[^0-9]/g, ""))}
          />
          {error && <span className="err">{error}</span>}
        </div>

        <button className="btn primary block" onClick={save}>
          {BTN.save}
        </button>
        <button className="btn ghost block" onClick={askReset}>
          {HOST.defaults.resetTitle}
        </button>
      </div>
    </div>
  );
}

export function Num({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <button className="btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
          −
        </button>
        <span className="grow center">{value}</span>
        <button className="btn" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  );
}
