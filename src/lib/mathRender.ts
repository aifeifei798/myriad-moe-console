/**
 * Markdown 中的 $...$ / $$...$$ → KaTeX HTML。
 *
 * 单独成模块的原因：这段逻辑有真实的状态（公式缓存 + 代码段哨兵），
 * 放在 .tsx 里无法被单元测试覆盖（node 无法 strip JSX）。
 */
import katex from 'katex';

/** KaTeX 渲染结果缓存，避免流式输出时同一公式被反复编译。 */
const katexCache = new Map<string, string>();

function renderKatex(math: string, displayMode: boolean): string | null {
  const key = `${displayMode ? 'D' : 'I'}:${math}`;
  const hit = katexCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const html = katex.renderToString(math, { displayMode, throwOnError: false });
    // 流式场景下公式种类有限，缓存不会无限增长
    if (katexCache.size > 500) katexCache.clear();
    katexCache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

const CODE_SENTINEL_OPEN = '\u0000CODE';
const CODE_SENTINEL_CLOSE = '\u0000';

/**
 * 候选「公式」里出现 CJK 字符时判定为非公式。
 *
 * 真实场景里 `价格 $5 和 $10`、`预算 $100 与 $200` 这类中英混排极其常见，
 * 朴素的 `$...$` 正则会把 `5 和 ` 当成公式渲染（实测会输出
 * "LaTeX-incompatible input" 警告，并把中文吞进公式里）。
 * LaTeX 公式几乎不会含中日文，因此以此作为拒绝判据。
 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 看起来像公式才渲染，否则原样返回（避免破坏普通文本）。 */
function tryRender(math: string, displayMode: boolean): string | null {
  const trimmed = math.trim();
  if (!trimmed) return null;
  if (CJK.test(trimmed)) return null;
  return renderKatex(trimmed, displayMode);
}

/**
 * 关键点：**必须先保护代码块与行内代码**。
 *
 * 之前的实现直接对原始 markdown 做正则，于是
 *   ```go
 *   fmt.Println("$x")
 *   ```
 * 里的 `$x` 会被当成行内公式替换掉，代码直接被破坏。
 */
export function renderMath(text: string): string {
  // 用哨兵把代码段抠出来，公式处理完再原样放回
  const stash: string[] = [];
  const protect = (raw: string) => {
    stash.push(raw);
    return `${CODE_SENTINEL_OPEN}${stash.length - 1}${CODE_SENTINEL_CLOSE}`;
  };

  let processed = text
    // 围栏代码块 ``` ... ```（含 ```lang 与裸 ```）
    .replace(/```[\s\S]*?```/g, protect)
    // 流式输出中途代码块尚未闭合：保护到文末，避免半截代码被公式化
    .replace(/```[\s\S]*$/, protect)
    // 行内代码 `...`
    .replace(/`[^`\n]*`/g, protect);

  // 块级公式 $$...$$
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_all, math: string) => {
    const html = tryRender(math, true);
    if (html === null) return `$$${math}$$`;
    return `<div class="my-3 py-2 px-3 overflow-x-auto bg-[#0d121d] border border-cyan-950/60 rounded-md text-cyan-200">${html}</div>`;
  });

  // 行内公式 $...$：不跨行、不匹配被转义的 \$、不误吞 $$
  processed = processed.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, (_all, math: string) => {
    const html = tryRender(math, false);
    if (html === null) return `$${math}$`;
    return html;
  });

  // 还原代码段
  return processed.replace(
    new RegExp(`${CODE_SENTINEL_OPEN}(\\d+)${CODE_SENTINEL_CLOSE}`, 'g'),
    (_all, i: string) => stash[Number(i)] ?? '',
  );
}