#!/usr/bin/env node
// 클로드 쪽 쪽지함 도구. firebase-tools CLI(이 PC에 효니 계정으로 로그인돼 있어야 함)로 users/{주인uid}/ideas를 읽고 고친다.
//   node tools/inbox.js            안 끝난 쪽지 보기(새 쪽지 먼저). 읽었다고 표시하지는 않는다
//   node tools/inbox.js --count    숫자만 (새 N · 읽음 N)
//   node tools/inbox.js --all      끝난 것까지
//   node tools/inbox.js seen <id> [<id>…]           «클로드가 읽음»으로
//   node tools/inbox.js done <id> "답장"             «끝남» + 답장(앱 카드에 말풍선으로 보임)
//   node tools/inbox.js reply <id> "답장"            답장만 달고 «읽음»으로(아직 할 일이 남았을 때)
// 쓰기(seen/done/reply)는 상태·답장 칸만 바꾼다. 효니가 쓴 글(t)은 건드리지 않는다.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const PROJECT = 'timetable-af612';
const BASE = `/users/${UID}/ideas`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function fbcli(args) {
  const r = spawnSync(NPX, ['--yes', 'firebase-tools', ...args, '--project', PROJECT], {
    encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n');
    console.error('firebase-tools 실패:', err);
    if (/login|auth|credentials/i.test(err)) console.error('→ 효니 터미널에서: npx firebase-tools login');
    process.exit(1);
  }
  return r.stdout;
}
const q = (s) => (process.platform === 'win32' ? `"${s}"` : s); // shell:true라 경로를 따옴표로 감싼다

function readAll() {
  const out = fbcli(['database:get', BASE]).trim();
  try { return JSON.parse(out) || {}; } catch (e) { console.error('읽은 값이 JSON이 아니에요'); process.exit(1); }
}
function patch(id, part) {
  if (!/^[\w-]+$/.test(id)) { console.error('쪽지 id가 이상해요:', id); process.exit(1); }
  const tmp = path.join(os.tmpdir(), `ideabox-${id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(part));
  try { fbcli(['database:update', q(`${BASE}/${id}`), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); }
}

const when = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'seen') {
  const data = readAll();
  for (const id of rest) { if (!data[id]) { console.error('없는 쪽지:', id); continue; } if (data[id].st === 'new') patch(id, { st: 'seen' }); }
  console.log(`읽음 표시: ${rest.length}개`);
} else if (cmd === 'done' || cmd === 'reply') {
  const [id, re] = rest;
  if (cmd === 'reply' && !re) { console.error('reply에는 답장 글이 있어야 해요'); process.exit(1); }
  const data = readAll();
  if (!data[id]) { console.error('없는 쪽지:', id); process.exit(1); }
  const part = { st: cmd === 'done' ? 'done' : 'seen' };
  if (re) Object.assign(part, { re, rat: Date.now() });
  patch(id, part);
  console.log(`${id} → ${part.st}${re ? ' (답장 달음)' : ''}`);
} else {
  const data = readAll();
  const list = Object.entries(data).map(([id, v]) => ({ id, ...v }));
  const n = (s) => list.filter((x) => x.st === s).length;
  if (cmd === '--count') { console.log(`쪽지함: 새 ${n('new')} · 읽음 ${n('seen')} · 끝남 ${n('done')}`); process.exit(0); }
  const shown = list.filter((x) => cmd === '--all' || x.st !== 'done')
    .sort((a, b) => (a.st === 'new' ? 0 : 1) - (b.st === 'new' ? 0 : 1) || (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.at - b.at);
  console.log(`쪽지함: 새 ${n('new')} · 읽음 ${n('seen')} · 끝남 ${n('done')}\n`);
  for (const x of shown) {
    console.log(`[${x.id}] ${x.st}${x.hot ? ' 🔥급함' : ''} · ${x.tag || '일반'} · ${when(x.at)}`);
    console.log('  ' + String(x.t).replace(/\n/g, '\n  '));
    if (x.re) console.log('  ↳ 클로드 답장: ' + x.re.replace(/\n/g, ' '));
    console.log('');
  }
  if (!shown.length) console.log('(보여 줄 쪽지 없음)');
}
