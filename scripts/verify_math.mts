/** 验证 renderMath：公式能渲染，且代码块里的 $ 不再被破坏。 */
import { renderMath } from '../src/lib/mathRender.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name} ${extra}`);
  }
}
const hasKatex = (s: string) => s.includes('class="katex');

console.log('\n[1] 围栏代码块中的 $ 必须原样保留（本次修复的核心 bug）');
const goBlock = '```go\nfmt.Println("$x + $y")\n```';
const r1 = renderMath(goBlock);
check('代码块整体未被改写', r1 === goBlock, `\n     got: ${JSON.stringify(r1)}`);
check('代码块内不含 KaTeX', !hasKatex(r1));

const mixed = '前面 $a^2$ 中间\n```python\ncost = "$100"\n```\n后面 $b$';
const r2 = renderMath(mixed);
// 每个公式产出 class="katex" 与 class="katex-html"，故用精确的 class="katex" 计数
check('代码块外的两个公式均正常渲染', (r2.match(/class="katex"/g) || []).length === 2, `count=${(r2.match(/class="katex"/g) || []).length}`);
check('代码块内 "$100" 保持原样', r2.includes('cost = "$100"'), r2);
check('代码块边界未被破坏', r2.includes('```python') && r2.includes('```'));

console.log('\n[2] 流式输出中途（代码块未闭合）');
const partial = '```python\nx = "$var"\n';
const r3 = renderMath(partial);
check('未闭合代码块内容被保护', r3 === partial && !hasKatex(r3), JSON.stringify(r3));

console.log('\n[3] 行内代码中的 $ ');
const r4 = renderMath('用 `price = "$5"` 表示');
check('行内代码不被公式化', r4 === '用 `price = "$5"` 表示', JSON.stringify(r4));

console.log('\n[4] 正常公式');
check('行内公式渲染', hasKatex(renderMath('当 $n \\to \\infty$ 时')));
check('块级公式渲染', hasKatex(renderMath('$$\\frac{a}{b}$$')));
check('块级公式带 div 容器', renderMath('$$x^2$$').includes('<div'));

console.log('\n[5] 不应误伤的内容');
// 中英混排的价格表达：朴素的 $...$ 会把 "5 和 " 当公式，必须原样保留
check('价格 $5 和 $10 不被公式化', renderMath('价格 $5 和 $10') === '价格 $5 和 $10', renderMath('价格 $5 和 $10'));
check('含中文的候选不被公式化', !hasKatex(renderMath('预算 $100 与 $200')));
check('转义 \\$ 保持原样', renderMath('\\$100').includes('\\$100'), renderMath('\\$100'));
check('空内容安全', renderMath('') === '');
check('纯数字无中文时仍可渲染', hasKatex(renderMath('区间 $[0, 1]$')));

console.log('\n[6] 缓存一致性');
check('重复渲染同一公式结果稳定', renderMath('$E=mc^2$') === renderMath('$E=mc^2$'));

console.log(`\n结果: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);