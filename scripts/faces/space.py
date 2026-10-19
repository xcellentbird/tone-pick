"""한 풀의 얼굴 벡터를 만든다 (v4 부터, ADR-132) — 얼굴 인식 모델의 특징 + 얼굴 메시의 생김새를 한 벡터로.

python space.py <in.json> <out.json> <판>
    in   {"ids": [...], "sface": [[128] ...], "pts": [[[x, y, z] × 478] ...]}   face.py embed · mesh 의 결과를 풀마다 모은 것
    out  {"ids": [...], "vecs": [[dim] ...], "info": {...}}                      단위 길이. emit-face.mjs 가 양자화해 싣는다
    판   내는 판 번호 — v7 부터 메시를 좌우 대칭으로 다듬고 무게를 줄인다 (`SYM_FROM`)

읽는 것: 주어진 in.json
쓰는 것: 주어진 out.json
순서: emit-face.mjs 가 부른다 (face.py embed · mesh 다음)

**왜 이 둘인가.** v1~v3 의 벡터는 LLM 이 사진마다 정해진 낱말을 고른 것이었다 (ADR-122 ⑥). 참가자 평가가 매우 나빴고(`매우 부정확`),
운영자가 전에 얼굴 메시 · 얼굴 인식 모델의 특징을 평균 내 가장 가까운 연예인을 고른 쪽의 만족도가 더 좋았다고 했다 (ADR-132).
  - SFace(얼굴 인식) — 얼굴 전체가 **누구와 닮았나**. 같은 사람이 모이도록 배운 공간이라 닮은꼴이 가깝다
  - 얼굴 메시(478점) — **얼굴형과 이목구비의 비율**. 같은 얼굴형 · 눈매 · 입매가 가깝다
같은 사진(이 크롭)으로 고르고 같은 사진으로 보여 준다 — 그래서 표정은 지우지 않는다. 블렌드셰이프로 표정을 빼 본 메시는
눈 가린 비교에서 23:65 로 졌다 (ADR-132 종이 검증 표).

**v7 에서 메시를 좌우 대칭으로 · 무게 0.15 로 (ADR-138).** 메시가 생김새보다 사진의 고개 각도를 따라갔다 — 같은 사람의
다른 사진끼리 메시가 남남이 되고(각도가 30° 다르면 코사인 0.06), 가까운 얼굴이 같은 쪽으로 고개를 돌린 사진끼리 모였다.
좌우를 대칭으로 다듬으면 고개를 좌우로 돌린 몫이 빠지고, 무게를 반으로 줄이면 다른 사진이 그 사람을 1등으로 찾는 비율이
58% → 78%(여) · 68% → 85%(남) 가 된다. 얼굴형 · 표정 · 고개의 위아래는 남는다 — 사람이 그것으로 닮음을 보는지는
아직 모른다. 지인의 닮은 쪽 고르기가 가린다 (ADR-138).

**만드는 법** — 같은 입력이면 같은 출력이다 (난수가 없다)
1. SFace — 풀의 평균을 빼고 단위 길이. 모두가 나눠 가진 몫이 유사도를 차지하면 풀 한가운데의 몇 사람이 누구의 평균에도
   가장 가까운 '허브' 가 된다 (ADR-122 종이 검증 2차와 같은 이유)
2. 메시 — 478점을 3차원 상사 변환(자리 · 크기 · 회전)으로 서로 맞춘다 (일반화 프로크루스테스, 열 번).
   v7 부터는 맞춘 모양마다 그 거울상과 평균한다 (`symmetric`). 맞춘 좌표의 주성분 `GEOM_DIM` 개를 남기고,
   분산을 `GEOM_WHITEN` 제곱만큼 눌러 첫 성분 몇 개가 다 먹지 않게 한다. 풀의 평균을 빼고 단위 길이
3. 이어 붙인다 — √(1 − w) · SFace , √w · 메시 → 단위 길이 (w 는 `w_geom(판)`). 코사인이 곧 두 코사인의 가중 합이다
"""
import json
import sys

import numpy as np

# 메시 쪽 무게 — 판마다 다르다 (`w_geom`)
#   v4~v6  0.3 — 같은 고른 얼굴로 견줬다(눈 가린 비교, ADR-132): 0.35 가 0.25 를 30:21 로 이겼고, 표정을 뺀 메시에서는
#          0.4 가 0.25 에 32:42 로 졌다. 그 사이를 골랐다. 메시가 SFace 보다 커지면 사진의 각도 · 표정이 얼굴을 앞선다
#   v7~    0.15 (대칭 메시) — 0.3 에서는 같은 사람의 다른 사진도 다른 얼굴로 갈렸다 (ADR-138)
W_GEOM_V4 = 0.3
W_GEOM = 0.15
# 메시를 좌우 대칭으로 다듬고 무게를 줄인 판 (ADR-138). 그 앞 판을 다시 내도 같은 벡터가 나오게 판 번호로 가른다
SYM_FROM = 7
# 메시 주성분 수 — 16 개가 맞춘 좌표 분산의 약 94% 다
GEOM_DIM = 16
# 분산을 누르는 정도 — 0 이면 첫 성분(대개 고개의 위아래)이 다 먹고, 0.5 면 잡음 성분까지 같은 무게가 된다
GEOM_WHITEN = 0.25
GPA_ITERS = 10
# 얼굴 틀을 세우는 점 (MediaPipe 478점의 번호) — 두 눈꼬리가 좌우, 이마 · 턱이 위아래
EYE_R, EYE_L, BROW, CHIN = 33, 263, 10, 152


def w_geom(v):
    return W_GEOM if v >= SYM_FROM else W_GEOM_V4


def unit(x):
    return x / np.clip(np.linalg.norm(x, axis=1, keepdims=True), 1e-12, None)


def centered(x):
    return unit(x - x.mean(0))


def align(x, ref):
    """모양 하나를 ref 에 맞춘다 — 회전(거울상 없이)과 크기"""
    u, _, vt = np.linalg.svd(x.T @ ref)
    d = np.eye(3)
    d[2, 2] = np.sign(np.linalg.det(u @ vt))
    y = x @ (u @ d @ vt)
    return y * (np.trace(y.T @ ref) / np.trace(y.T @ y))


def gpa(pts):
    """n × 478 × 3 → 서로 맞춘 모양과 그 평균 모양. 자리 · 크기 · 회전(거울상 없이)을 지우고 모양만 남긴다"""
    p = pts - pts.mean(1, keepdims=True)
    p = p / np.linalg.norm(p, axis=(1, 2), keepdims=True)
    ref = p[0].copy()
    for _ in range(GPA_ITERS):
        p = np.array([align(x, ref) for x in p])
        ref = p.mean(0)
        ref = ref / np.linalg.norm(ref)
    return p, ref


def mirror(ref):
    """평균 모양의 좌우 짝과 얼굴 틀의 좌우 뒤집기. 얼굴 틀(눈꼬리가 좌우, 이마 · 턱이 위아래)에서 좌우를 뒤집었을 때
    가장 가까운 점이 짝이다 — 점 번호의 짝 표를 따로 들지 않고 이 풀의 평균 모양에서 센다"""
    ex = ref[EYE_L] - ref[EYE_R]
    ex = ex / np.linalg.norm(ex)
    ey = ref[BROW] - ref[CHIN]
    ey = ey - ex * (ey @ ex)
    ey = ey / np.linalg.norm(ey)
    frame = np.stack([ex, ey, np.cross(ex, ey)], 1)
    local = (ref - (ref[EYE_R] + ref[EYE_L]) / 2) @ frame
    local[:, 0] -= np.median(local[:, 0])
    flipped = local * np.array([-1, 1, 1])
    pair = ((flipped[:, None, :] - local[None, :, :]) ** 2).sum(-1).argmin(1)
    return pair, frame @ np.diag([-1, 1, 1]) @ frame.T


def symmetric(shapes, ref):
    """맞춘 모양마다 그 거울상(얼굴 틀에서 좌우를 뒤집고 짝을 바꿔 다시 맞춘 것)과 평균한다. 고개를 좌우로 돌린 몫 ·
    한쪽만 올라간 입꼬리처럼 좌우가 다른 몫은 빠지고, 양쪽이 같은 생김새(얼굴형 · 웃음 · 고개의 위아래)는 남는다"""
    pair, flip = mirror(ref)
    out = np.empty_like(shapes)
    for i, x in enumerate(shapes):
        m = (x @ flip.T)[pair]
        m = m - m.mean(0)
        out[i] = (x + align(m / np.linalg.norm(m), ref)) / 2
    return out


def geometry(pts, sym):
    shapes, ref = gpa(pts)
    if sym:
        shapes = symmetric(shapes, ref)
    x = shapes.reshape(len(pts), -1)
    x = x - x.mean(0)
    _, s, vt = np.linalg.svd(x, full_matrices=False)
    ev = s**2 / (len(x) - 1)
    z = (x @ vt[:GEOM_DIM].T) / ev[:GEOM_DIM] ** GEOM_WHITEN
    return centered(z), float(ev[:GEOM_DIM].sum() / ev.sum())


def main(src, dst, version):
    v = int(version)
    w, sym = w_geom(v), v >= SYM_FROM
    d = json.load(open(src))
    ids = d["ids"]
    sface = centered(np.array(d["sface"], dtype=np.float64))
    geom, kept = geometry(np.array(d["pts"], dtype=np.float64), sym)
    vecs = unit(np.hstack([sface * np.sqrt(1 - w), geom * np.sqrt(w)]))
    info = {"sface": sface.shape[1], "geom": GEOM_DIM, "wGeom": w, "sym": sym, "whiten": GEOM_WHITEN, "geomVar": round(kept, 3)}
    json.dump({"ids": ids, "vecs": vecs.round(6).tolist(), "info": info}, open(dst, "w"))
    print(json.dumps({"n": len(ids), "dim": vecs.shape[1], **info}))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: python space.py <in.json> <out.json> <판>")
    main(*sys.argv[1:4])
