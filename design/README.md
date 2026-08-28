# 원본 자산 — **여기 있는 것은 번들에 안 실린다**

`src/client/assets/` 와 헷갈리지 마라. 저기는 **`import` 해서 화면에 나가는 것**을 두는
곳이고, 여기는 그것을 만들어낸 **원본**을 두는 곳이다.

원본을 `src/client/assets/` 에 두면 누가 실수로 `import` 했을 때 1.26 MB 가 그대로
참가자에게 나간다. (지금은 `check:bundle` 이 잡지만, 애초에 헷갈릴 자리에 두지 않는 게 낫다.)

| 원본 | 나가는 것 |
|---|---|
| `TONE_PARTY_LOGO.png` <br> 1536×1024 · 1.26 MB · 알파 있음 | `src/client/assets/logo.webp` <br> 640×455 · 41 KiB |

## 로고를 바꿀 때

원본을 이 폴더에 덮고 아래를 돌린다. **투명 여백을 잘라내는 것이 핵심이다** —
안 자르면 CSS 가 잡은 폭 안에서 그림이 그만큼 작아 보인다.

```bash
node -e "
const s=require('sharp');
(async()=>{
  const src='design/TONE_PARTY_LOGO.png';
  const {data,info}=await s(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:W,height:H,channels:C}=info;
  let x0=W,y0=H,x1=-1,y1=-1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)
    if(data[(y*W+x)*C+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  const w=x1-x0+1,h=y1-y0+1, OW=640, OH=Math.round(h/w*OW);
  await s(src).extract({left:x0,top:y0,width:w,height:h})
    .resize(OW,OH,{kernel:'lanczos3'}).webp({quality:80,effort:6})
    .toFile('src/client/assets/logo.webp');
  console.log('logo.webp', OW+'x'+OH, '— Join.tsx 의 width/height 를 이 값으로 고쳐라');
})();"
```

**끝나면 `Join.tsx` 의 `<img width height>` 를 새 값으로 고쳐라.** 비율은 거기 한 곳에만
있고(CSS 에는 없다), 어긋나면 그림이 도착하는 순간 화면이 튄다.

`npm run build && npm run check:bundle` 로 예산도 확인한다 — 로고가 커지면 거기서 걸린다.

## 크기·품질을 그렇게 정한 이유

- **640px** — 화면에서 최대 260px 로 뜨므로 3배 화면(아이폰 Pro)까지 덮는다
- **q80** — q88·q70 과 나란히 놓고 봤지만 실제 크기에서 구분이 안 됐다.
  q70 은 3 KiB 밖에 안 아끼면서 여유만 줄여서 안 썼다
- **무손실은 쓰지 마라** — 발바닥의 부드러운 음영 때문에 오히려 **3배**(124 KiB)가 된다
