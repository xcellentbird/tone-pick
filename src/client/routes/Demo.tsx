/**
 * 데모 뷰 — **운영자 화면과 참가자 폰을 한 화면에** 놓고 돌려보는 시연 도구.
 *
 * 시연에서 보고 싶은 건 "이 단계에서, 이 설정에서 참가자 화면이 어떻게 보이나" 다.
 * 그러려면 단계를 넘기는 손과 결과를 보는 눈이 같은 화면에 있어야 한다 —
 * 탭을 오가며 확인하면 방금 뭘 눌렀는지 잊는다.
 *
 * 운영자 화면은 **진짜 콘솔을 그대로** 띄운다 (`<iframe src="/host/:id">`).
 * 시연용으로 다시 만들면 그 순간부터 진짜와 조금씩 달라지고, 시연은 거짓말이 된다.
 *
 * 참가자 뷰도 따로 만들지 않는다. 같은 컴포넌트에 자료 통로와 탭 상태만 다르게 준다 (ADR-7).
 * 폰 상태는 URL 에 담지 않는다 — 뒤로 가기로 폰 하나의 탭만 되돌아가면 오히려 혼란스럽다.
 * 그래서 폰마다 `Overlays history={false}` 로 감싸 확인창도 서로 독립이다.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, DEMO_UI, SCREEN_TITLE } from "../../shared/copy.ts";
import { ApiError, api, post } from "../lib/api.ts";
import { connect } from "../lib/realtime.ts";
import { demoSource } from "../lib/participant.ts";
import { useLoad } from "../lib/useLoad.ts";
import { useAuthRedirect } from "../lib/guard.ts";
import { Overlays, useOverlay } from "../ui/Overlays.tsx";
import { ParticipantView, type Tab } from "./Participant.tsx";
import type { ConsoleState } from "./host/HostConsole.tsx";

/** 한 화면에 놓을 수 있는 폰 수. 그 이상은 어느 것도 제대로 안 보인다 */
const MAX_PHONES = 3;

export default function Demo() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const loaded = useLoad(() => api<ConsoleState>(`/host/events/${id}/state`), [id]);
  useAuthRedirect(loaded.error, `/host?event=${id}`);
  const [picked, setPicked] = useState<string[]>([]);
  // 연습용 환경에서만 시연 도구가 산다. 서버도 같은 기준으로 막는다
  const env = useLoad(() => api<{ label?: string }>("/health"));

  // 폰마다 실시간을 따로 듣지 않는다. 한 번만 듣고 폰 전체에 "다시 읽어라"를 돌린다 —
  // 한쪽 폰에서 찌른 콕이 다른 폰에 보여야 시연이 된다
  const [tick, setTick] = useState(0);
  const code = loaded.data?.meta.code;
  useEffect(() => {
    if (!code) return;
    const socket = connect(code, () => setTick((t) => t + 1));
    return () => socket.close();
  }, [code]);

  const players = loaded.data?.players ?? [];
  const shown = picked.length ? picked : players.slice(0, MAX_PHONES).map((p) => p.id);

  return (
    <div className="screen">
      <header>
        <button className="btn ghost" onClick={() => navigate(`/host/${id}`)}>
          {BTN.back}
        </button>
        <h1 className="grow">{SCREEN_TITLE.demo}</h1>
        {env.data?.label && <Tools eventId={id} onDone={() => loaded.reload()} />}
      </header>

      <div className="tabs">
        {players.map((p) => (
          <a
            key={p.id}
            className={shown.includes(p.id) ? "active" : ""}
            onClick={() =>
              setPicked((list) => {
                const base = list.length ? list : shown;
                return base.includes(p.id)
                  ? base.filter((x) => x !== p.id)
                  : [...base, p.id].slice(-MAX_PHONES);
              })
            }
          >
            {p.nickname}
          </a>
        ))}
      </div>

      {players.length === 0 && <p className="dim center pre">{DEMO_UI.noPlayers}</p>}

      <div className="demo">
        {/* 진짜 운영자 콘솔. 시연용으로 다시 만들면 그 순간부터 진짜와 달라진다 */}
        <div className="console">
          <iframe src={`/host/${id}`} title={SCREEN_TITLE.hostConsole} />
        </div>
        {shown.map((playerId) => (
          <Phone key={playerId} eventId={id} playerId={playerId} tick={tick} />
        ))}
      </div>
    </div>
  );
}

/**
 * 시연 도구. **연습용 환경에서만 보이고, 서버도 같은 기준으로 막는다.**
 *
 * 사람을 넣고 콕을 뿌리는 데 시간을 쓰면 정작 볼 것을 못 본다 —
 * 발표 화면과 커플 자리는 매칭이 있어야 볼 수 있는데, 거기까지 손으로 가면 시연이 끝난다.
 */
function Tools({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const { confirm, toast } = useOverlay();
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: unknown, done: (n: number) => string) {
    setBusy(true);
    try {
      const res = await post<{ added?: number }>(`/host/events/${eventId}/demo/${path}`, body);
      toast(done(res.added ?? 0));
      onDone();
    } catch (e) {
      toast(e instanceof ApiError && e.userMessage ? e.userMessage : DEMO_UI.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      <button className="btn" disabled={busy} onClick={() => run("players", { count: 8 }, DEMO_UI.added)}>
        {DEMO_UI.addPlayers(8)}
      </button>
      <button className="btn" disabled={busy} onClick={() => run("pokes", {}, DEMO_UI.poked)}>
        {DEMO_UI.addPokes}
      </button>
      <button
        className="btn danger"
        disabled={busy}
        onClick={() =>
          confirm(
            { btn: DEMO_UI.reset, title: DEMO_UI.resetTitle, danger: true, note: DEMO_UI.resetNote, facts: [] },
            async () => {
              await post(`/host/events/${eventId}/demo/reset`);
              toast(DEMO_UI.resetDone);
              onDone();
            },
          )
        }
      >
        {DEMO_UI.reset}
      </button>
    </div>
  );
}

/** 폰 한 대. 탭·시트·확인창이 전부 이 안에서만 움직인다 */
function Phone({ eventId, playerId, tick }: { eventId: string; playerId: string; tick: number }) {
  const [tab, setTab] = useState<Tab>("home");
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [source] = useState(() => demoSource(eventId, playerId));
  // 시트를 이 폰 안에 그린다. 기본 포털(document.body)로 나가면 폰 밖에 뜬다
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);

  return (
    <div className="phone" ref={setFrame}>
      <Overlays history={false} container={frame}>
        <ParticipantView
          source={source}
          container={frame}
          refreshToken={tick}
          tab={tab}
          onTab={setTab}
          profileId={profileId}
          onProfile={(id) => setProfileId(id ?? undefined)}
        />
      </Overlays>
    </div>
  );
}
