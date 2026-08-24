/**
 * 회차 기본 설정. 새 회차를 만들 때 위저드가 채워 넣는 값이다.
 *
 * 일정 기본값은 **파티 일시에서 거꾸로** 잰다 — 운영자가 실제로 아는 건 "언제 모이나" 하나뿐이다.
 * 등록 시작은 여기 없다 (ADR-37). 회차를 만드는 순간 열리므로 미리 정할 것이 없다.
 *
 * **장소가 여기 있는 이유**는 늘 같은 곳에서 여는 모임이기 때문이다 —
 * 회차마다 다시 적는 값이면 회차 만들기 화면에만 있어야 맞다. 회차에서 고치면 그 회차만 바뀐다.
 *
 * 되돌리기는 여기 적힌 것만 되돌린다. 이미 만든 회차는 그대로다 —
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
  if (loaded.error) return <LoadFailed error={loaded.error} onRetry={loaded.reload} busy={loaded.loading} />;
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
          [HOST_UI.fields.prevoteAt, `${form!.prevoteBeforeH}h → ${DEFAULTS.prevoteBeforeH}h`],
          // 빈 값도 뜻이 있다 — 회차마다 다른 곳에서 연다는 뜻이라 '—' 로 보여준다
          [HOST_UI.fields.place, `${form!.place || "—"} → ${DEFAULTS.place || "—"}`],
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
          label={HOST_UI.fields.prevoteBeforeH}
          value={form.prevoteBeforeH}
          min={0}
          max={720}
          onChange={(v) => set("prevoteBeforeH", v)}
        />
        {/* 등록 시작 오프셋은 없다 (ADR-37) — 회차를 만들면 곧바로 열린다 */}
        <p className="tiny dim">{HOST_UI.regOpensNow}</p>

        {/* 늘 같은 곳에서 여는 모임이면 여기 한 번 적어둔다. 회차마다 고칠 수 있다 */}
        <div className="field">
          <label htmlFor="dplace">{HOST_UI.fields.place}</label>
          <input
            id="dplace"
            value={form.place}
            maxLength={LIMITS.placeMax}
            onChange={(e) => set("place", e.target.value)}
          />
          <span className="tiny dim">{HOST_UI.fields.placeDefaultHint}</span>
        </div>

        {/*
          안내문 문구 (ADR-32). **여기 하나만 둔다** — 회차마다 다시 쓰지 않는다.
          회차마다 달라지는 장소·일시·링크는 치환 자리가 채운다.
        */}
        <div className="field">
          <label htmlFor="inviteTemplate">{HOST_UI.invite.templateTitle}</label>
          <textarea
            id="inviteTemplate"
            rows={5}
            value={form.inviteTemplate}
            maxLength={LIMITS.inviteTemplateMax}
            onChange={(e) => set("inviteTemplate", e.target.value)}
          />
          <span className="tiny dim">{HOST_UI.invite.templateHint}</span>
        </div>

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

/**
 * 켜고 끄는 설정 한 줄. **셋 중 하나가 늘 눌려 있는** 선택 줄과 같은 모양이다 —
 * 스위치로 두면 지금 어느 쪽인지 색으로만 말하게 된다.
 *
 * `on` 쪽 라벨을 왼쪽에 둘지 오른쪽에 둘지는 부르는 쪽이 정한다 —
 * 기본값이 왼쪽에 오는 게 읽기 편하다.
 */
/** 되돌리기 선택지. 기본(할 수 있음)이 왼쪽이다 */
export const UNDO_OPTIONS = [
  { on: true, label: HOST_UI.fields.undoOn },
  { on: false, label: HOST_UI.fields.undoOff },
] as const;

/** 알림 선택지. 기본(안 보냄)이 왼쪽이다 */
export const NOTIFY_OPTIONS = [
  { on: false, label: HOST_UI.fields.pokeNotifyOff },
  { on: true, label: HOST_UI.fields.pokeNotifyOn },
] as const;

/** 콕 대상 선택지. 기본(모두에게)이 오른쪽이다 — 좁히는 쪽을 먼저 읽는 줄이라 그대로 둔다 */
export const TARGET_OPTIONS = [
  { on: false, label: HOST_UI.fields.pokeTargetOpposite },
  { on: true, label: HOST_UI.fields.pokeTargetAll },
] as const;

export function Toggle({
  label,
  value,
  options,
  note,
  locked,
  onChange,
}: {
  label: string;
  value: boolean;
  /** `[왼쪽, 오른쪽]`. 각각 그 자리의 값과 글자 */
  options: readonly [{ on: boolean; label: string }, { on: boolean; label: string }];
  note?: string;
  /**
   * 굳어서 못 고치는 줄 (ADR-35). **숨기지 않고 잠근다** —
   * 지금 어느 쪽으로 돌아가고 있는지는 파티 중에 가장 자주 확인하는 값이다.
   */
  locked?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="choice">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-pressed={value === opt.on}
            disabled={locked}
            onClick={() => onChange(opt.on)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {/* 잠긴 이유가 먼저다. 고를 수 없는 줄에 고르는 근거를 남겨두면 읽는 순서가 어긋난다 */}
      {locked ? <span className="tiny dim">{HOST_UI.frozen}</span> : note && <span className="tiny dim">{note}</span>}
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
