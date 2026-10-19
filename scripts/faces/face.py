"""얼굴 도구 — YuNet(검출) + SFace(얼굴 인식) + MediaPipe(얼굴 메시). 사진 한 장에 대해 JSON 한 줄.

python face.py detect  <img>...            검출·정면도·크기
python face.py ident   <img>...            SFace 128차원 (동일인 비교용 — 나무위키 사진과 같은 사람인가)
python face.py embed   <크롭>...           SFace 128차원 — 자산 벡터의 재료 (v4 부터, ADR-132). 좌우를 뒤집은 것과 평균한다
python face.py mesh    <크롭>...           얼굴 메시 478점 (x · y · z, 픽셀) — 자산 벡터의 재료 (v4 부터, ADR-132)
python face.py crop    <img> <out.webp>    눈 수평·눈 사이 거리 고정의 4:5 크롭 (240x300)

읽는 것: 주어진 사진, 모델 폴더의 yunet.onnx · sface.onnx · face_landmarker.task
쓰는 것: crop 만 — 주어진 자리에 webp. 나머지는 표준 출력에 JSON 한 줄씩
순서: 공용 — fallback.mjs 의 py() 가 부른다 (select · recolor · build-attrs · recrop · emit 의 sface 팔 · emit-face)

모델 폴더: 환경 변수 FACES_MODELS → 없으면 $FACES_WORK/models → 없으면 <저장소>/.faces-work/models.
py() 는 FACES_MODELS 를 늘 넘긴다.

준비 (저장소 뿌리에서, 한 번). 파이썬은 3.12 이상이다 — numpy 2.5 가 3.11 을 받지 않는다.
MediaPipe 는 `--no-deps` 로 받는다 — 제 의존성으로 opencv-contrib-python 을 끌고 와서, 크롭이 타는 OpenCV 판을 바꾼다.
requirements.txt 가 필요한 것을 전부 판까지 적어 둔다. MediaPipe 는 EGL 을 열어 두므로 `libegl1` 이 있어야 한다:
    sudo apt-get install -y libegl1 libgles2
    python3.12 -m venv .faces-work/venv
    .faces-work/venv/bin/pip install --no-deps -r scripts/faces/requirements.txt
    mkdir -p .faces-work/models
    curl -L -o .faces-work/models/yunet.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
    curl -L -o .faces-work/models/sface.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
    curl -L -o .faces-work/models/face_landmarker.task \
      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
자산을 만든 모델의 sha256 — 다른 파일이면 크롭 · 동일인 판정 · 벡터가 달라진다:
    yunet.onnx            8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
    sface.onnx            0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
    face_landmarker.task  64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff   (v4 부터)
라이선스 — YuNet MIT · SFace Apache-2.0 (OpenCV Zoo) · MediaPipe Face Landmarker Apache-2.0. 자산에는 모델이 아니라 벡터만 실린다.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get("FACES_MODELS") or os.path.join(
    os.environ.get("FACES_WORK") or os.path.join(HERE, "..", "..", ".faces-work"), "models"
)
W, H = 240, 300
EYE_FRAC = 0.25   # 눈 사이 거리 = 폭의 25%
EYE_Y = 0.43      # 두 눈 중점의 높이 (위에서)


def load(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        # webp/gif 일부는 imread 가 못 읽는다 — imdecode 로 한 번 더
        data = np.fromfile(path, dtype=np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        # 배경을 오려낸 PNG — 투명한 자리의 RGB 는 대개 0 이라 그대로 읽으면 검은 조각이 된다. 흰 바탕에 얹는다
        a = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)).astype(np.uint8)
    return img


def detector(img):
    h, w = img.shape[:2]
    d = cv2.FaceDetectorYN.create(os.path.join(MODELS, "yunet.onnx"), "", (w, h), 0.7, 0.3, 50)
    d.setInputSize((w, h))
    _, faces = d.detect(img)
    return [] if faces is None else faces


def describe(f, w, h):
    x, y, fw, fh = [float(v) for v in f[:4]]
    rx, ry, lx, ly, nx, ny = [float(v) for v in f[4:10]]
    # 정면도 — 코가 두 눈 중점에서 얼마나 옆으로 비켰나 (눈 사이 거리 대비)
    ex = (rx + lx) / 2
    eye = max(1.0, float(np.hypot(lx - rx, ly - ry)))
    yaw = abs(nx - ex) / eye
    roll = float(np.degrees(np.arctan2(ly - ry, lx - rx)))
    return {
        "box": [round(x), round(y), round(fw), round(fh)],
        "score": round(float(f[-1]), 3),
        "eye": round(eye, 1),
        "yaw": round(yaw, 3),
        "roll": round(roll, 1),
        "area": round(fw * fh / (w * h), 4),
    }


def cmd_detect(paths):
    for p in paths:
        img = load(p)
        if img is None:
            print(json.dumps({"path": p, "err": "unreadable"}))
            continue
        h, w = img.shape[:2]
        faces = sorted(detector(img), key=lambda f: -f[2] * f[3])
        out = {"path": p, "w": w, "h": h, "n": len(faces)}
        if len(faces):
            out["main"] = describe(faces[0], w, h)
            # 두 번째 얼굴이 주 얼굴의 40% 넘게 크면 여럿이 찍힌 사진이다
            out["crowd"] = bool(len(faces) > 1 and faces[1][2] * faces[1][3] > 0.4 * faces[0][2] * faces[0][3])
        print(json.dumps(out, ensure_ascii=False))


def cmd_ident(paths):
    rec = cv2.FaceRecognizerSF.create(os.path.join(MODELS, "sface.onnx"), "")
    for p in paths:
        img = load(p)
        faces = [] if img is None else sorted(detector(img), key=lambda f: -f[2] * f[3])
        if not len(faces):
            print(json.dumps({"path": p, "err": "noface"}))
            continue
        crop = rec.alignCrop(img, faces[0])
        feat = rec.feature(crop).flatten()
        feat = feat / np.linalg.norm(feat)
        print(json.dumps({"path": p, "v": [round(float(x), 5) for x in feat]}))


def cmd_embed(paths):
    """자산 벡터의 SFace 쪽 (ADR-132). 크롭(240x300)을 두 배로 키워 다시 검출한다 — 작은 크롭에서는 YuNet 의 눈·코 점이 거칠어
    SFace 의 정렬(alignCrop)이 흔들린다. 정렬한 얼굴과 그 좌우를 뒤집은 것을 각각 재어 평균한다 — 고개가 조금 돈 사진이
    한쪽으로 쏠리지 않게. flip 은 두 벡터의 코사인 — 낮으면 사진이 얼굴을 덜 보여주는 것이다 (459장에서 0.84 ~ 0.99)"""
    rec = cv2.FaceRecognizerSF.create(os.path.join(MODELS, "sface.onnx"), "")
    for p in paths:
        img = load(p)
        if img is None:
            print(json.dumps({"path": p, "err": "unreadable"}))
            continue
        h, w = img.shape[:2]
        big = cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        faces = sorted(detector(big), key=lambda f: -f[2] * f[3])
        if not len(faces):
            print(json.dumps({"path": p, "err": "noface"}))
            continue
        crop = rec.alignCrop(big, faces[0])
        a = rec.feature(crop).flatten()
        b = rec.feature(cv2.flip(crop, 1)).flatten()
        a = a / np.linalg.norm(a)
        b = b / np.linalg.norm(b)
        v = (a + b) / np.linalg.norm(a + b)
        print(json.dumps({"path": p, "v": [round(float(x), 6) for x in v], "flip": round(float(a @ b), 4)}))


def cmd_mesh(paths):
    """자산 벡터의 얼굴 메시 쪽 (ADR-132) — MediaPipe Face Landmarker 의 478점. 크롭은 얼굴이 꽉 차 있어 가장자리를 60px 늘려
    둘레를 주고, 두 배로 키워 잰다. 점은 그 그림의 픽셀 단위다 — 크기·자리·기울기는 space.py 가 맞춰 지운다.
    MediaPipe 는 이 명령에서만 읽는다 — 다른 명령은 MediaPipe 없이 돈다"""
    from mediapipe import Image, ImageFormat
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

    opts = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=os.path.join(MODELS, "face_landmarker.task")),
        running_mode=RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.3,
        min_face_presence_confidence=0.3,
    )
    with FaceLandmarker.create_from_options(opts) as lm:
        for p in paths:
            img = load(p)
            if img is None:
                print(json.dumps({"path": p, "err": "unreadable"}))
                continue
            img = cv2.copyMakeBorder(img, 60, 60, 60, 60, cv2.BORDER_REPLICATE)
            big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            h, w = big.shape[:2]
            r = lm.detect(Image(image_format=ImageFormat.SRGB, data=cv2.cvtColor(big, cv2.COLOR_BGR2RGB)))
            if not r.face_landmarks:
                print(json.dumps({"path": p, "err": "noface"}))
                continue
            pts = [[round(q.x * w, 2), round(q.y * h, 2), round(q.z * w, 2)] for q in r.face_landmarks[0]]
            print(json.dumps({"path": p, "pts": pts}))


def cmd_crop(src, dst):
    img = load(src)
    faces = sorted(detector(img), key=lambda f: -f[2] * f[3])
    if not len(faces):
        print(json.dumps({"path": src, "err": "noface"}))
        return
    f = faces[0]
    rx, ry, lx, ly = [float(v) for v in f[4:8]]
    eye = float(np.hypot(lx - rx, ly - ry))
    ang = float(np.degrees(np.arctan2(ly - ry, lx - rx)))
    s = (EYE_FRAC * W) / eye
    cx, cy = (rx + lx) / 2, (ry + ly) / 2
    ih, iw = img.shape[:2]
    # 창이 사진보다 크면 가장자리를 늘려 채우게 된다(줄무늬) — 그보다 조금 당겨 찍는다
    s = max(s, W / iw, H / ih)
    # 창이 사진 밖으로 나가면 얼굴 자리를 옮겨 안에 넣는다. 눈 중점의 목표 자리(tx, ty)를 허용 범위로 자른다
    tx, ty = W / 2, EYE_Y * H
    tx = min(max(tx, W - (iw - cx) * s), cx * s)
    ty = min(max(ty, H - (ih - cy) * s), cy * s)
    M = cv2.getRotationMatrix2D((cx, cy), ang, s)
    M[0, 2] += tx - cx
    M[1, 2] += ty - cy
    out = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    # 원본 밖으로 나간 비율 — 가장자리 복제가 넓으면 사진이 어색하다
    mask = cv2.warpAffine(np.ones(img.shape[:2], np.uint8) * 255, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    outside = float((mask == 0).mean())
    cv2.imwrite(dst, out, [cv2.IMWRITE_WEBP_QUALITY, 82])
    print(json.dumps({"path": src, "out": dst, "scale": round(s, 3), "outside": round(outside, 3)}))


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "detect":
        cmd_detect(args)
    elif cmd == "ident":
        cmd_ident(args)
    elif cmd == "embed":
        cmd_embed(args)
    elif cmd == "mesh":
        cmd_mesh(args)
    elif cmd == "crop":
        cmd_crop(*args)
