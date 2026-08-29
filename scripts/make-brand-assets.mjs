/**
 * 원본 로고 한 장에서 나가는 자산 넷을 만든다.
 *
 *   node scripts/make-brand-assets.mjs
 *
 * 손으로 자르지 마라 — 자를 자리(투명 여백, O 의 위치)를 픽셀에서 다시 찾으므로,
 * 원본이 바뀌어도 같은 규칙으로 나온다.
 */
import sharp from "sharp";
import { statSync } from "node:fs";

const SRC = new URL("../design/TONE_PARTY_LOGO.png", import.meta.url).pathname;
const BG = "#151118"; // theme.css 의 --bg — 미리보기 카드의 바탕

/**
 * **아이콘 바탕은 크림이다.** 앱 바탕(`--bg`)으로 두면 **다크 모드 탭바에 아이콘이 묻힌다** —
 * 탭이 여러 개 열린 화면에서 우리를 못 찾는다.
 *
 * 로고 글자·발바닥의 크림(`#fdf5e2` · `#fef5e2`)과 **똑같이 두지 않는다.** 같으면 발바닥이
 * 바탕에 잠겨 짙은 외곽선만 남는다. 한 단 낮춰 실낱만큼 떨어뜨린다.
 *
 * 밝은 탭(`#f2f2f2`)·어두운 탭(`#202124`) 양쪽에 얹어 96·32·16px 로 확인했다.
 * 보라·분홍은 `O` 가 바탕에 잠겨서 못 쓴다.
 */
const ICON_BG = "#f7ede0";
const out = (p) => new URL("../" + p, import.meta.url).pathname;

/** 알파가 있는 픽셀의 상자 — 투명 여백을 걷어낸다 */
async function artBox() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * C + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * 아이콘으로 쓸 정사각 — **보라색 `O` 와 그 위의 발끝.**
 * 로고 전체는 16px 에서 뭉갠다. 보라를 픽셀에서 찾아 그 둘레를 잡는다.
 */
async function markBox() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      if (data[o + 3] < 40) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (b > 190 && r > 60 && r < 130 && g < 90) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  // O 를 가운데 두고, 위로 발끝과 튀는 표시까지 들어오게 정사각으로
  const side = Math.round((x1 - x0) * 1.12);
  return { left: Math.round(x0 - (side - (x1 - x0)) / 2), top: y1 - side + 6, width: side, height: side };
}

const icon = async (px, inset, art) => {
  const inner = await sharp(SRC).extract(art).resize(px - inset * 2, px - inset * 2).png().toBuffer();
  return sharp({ create: { width: px, height: px, channels: 4, background: ICON_BG } })
    .composite([{ input: inner, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const art = await artBox();
const mark = await markBox();

// ① 회차 확인 화면. 최대 260px 로 뜨므로 3배 화면까지 덮는 640px
const LW = 640;
await sharp(SRC).extract(art).resize(LW, Math.round((art.height / art.width) * LW), { kernel: "lanczos3" })
  .webp({ quality: 80, effort: 6 }).toFile(out("src/client/assets/logo.webp"));

// ② 탭 · ③ 홈 화면 — 바탕을 채운다. 투명하게 두면 발끝이 밝은 탭에서 사라진다
await sharp(await icon(48, 2, mark)).toFile(out("public/favicon.png"));
await sharp(await icon(180, 16, mark)).toFile(out("public/apple-touch-icon.png"));

// ④ 카톡 미리보기 카드 (ADR-68). 알파가 필요 없으니 JPEG — PNG 는 214 KiB, JPEG 은 36 KiB
const CARD_LOGO = 560;
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#a98fff" stop-opacity=".30"/>
      <stop offset="55%" stop-color="#a98fff" stop-opacity=".08"/>
      <stop offset="100%" stop-color="#a98fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="p" cx="94%" cy="4%" r="58%">
      <stop offset="0%" stop-color="#cb75d1" stop-opacity=".12"/>
      <stop offset="100%" stop-color="#cb75d1" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${BG}"/>
  <rect width="1200" height="630" fill="url(#p)"/>
  <rect width="1200" height="630" fill="url(#g)"/></svg>`);
const cardLogo = await sharp(SRC).extract(art).resize(CARD_LOGO).png().toBuffer();
const clm = await sharp(cardLogo).metadata();
await sharp(bg)
  .composite([{ input: cardLogo, left: Math.round((1200 - CARD_LOGO) / 2), top: Math.round((630 - clm.height) / 2) }])
  .jpeg({ quality: 88, progressive: true })
  .toFile(out("public/og.jpg"));

const kib = (p) => (statSync(out(p)).size / 1024).toFixed(1).padStart(6);
for (const p of ["src/client/assets/logo.webp", "public/og.jpg", "public/favicon.png", "public/apple-touch-icon.png"])
  console.log(`${kib(p)} KiB  ${p}`);
console.log(`\n⚠️ 로고 크기가 바뀌었으면 Join.tsx 의 <img width height> 를 고쳐라 — 비율이 사는 곳은 거기 한 곳뿐이다.`);
