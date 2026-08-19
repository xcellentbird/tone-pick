/**
 * 새 회차 만들기 3스텝.
 *
 * **파티 일시가 먼저다.** 등록 시작도 사전 투표 시작도 거기서 거꾸로 계산된다 —
 * 운영자가 실제로 아는 건 "언제 모이나" 하나뿐이고, 나머지는 그것에 딸린 값이다.
 * 파티 일시를 옮기면 아직 손대지 않은 값들이 따라 움직인다. 직접 고친 값은 그대로 둔다.
 *
 * 예약하는 건 등록 시작과 사전 투표 시작 **둘뿐**이다.
 * 사전 투표 마감·파티 시작·발표는 현장에서 운영자가 누른다 (ADR-14).
 *
 * '지금 바로'는 시각이 아니라 **토글**이다 — `datetime-local` 이 초를 버려서
 * "지금"을 시각으로 넣으면 매번 몇 초씩 어긋난다. 서버에는 리터럴 "now" 로 보낸다.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, HOST_UI, SCREEN_TITLE, pokeEstimateLabel } from "../../../shared/copy.ts";
import type { CreateEventInput, Defaults, EventMeta } from "../../../shared/types.ts";
import { DEFAULTS, LIMITS, pokeEstimate } from "../../../shared/constants.ts";
import { SCHEDULE_STEP_MIN, fromLocalInput, snapSchedule, toLocalInput } from "../../../shared/time.ts";
import { ApiError, api, post } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { useAuthRedirect } from "../../lib/guard.ts";
import { Num } from "./HostDefaults.tsx";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 다음 금요일 저녁 8시 — 손대지 않고 넘어가도 말이 되는 값 */
function defaultPartyAt(from: number): number {
  const d = new Date(from);
  d.setHours(20, 0, 0, 0);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.getTime();
}

export default function HostWizard() {
  const { step = "1" } = useParams();
  const navigate = useNavigate();
  const defaults = useLoad(() => api<Defaults>("/host/defaults"));
  useAuthRedirect(defaults.error);

  const at = Math.min(3, Math.max(1, Number(step) || 1));
  // 멱등키는 위저드 한 번에 하나. 두 번 눌러도 회차는 하나만 생긴다
  const requestId = useMemo(() => `w-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const [name, setName] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [partyAt, setPartyAt] = useState<number>(() => defaultPartyAt(Date.now()));
  const [regOpenAt, setRegOpenAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.regOpenBeforeD * DAY);
  const [prevoteAt, setPrevoteAt] = useState<number>(() => defaultPartyAt(Date.now()) - DEFAULTS.prevoteBeforeH * HOUR);
  // 직접 고친 값은 파티 일시를 옮겨도 따라가지 않는다. 고쳐놓은 걸 되돌리는 건 사고다
  const [touched, setTouched] = useState<{ reg?: boolean; prevote?: boolean }>({});
  const [maxPre, setMaxPre] = useState(DEFAULTS.maxPre);
  const [maxParty, setMaxParty] = useState(DEFAULTS.maxParty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = defaults.data;
    if (!d) return;
    setMaxPre(d.maxPre);
    setMaxParty(d.maxParty);
    setRegOpenAt((prev) => (touched.reg ? prev : partyAt - d.regOpenBeforeD * DAY));
    setPrevoteAt((prev) => (touched.prevote ? prev : partyAt - d.prevoteBeforeH * HOUR));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.data]);

  function changeParty(value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    const ts = snapSchedule(raw);
    setPartyAt(ts);
    const d = defaults.data ?? DEFAULTS;
    if (!touched.reg) setRegOpenAt(ts - d.regOpenBeforeD * DAY);
    if (!touched.prevote) setPrevoteAt(ts - d.prevoteBeforeH * HOUR);
  }

  function changeWhen(key: "reg" | "prevote", value: string) {
    const raw = fromLocalInput(value);
    if (!raw) return;
    // 직접 타이핑하면 브라우저가 step 을 강제하지 않는다. 받은 값을 여기서 맞춘다
    const ts = snapSchedule(raw);
    setTouched({ ...touched, [key]: true });
    if (key === "reg") setRegOpenAt(ts);
    else setPrevoteAt(ts);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const body: CreateEventInput = {
        name: name.trim(),
        partyAt,
        regOpenAt: openNow ? "now" : regOpenAt,
        prevoteAt,
        config: { maxPre, maxParty },
        requestId,
      };
      const made = await post<EventMeta>("/host/events", body);
      navigate(`/host/${made.id}`, { replace: true });
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? (e.userMessage ?? "") : "");
    }
  }

  const estimate = pokeEstimate(8, 8, maxPre);
  const label = pokeEstimateLabel(estimate.pct);

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => (at === 1 ? navigate("/host/events") : navigate(-1))}>
          {BTN.back}
        </button>
        <div className="grow">
          <h1>{SCREEN_TITLE.hostWizard}</h1>
          <div className="sub">{at}/3</div>
        </div>
      </header>

      <div className="body stack">
        {/*
          **회차 코드는 묻지 않는다.** 서버가 겹치지 않는 것으로 붙인다 (`freeCode`).
          참가자가 코드를 입력하는 화면이 없어진 뒤로 (ADR-15) 이 칸이 답하는 질문이 없어졌다 —
          운영자가 링크를 돌리고, 문은 초대 명단의 전화번호가 연다.
          코드는 만들어진 뒤 회차 목록과 콘솔 머리에서 볼 수 있다.
        */}
        {at === 1 && (
          <div className="field">
            <label htmlFor="ename">{HOST_UI.fields.name}</label>
            <input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        {at === 2 && (
          <>
            <div className="field">
              <label htmlFor="party">{HOST_UI.fields.partyAt}</label>
              <input
                id="party"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(partyAt)}
                onChange={(e) => changeParty(e.target.value)}
              />
            </div>

            <div className="field">
              <label>{HOST_UI.fields.regOpenAt}</label>
              <div className="choice">
                <button type="button" aria-pressed={openNow} onClick={() => setOpenNow(true)}>
                  {HOST_UI.nowToggle}
                </button>
                <button type="button" aria-pressed={!openNow} onClick={() => setOpenNow(false)}>
                  {HOST_UI.pickTime}
                </button>
              </div>
              {!openNow && (
                <input
                  type="datetime-local"
                  step={SCHEDULE_STEP_MIN * 60}
                  value={toLocalInput(regOpenAt)}
                  onChange={(e) => changeWhen("reg", e.target.value)}
                />
              )}
            </div>

            <div className="field">
              <label htmlFor="prevote">{HOST_UI.fields.prevoteAt}</label>
              <input
                id="prevote"
                type="datetime-local"
                step={SCHEDULE_STEP_MIN * 60}
                value={toLocalInput(prevoteAt)}
                onChange={(e) => changeWhen("prevote", e.target.value)}
              />
              <span className="tiny dim">{HOST_UI.fields.manualNote}</span>
            </div>
          </>
        )}

        {at === 3 && (
          <>
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
            {/* 기대 상호 매칭 쌍 수는 파티 규모와 무관하게 k² 에 수렴한다 — 고르는 자리에서 보여준다 */}
            <p className={`small ${label.tone === "good" ? "okText" : "warnText"}`}>{label.label}</p>
          </>
        )}

        {error && <p className="err danger">{error}</p>}
      </div>

      <div className="row" style={{ padding: "0 16px 16px" }}>
        <button
          className="btn wide primary"
          disabled={busy || (at === 1 && !name.trim())}
          onClick={() => (at < 3 ? navigate(`/host/new/${at + 1}`) : finish())}
        >
          {at < 3 ? BTN.next : HOST_UI.newEvent}
        </button>
      </div>
    </div>
  );
}
