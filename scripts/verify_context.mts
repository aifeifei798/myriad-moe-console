/** 验证上下文滑动窗口 buildContext()。 */
import {
  buildContext,
  clampRounds,
  MIN_ROUNDS,
  MAX_ROUNDS,
  DEFAULT_ROUNDS,
  type ContextMessage,
} from '../src/lib/contextWindow.ts';

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

/** 造 n 轮 user/assistant 对话 */
function makeRounds(n: number): ContextMessage[] {
  const out: ContextMessage[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ role: 'user', content: `问题${i}` });
    out.push({ role: 'assistant', content: `回答${i}` });
  }
  return out;
}
const roles = (r: any) => r.messages.map((m: any) => `${m.role}:${m.content}`).join('|');

console.log('\n[1] 轮数钳制');
check('默认 10 轮', DEFAULT_ROUNDS === 10);
check('低于下限被抬到 MIN', clampRounds(1) === MIN_ROUNDS);
check('高于上限被压到 MAX', clampRounds(999) === MAX_ROUNDS);
check('范围内原样返回', clampRounds(12) === 12);
check('NaN 回落到默认', clampRounds(NaN) === DEFAULT_ROUNDS);
check('小数取整', clampRounds(7.6) === 8);

console.log('\n[2] 基本裁剪');
const r = buildContext(makeRounds(20), '', 10);
check('只保留最近 10 轮', r.rounds === 10, `rounds=${r.rounds}`);
check('共 20 条消息 (10 user + 10 assistant)', r.after === 20, `after=${r.after}`);
check('保留的是最新的轮次', r.messages[0].content === '问题11', `first=${r.messages[0].content}`);
check('最后一条是最新回答', r.messages[r.messages.length - 1].content === '回答20');
check('标记发生了裁剪', r.trimmed === true);
check('统计丢弃条数', r.dropped === 20, `dropped=${r.dropped}`);

console.log('\n[3] System 提示词永远保留');
const rs = buildContext(makeRounds(20), '你是数学助手', 5);
check('system 置于首条', rs.messages[0].role === 'system' && rs.messages[0].content === '你是数学助手');
check('system 不计入轮数', rs.rounds === 5, `rounds=${rs.rounds}`);
check('system 在裁剪后仍存在', rs.messages.length === 11, `len=${rs.messages.length}`);

const rsEmpty = buildContext(makeRounds(3), '   ', 10);
check('空白 system 不产生消息', rsEmpty.messages[0].role === 'user');

console.log('\n[4] 历史中的显式 system 消息也保留');
const withSys: ContextMessage[] = [{ role: 'system', content: '历史里的system' }, ...makeRounds(20)];
const rh = buildContext(withSys, '配置的system', 5);
check('两条 system 都在首部', rh.messages[0].content === '配置的system' && rh.messages[1].content === '历史里的system');
check('轮数仍为 5', rh.rounds === 5, `rounds=${rh.rounds}`);

console.log('\n[5] 不该进入上下文的消息被剔除');
const dirty: ContextMessage[] = [
  { role: 'user', content: '真实问题' },
  { role: 'assistant', content: '真实回答' },
  { role: 'assistant', content: '❌ 生成失败：xxx', excludeFromContext: true },
  { role: 'assistant', content: '' },                        // 被中断的生成
  { role: 'assistant', content: '半句', isStreaming: true }, // 仍在流式
  { role: 'assistant', content: '/stats 表格回显', excludeFromContext: true },
];
const rd = buildContext(dirty, '', 10);
check('本地提示被剔除', !roles(rd).includes('生成失败'));
check('空回复被剔除', rd.messages.every((m: any) => m.content.length > 0), roles(rd));
check('流式占位被剔除', !roles(rd).includes('半句'));
check('指令回显被剔除', !roles(rd).includes('表格回显'));
check('真实对话保留', roles(rd) === 'user:真实问题|assistant:真实回答', roles(rd));

console.log('\n[6] 边界情况');
const empty = buildContext([], '', 10);
check('空历史安全', empty.messages.length === 0 && empty.after === 0);
check('空历史 trimmed=false', empty.trimmed === false);

const one = buildContext([{ role: 'user', content: '只有问题' } as ContextMessage], '', 10);
check('只有 user 无 assistant 也保留', one.after === 1);

// 裁剪后可能剩下孤立的 assistant（其 user 被丢弃）——不应发生
const orphanRisk: ContextMessage[] = [{ role: 'assistant', content: '孤儿回答' }, ...makeRounds(20)];
const ro = buildContext(orphanRisk, '', 5);
check('不产生孤立 assistant 开头', ro.messages[0].role !== 'assistant', roles(ro).slice(0, 40));

console.log('\n[7] 不裁剪的情况');
const small = buildContext(makeRounds(3), '', 10);
check('短历史不触发裁剪', small.trimmed === false, `trimmed=${small.trimmed}`);
check('短历史轮数正确', small.rounds === 3);
check('短历史 dropped=0', small.dropped === 0);

console.log('\n[8] prompt 长度确实被压住（防 KV 缓存爆掉的实际目的）');
const big = buildContext(makeRounds(60), 'sys', 10);
const chars = big.messages.reduce((a: number, m: any) => a + m.content.length, 0);
const fullChars = makeRounds(60).reduce((a, m: any) => a + m.content.length, 0);
check('发送字符数远小于全量历史', chars < fullChars / 5, `${chars} vs ${fullChars}`);

console.log(`\n结果: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);