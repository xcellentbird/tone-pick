/**
 * 소스를 훑어 문자열 리터럴과 (주석·문자열을 뺀) 코드를 줄 번호와 함께 모은다.
 * `check-copy.mjs` 와 `check-korean.mjs` 가 같이 쓴다 — 토크나이저를 두 벌 두면 언젠가 한쪽만 고친다.
 */
export function scan(text) {
  const strings = [];
  const code = [];
  let line = 1;
  let i = 0;
  // 템플릿 리터럴 안의 ${} 를 코드로 되돌리기 위한 스택
  const stack = [];
  let state = "code";
  let quote = "";
  let buf = "";
  let bufLine = 1;

  const flush = (into) => {
    if (buf.trim()) into.push({ line: bufLine, text: buf });
    buf = "";
  };

  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "\n") line++;

    if (state === "code") {
      if (c === "/" && n === "/") { flush(code); state = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { flush(code); state = "block"; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") {
        flush(code);
        state = "str"; quote = c; bufLine = line; i++; continue;
      }
      if (c === "}" && stack.length) {           // 템플릿 표현식 끝
        flush(code);
        state = "str"; quote = stack.pop(); bufLine = line; i++; continue;
      }
      if (!buf) bufLine = line;
      buf += c; i++; continue;
    }

    if (state === "line") { if (c === "\n") state = "code"; i++; continue; }
    if (state === "block") { if (c === "*" && n === "/") { state = "code"; i += 2; continue; } i++; continue; }

    if (state === "str") {
      if (c === "\\") { buf += text.slice(i, i + 2); i += 2; continue; }
      if (quote === "`" && c === "$" && n === "{") {  // 템플릿 표현식 시작
        flush(strings);
        stack.push(quote); state = "code"; bufLine = line; i += 2; continue;
      }
      if (c === quote) { flush(strings); state = "code"; i++; continue; }
      buf += c; i++; continue;
    }
  }
  flush(state === "str" ? strings : code);
  return { strings, code };
}

/** 그 줄이나 바로 윗줄에 표식이 있으면 건너뛴다 (`copy-ok` · `korean-ok`). 줄 번호는 1부터다 */
export const markedBy = (lines, marker) => (ln) => [lines[ln - 1], lines[ln - 2]].some((l) => l && l.includes(marker));
