"""한 풀의 얼굴 벡터를 만든다 (v4 부터, ADR-132) — 얼굴 인식 모델의 특징 + 얼굴 메시의 생김새를 한 벡터로.

python space.py <in.json> <out.json>
    in   {"ids": [...], "sface": [[128] ...], "pts": [[[x, y, z] × 478] ...]}   face.py embed · mesh 의 결과를 풀마다 모은 것
    out  {"ids": [...], "vecs": [[dim] ...], "info": {...}}                      단위 길이. emit-face.mjs 가 양자화해 싣는다

읽는 것: 주어진 in.json
쓰는 것: 주어진 out.json
순서: emit-face.mjs 가 부른다 (face.py embed · mesh 다음)

**왜 이 둘인가.** v1~v3 의 벡터는 LLM 이 사진마다 정해진 낱말을 고른 것이었다 (ADR-122 ⑥). 참가자 평가가 매우 나빴고(`매우 부정확`),
운영자가 전에 얼굴 메시 · 얼굴 인식 모델의 특징을 평균 내 가장 가까운 연예인을 고른 쪽의 만족도가 더 좋았다고 했다 (ADR-132).
  - SFace(얼굴 인식) — 얼굴 전체가 **누구와 닮았나**. 같은 사람이 모이도록 배운 공간이라 닮은꼴이 가깝다
  - 얼굴 메시(478점) — **얼굴형과 이목구비의 비율**. 같은 얼굴형 · 눈매 · 입매가 가깝다
같은 사진(이 크롭)으로 고르고 같은 사진으로 보여 준다 — 그래서 표정은 지우지 않는다. 블렌드셰이프로 표정을 빼 본 메시는
눈 가린 비교에서 23:65 로 졌다 (ADR-132 종이 검증 표).

**만드는 법** — 같은 입력이면 같은 출력이다 (난수가 없다)
1. SFace — 풀의 평균을 빼고 단위 길이. 모두가 나눠 가진 몫이 유사도를 차지하면 풀 한가운데의 몇 사람이 누구의 평균에도
   가장 가까운 '허브' 가 된다 (ADR-122 종이 검증 2차와 같은 이유)
2. 메시 — 478점을 3차원 상사 변환(자리 · 크기 · 회전)으로 서로 맞춘다 (일반화 프로크루스테스, 열 번). 맞춘 좌표의 주성분
   `GEOM_DIM` 개를 남기고, 분산을 `GEOM_WHITEN` 제곱만큼 눌러 첫 성분 몇 개가 다 먹지 않게 한다. 풀의 평균을 빼고 단위 길이
3. 이어 붙인다 — √(1 − W_GEOM) · SFace , √W_GEOM · 메시 → 단위 길이. 코사인이 곧 두 코사인의 가중 합이다
"""
import json
import sys

import numpy as np

# 메시 쪽 무게 — 같은 고른 얼굴로 견줬다(눈 가린 비교, ADR-132): 0.35 가 0.25 를 30:21 로 이겼고, 표정을 뺀 메시에서는
# 0.4 가 0.25 에 32:42 로 졌다. 그 사이를 골랐다. 메시가 SFace 보다 커지면 사진의 각도 · 표정이 얼굴을 앞선다
W_GEOM = 0.3
# 메시 주성분 수 — 16 개가 맞춘 좌표 분산의 약 94% 다
GEOM_DIM = 16
# 분산을 누르는 정도 — 0 이면 첫 성분(대개 고개의 위아래)이 다 먹고, 0.5 면 잡음 성분까지 같은 무게가 된다
GEOM_WHITEN = 0.25
GPA_ITERS = 10


def unit(x):
    return x / np.clip(np.linalg.norm(x, axis=1, keepdims=True), 1e-12, None)


def centered(x):
    return unit(x - x.mean(0))


def gpa(pts):
    """n × 478 × 3 → 서로 맞춘 모양. 자리 · 크기 · 회전(거울상 없이)을 지우고 모양만 남긴다"""
    p = pts - pts.mean(1, keepdims=True)
    p = p / np.linalg.norm(p, axis=(1, 2), keepdims=True)
    ref = p[0].copy()
    for _ in range(GPA_ITERS):
        out = np.empty_like(p)
        for i, x in enumerate(p):
            u, _, vt = np.linalg.svd(x.T @ ref)
            d = np.eye(3)
            d[2, 2] = np.sign(np.linalg.det(u @ vt))
            y = x @ (u @ d @ vt)
            out[i] = y * (np.trace(y.T @ ref) / np.trace(y.T @ y))
        p = out
        ref = p.mean(0)
        ref = ref / np.linalg.norm(ref)
    return p


def geometry(pts):
    x = gpa(pts).reshape(len(pts), -1)
    x = x - x.mean(0)
    _, s, vt = np.linalg.svd(x, full_matrices=False)
    ev = s**2 / (len(x) - 1)
    z = (x @ vt[:GEOM_DIM].T) / ev[:GEOM_DIM] ** GEOM_WHITEN
    return centered(z), float(ev[:GEOM_DIM].sum() / ev.sum())


def main(src, dst):
    d = json.load(open(src))
    ids = d["ids"]
    sface = centered(np.array(d["sface"], dtype=np.float64))
    geom, kept = geometry(np.array(d["pts"], dtype=np.float64))
    vecs = unit(np.hstack([sface * np.sqrt(1 - W_GEOM), geom * np.sqrt(W_GEOM)]))
    info = {"sface": sface.shape[1], "geom": GEOM_DIM, "wGeom": W_GEOM, "whiten": GEOM_WHITEN, "geomVar": round(kept, 3)}
    json.dump({"ids": ids, "vecs": vecs.round(6).tolist(), "info": info}, open(dst, "w"))
    print(json.dumps({"n": len(ids), "dim": vecs.shape[1], **info}))


if __name__ == "__main__":
    main(*sys.argv[1:3])
