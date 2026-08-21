/**
 * 회차 기본 설정. 새 회차를 만들 때 위저드가 채워 넣는 값이다.
 *
 * 일정 기본값은 **파티 일시에서 거꾸로** 잰다 — 운영자가 실제로 아는 건 "언제 모이나" 하나뿐이다.
 *
 * 되돌리기는 **콕 횟수와 일정 오프셋만** 되돌린다. 이미 만든 회차는 그대로다 —
 * 확인창에서 그 사실을 숫자와 함께 보여준다.
 *
 * 운영자 PIN 은 여기서 바꾸지 않는다. 배포 시크릿(`MASTER_PIN`) 하나가 유일한 출처다 —
 * 바꾸는 자리가 둘이면 지금 무엇이 맞는 PIN 인지 화면으로는 알 수 없다.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BTN, HOST, HOST_UI, SCREEN_TITLE, UNIT } from "../../../shared/copy.ts";
import type { Defaults } from "../../../shared/types.ts";
import { DEFAULTS, LIMITS } from "../../../shared/constants.ts";
import { ApiError, api, post, put } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { LoadFailed } from "../../ui/Boom.tsx";
import { useOverlay } from "../../ui/Overlays.tsx";

export default function HostDefaults() {
  const navigate = useNavigate();
  const loaded = useLoad(() => api<Defaults>("/host/defaults"));
  useAuthRedirect(loaded.error);
  const { confirm, toast } = useOverlay();

  const [form, setForm] = useState<Defaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(loaded.data), [loaded.data]);

  // 불러오는 중은 빈 화면이 맞다. 실패는 갈라준다 — 빈 화면은 무엇을 해야 할지 말하지 않는다
  if (loaded.error) return <LoadFailed error={loaded.error} />;
  if (!form) return <div className="screen" />;

  const set = <K extends keyof Defaults,>(key: K, value: Defaults[K]) => {
    setForm({ ...form, [key]: value });
    setError(null);
  };

  async function save() {
    try {
      const next = await put<Defaults>("/host/defaults", form);
      loaded.set(next);
      toast(BTN.saved);
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? HOST.pin.saveFailed) : HOST.pin.saveFailed);
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
          [HOST_UI.fields.regOpenAt, `${form!.regOpenBeforeD}d → ${DEFAULTS.regOpenBeforeD}d`],
          [HOST_UI.fields.prevoteAt, `${form!.prevoteBeforeH}h → ${DEFAULTS.prevoteBeforeH}h`],
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
          label={HOST_UI.fields.regOpenBeforeD}
          value={form.regOpenBeforeD}
          min={0}
          max={60}
          onChange={(v) => set("regOpenBeforeD", v)}
        />
        <Num
          label={HOST_UI.fields.prevoteBeforeH}
          value={form.prevoteBeforeH}
          min={0}
          max={720}
          onChange={(v) => set("prevoteBeforeH", v)}
        />

        {error && <p className="err danger">{error}</p>}

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
