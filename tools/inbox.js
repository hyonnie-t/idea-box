#!/usr/bin/env node
// 클로드 쪽 쪽지함 도구. firebase-tools CLI(이 PC에 효니 계정으로 로그인돼 있어야 함)로 users/{주인uid}/ideas를 읽고 고친다.
//   node tools/inbox.js            안 끝난 쪽지 보기(새 쪽지 먼저). 읽었다고 표시하지는 않는다
//   node tools/inbox.js --count    숫자만 (새 N · 읽음 N)
//   node tools/inbox.js --all      끝난 것까지
//   node tools/inbox.js --done-ids 끝남 쪽지 id만(한 줄에 하나)
//   node tools/inbox.js --asks     «효니에게 물을 것»(src 칸, tools/asks.js가 올림) 열린 것 — 쪽지 목록·숫자·--save new에는 안 섞임(2026-11-18)
//   node tools/inbox.js seen <id> [<id>…]           «클로드가 읽음»으로
//   node tools/inbox.js done <id> "답장"             «끝남» + 답장(앱 카드에 말풍선으로 보임)
//   node tools/inbox.js reply <id> "답장"            답장만 달고 «읽음»으로(아직 할 일이 남았을 때)
//   node tools/inbox.js ask <id> "질문"              효니에게 물을 것: 답장 칸에 질문 + «답 필요»(ask) 켜기 + «읽음»
//        질문 쓰는 법: 물을 것이 여럿이면 «① …» «② …» 줄마다 하나, 고를 것은 줄 끝 «[가 / 나 / 다]» → 앱이 질문마다 답 칸·번호 단추를 보인다.
//        효니가 앱 «답하기»로 답하면 대화(th)에 효니 말이 쌓이고(원래 글 t는 그대로) ask가 꺼지고 «새 쪽지»로. reply/done도 ask를 끈다.
//        목록 «💬 효니가 답함» = 답장(rat) 뒤 효니 답(hat), «✍️ 효니가 답장 뒤 고침» = 답장 뒤 원래 글을 고침(ed) → 받아 두기는 둘 다 seen만
// 답하기 스레드(2026-11-18): reply/done/ask는 대화 칸 th에 클로드 말을 더하고 re·rat(마지막 말 사본)도 쓴다. 목록·show는 대화를 때 순서로 보인다.
//   node tools/inbox.js pics <id>                    그 쪽지 사진을 내려받아 파일 경로 출력(Read로 열어 보기)
//   node tools/inbox.js show <id>                    쪽지 하나 전문(사진 내려받기 포함) — 시킨 일 세션이 처음에 읽는다
// 시키기(2026-11-18): 효니가 판에서 체크하면 go(시킨 때 ms), PC 실행기(tools/runner.js)가 가져가면 run {pc, at, sid}.
//   효니가 체크할 때 고른 PC는 run {pc, at, n:'wait'}로 먼저 적히고(2026-11-18 PC 고르기), 그 PC 실행기가 가져가면 n이 실행기 표로 바뀐다.
//   done/reply/ask는 go·run을 지운다. 시킨 일에서 ask하면 again=true → 효니가 «답하기»로 답하면 앱이 go를 다시 켜 이어서 한다.
// 사진이 있는 쪽지는 목록을 볼 때 사진을 임시 폴더(%TEMP%\ideabox-pics)에 내려받아 경로를 같이 보여 준다(--no-pics면 안 받음).
// 사진 자료: users/{uid}/ideaPics/{쪽지id}/{사진키} = { s 작은 그림, b 큰 그림 } (JPEG data URL), 쪽지의 ph = [사진키…]
// 쓰기(seen/done/reply)는 상태·답장 칸만 바꾼다. 효니가 쓴 글(t)은 건드리지 않는다.
process.noDeprecation = true; // Windows에서 npx.cmd를 shell로 부를 때 나오는 경고 숨김(인자는 id 검사·따옴표로 감쌈)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const PROJECT = 'timetable-af612';
const BASE = `/users/${UID}/ideas`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// --save <파일>: 세션 시작 동기화(sync-pc.ps1)가 뒤에서 부른다. 숫자만 파일에 남기고 화면엔 아무것도 안 쓴다.
const SAVE = (() => { const i = process.argv.indexOf('--save'); return i > 0 ? process.argv[i + 1] : ''; })();
function writeSave(o) { try { fs.writeFileSync(SAVE, JSON.stringify({ ...o, at: Date.now() })); } catch (e) {} }

function fbcli(args, soft = false) {
  const r = spawnSync(NPX, ['--yes', 'firebase-tools', ...args, '--project', PROJECT], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (r.status !== 0 && soft) return null; // 사진 받기 실패는 목록을 끊지 않는다
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n');
    if (SAVE) { writeSave({ err: /login|auth|credentials/i.test(err) ? 'login' : 'fail' }); process.exit(0); }
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
// 대화 칸에 메시지 더하기(ideas/{id}/th 자리에 update — 있던 메시지는 그대로)
function patchTh(id, add) {
  if (!/^[\w-]+$/.test(id)) { console.error('쪽지 id가 이상해요:', id); process.exit(1); }
  const tmp = path.join(os.tmpdir(), `ideabox-${id}-th.json`);
  fs.writeFileSync(tmp, JSON.stringify(add));
  try { fbcli(['database:update', q(`${BASE}/${id}/th`), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); }
}
function patch(id, part) {
  if (!/^[\w-]+$/.test(id)) { console.error('쪽지 id가 이상해요:', id); process.exit(1); }
  const tmp = path.join(os.tmpdir(), `ideabox-${id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(part));
  try { fbcli(['database:update', q(`${BASE}/${id}`), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); }
}

// 사진 내려받기: 쪽지 하나의 사진을 한 번에 읽어 큰 그림을 jpg 파일로 쓴다. 반환: 파일 경로 목록
// 파일 이름에 사진키를 넣어, 이미 받은 사진은 다시 받지 않는다(사진이 바뀌면 키가 바뀜).
const PIC_DIR = path.join(os.tmpdir(), 'ideabox-pics');
function savePics(id, ph) {
  if (!/^[\w-]+$/.test(id)) return [];
  const keys = (Array.isArray(ph) ? ph : Object.values(ph || {})).filter((k) => typeof k === 'string' && /^[\w-]+$/.test(k));
  if (!keys.length) return [];
  const file = (k) => path.join(PIC_DIR, `${id}-${k}.jpg`);
  if (keys.every((k) => fs.existsSync(file(k)))) return keys.map(file);
  let all = {};
  try { all = JSON.parse((fbcli(['database:get', q(`/users/${UID}/ideaPics/${id}`)], true) || '').trim()) || {}; } catch (e) { return [`(사진을 읽지 못함 — 나중에: node tools/inbox.js pics ${id})`]; }
  fs.mkdirSync(PIC_DIR, { recursive: true });
  return keys.map((k, i) => {
    const m = /^data:image\/\w+;base64,(.+)$/.exec((all[k] && (all[k].b || all[k].s)) || '');
    if (!m) return `(사진 ${i + 1} 없음)`;
    fs.writeFileSync(file(k), Buffer.from(m[1], 'base64'));
    return file(k);
  });
}

// 답하기 스레드(2026-11-18): th = {키: {w 'c' 클로드|'h' 효니, x 글, at 때, q 질문}}. re·rat은 «클로드 마지막 말» 사본.
// th의 클로드 말 중에 re와 같은 글이 없으면(옛 쪽지, runner.js·글감 ideas.js가 re만 씀) re를 rat 자리에 끼운다 — 앱 js/app.js threadOf와 같은 식.
function threadOf(x) {
  const th = x.th && typeof x.th === 'object' ? x.th : {};
  const list = Object.entries(th).filter(([, m]) => m && typeof m.x === 'string')
    .map(([k, m]) => ({ k, w: m.w === 'h' ? 'h' : 'c', x: m.x, at: Number(m.at) || 0, q: !!m.q }));
  if (x.re && !list.some((m) => m.w === 'c' && m.x === x.re)) list.push({ k: '', w: 'c', x: String(x.re), at: Number(x.rat) || Number(x.at) || 0, q: !!x.ask, legacy: true });
  return list.sort((a, b) => a.at - b.at);
}
const msgKey = (at) => 'm' + at.toString(36) + Math.random().toString(36).slice(2, 5);
function printThread(x, pad) {
  for (const m of threadOf(x)) {
    const who = m.w === 'h' ? '💬 효니 답' : m.q ? '❓ 클로드 질문' : '↳ 클로드';
    console.log(`${pad}${who} (${when(m.at)}): ${String(m.x).replace(/\n/g, `\n${pad}   `)}`);
  }
}
const when = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// --force·--no-pics는 어디에 붙여도 선택 표시일 뿐, 답장 글이나 id로 읽지 않는다
// (2026-11-17: `done <id> --force`가 답장 칸에 «--force»를 써서 원래 답장을 덮음)
const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== '--force' && a !== '--no-pics');

if (cmd === 'seen') {
  const data = readAll();
  for (const id of rest) { if (!data[id]) { console.error('없는 쪽지:', id); continue; } if (data[id].st === 'new') patch(id, { st: 'seen' }); }
  console.log(`읽음 표시: ${rest.length}개`);
} else if (cmd === 'pics') {
  const id = rest[0];
  const data = readAll();
  if (!data[id]) { console.error('없는 쪽지:', id); process.exit(1); }
  const files = savePics(id, data[id].ph);
  console.log(files.length ? files.join('\n') : '(사진 없는 쪽지)');
} else if (cmd === 'show') {
  const id = rest[0];
  const data = readAll();
  const x = data[id];
  if (!x) { console.error('없는 쪽지:', id); process.exit(1); }
  console.log(`[${id}] ${x.st} · ${x.tag || '일반'} · ${when(x.at)}${x.hot ? ' · 🔥급함' : ''}${x.ed ? ` · 고침 ${when(x.ed)}` : ''}`);
  if (x.src) console.log(`📌 효니에게 물을 것 · 출처: ${x.src.l || ''} (교사업무/${x.src.f || '?'})${x.src.d ? `\n   답이 없으면: ${x.src.d}` : ''}`);
  console.log(x.t ? String(x.t) : '(글 없이 사진만)');
  if (x.src) console.log(x.a ? `\n✍️ 효니 답(${when(x.aat || x.ed || x.at)}): ${x.a}${x.aw ? ' — 출처 파일에 적혀 있음' : ''}` : '\n(효니 답 없음 — 시켰다면 «답이 없으면» 기본값으로)');
  for (const f of savePics(id, x.ph)) console.log('📷 ' + f);
  // 원래 글 아래 대화(클로드 답장·질문, 효니 답)를 때 순서로. 효니 답은 원래 글이 아니라 여기에 있다.
  if (threadOf(x).length) { console.log('\n— 대화 —'); printThread(x, ''); }
  if (x.ask) console.log('\n(아직 효니 답을 기다리는 중)');
} else if (cmd === 'done' || cmd === 'reply' || cmd === 'ask') {
  const id = rest[0];
  const re = (rest[1] || '').trim();
  if (cmd !== 'done' && !re) { console.error(`${cmd}에는 ${cmd === 'ask' ? '질문' : '답장'} 글이 있어야 해요`); process.exit(1); }
  const data = readAll();
  if (!data[id]) { console.error('없는 쪽지:', id); process.exit(1); }
  // 다른 세션이 이미 «끝남»으로 닫은 쪽지는 덮지 않는다(2026-11-17: 매일 받아 두기가 먼저 읽은 목록으로
  // 3분 뒤 reply를 달아 다른 세션의 done 답장을 지움). 일부러 다시 열 때만 --force.
  if (data[id].st === 'done' && !process.argv.includes('--force')) {
    console.error(`${id}: 이미 끝남(답장: ${data[id].re || '없음'}) — 덮지 않았어요. 바꾸려면 --force`);
    process.exit(2);
  }
  // 쪽지함 실행기가 연 자동 세션(IDEABOX_AUTO=1)은 «끝남»을 정하지 않는다 — 효니가 보고 확인한 뒤 앱에서 끝낸다.
  // done을 불러도 답장(seen)으로 남기고, rep(보고할 때)를 찍어 앱이 «클로드가 다 했어요» 창을 띄우게 한다
  // (2026-11-18, 출처: 효니 말 «나 확인도 안 했는데 그냥 완료됨으로 넘어가버리는데», «끝나면 나한테 보고를 해줘야 알 거 아냐 팝업을 띄우든지»)
  const auto = process.env.IDEABOX_AUTO === '1';
  if (auto && cmd === 'done') console.log('(자동 세션이라 «끝남» 대신 답장으로 남겨요. 끝내기는 효니가 앱에서)');
  // ask는 «답 필요»를 켜고, reply·done은 끈다(null = 칸 지우기)
  const part = { st: cmd === 'done' && !auto ? 'done' : 'seen', ask: cmd === 'ask' ? true : null, go: null, run: null };
  if (auto) part.rep = Date.now();
  else if (cmd === 'done') part.rep = null; // 손으로 끝내면 보고 창에서도 빠짐
  // 시킨 일(go·run)을 하다 물으면, 효니가 답할 때 앱이 다시 시키도록 표시
  part.again = cmd === 'ask' && (data[id].go || data[id].run || data[id].again) ? true : null;
  if (re) {
    const now = Date.now();
    // 대화 칸(th)에는 새 메시지만 «더한다»: ideas/{id}/th 자리에 update하면 다른 칸(그새 온 효니 답)은 그대로 남는다.
    // 옛 방식 답장(re만 있고 th에 없음)도 같이 옮긴다 — 아래에서 re를 덮어도 대화에 남게(키 m{at}r은 앱과 같음)
    const add = {};
    for (const m of threadOf(data[id])) if (m.legacy) add[`m${(m.at || now).toString(36)}r`] = { w: 'c', x: m.x, at: m.at || now, ...(m.q ? { q: true } : {}) };
    add[msgKey(now)] = { w: 'c', x: re, at: now, ...(cmd === 'ask' ? { q: true } : {}) };
    patchTh(id, add);
    Object.assign(part, { re, rat: now });
  }
  patch(id, part);
  console.log(`${id} → ${part.st}${cmd === 'ask' ? ' ❓답 필요 (질문 달음)' : re ? ' (답장 달음)' : ''}`);
  // 시간표 할 일 잇기(2026-11-23, 출처: 효니 말 «쪽지함이랑 예약 작업으로 한 일 중에 완료 체크 안 된 할일 완료», «앞으로도 연계되면 좋겠는데»):
  // 끝낸 일과 겹치는 열린 할 일을 보여 주기만 한다. 완료는 세션이 같은 일인지 보고 시간표할일.js done으로(여기서 자동으로 닫지 않음)
  if (cmd !== 'ask' && !process.argv.includes('--no-tasks')) {
    const tool = path.resolve(__dirname, '..', '..', '..', '클로드작업', '도구', '시간표할일.js');
    if (fs.existsSync(tool)) {
      const r = spawnSync(process.execPath, [tool, 'find', `${data[id].t || ''} ${re}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      const out = (r.stdout || '').trim();
      if (r.status === 0 && out.startsWith('완료 후보')) {
        console.log(`\n[시간표 할 일 ${out}`.replace('완료 후보(', '완료 후보] ('));
        console.log(`  → 이번에 다 끝낸 일과 같은 것만: node "${tool}" done <id> --why "쪽지 ${id}"`);
      }
    }
  }
} else {
  const data = readAll();
  // «효니에게 물을 것»(src 칸, tools/asks.js가 올림)은 효니 쪽지가 아니라 따로 센다 — 받아 두기·숫자에 섞이지 않게(2026-11-18)
  const every = Object.entries(data).map(([id, v]) => ({ id, ...v }));
  const asks = every.filter((x) => x.src && x.st !== 'done');
  const qa = asks.filter((x) => x.a && !x.go && !x.run).length; // 답만 오고 시키지 않은 것
  const list = every.filter((x) => !x.src);
  const n = (s) => list.filter((x) => x.st === s).length;
  if (SAVE) { writeSave({ new: n('new'), hot: list.filter((x) => x.st === 'new' && x.hot).length, seen: n('seen'), qn: asks.length, qa }); process.exit(0); }
  const qPart = asks.length ? `\n📌 효니에게 물을 것: 열림 ${asks.length}${qa ? ` · 답 온 것 ${qa}(시키지 않음 — 출처 파일의 «→ 효니 답» 줄을 보고 이어 가기)` : ''} — 자세히: node tools/inbox.js --asks` : '';
  if (cmd === '--asks') {
    for (const x of asks.sort((a, b) => (b.a ? 1 : 0) - (a.a ? 1 : 0) || a.at - b.at)) {
      console.log(`[${x.id}] ${x.a ? '✍️ 답 옴' : '❓ 답 기다림'}${x.run ? ' 🤖하는 중' : x.go ? ' 🤖시킴' : ''} · ${x.src.l || ''} (교사업무/${x.src.f})`);
      console.log('  ' + String(x.t || '').replace(/\n/g, ' ') + (x.src.d ? `\n  답이 없으면: ${x.src.d}` : ''));
      if (x.a) console.log(`  ✍️ 효니 답: ${String(x.a).replace(/\n/g, ' ')}${x.aw ? ' (파일에 적음)' : ''}`);
      console.log('');
    }
    if (!asks.length) console.log('(열린 물을 것 없음)');
    process.exit(0);
  }
  const nAsk = list.filter((x) => x.ask && x.st !== 'done').length;
  const askPart = nAsk ? ` · 답 기다림 ${nAsk}` : '';
  // 끝남 쪽지 id만 한 줄에 하나(받아 두기가 작업 현황의 💌 줄을 대조해 지울 때)
  if (cmd === '--done-ids') { console.log(list.filter((x) => x.st === 'done').map((x) => x.id).join('\n')); process.exit(0); }
  if (cmd === '--count') { console.log(`쪽지함: 새 ${n('new')} · 읽음 ${n('seen')} · 끝남 ${n('done')}${askPart}${qPart}`); process.exit(0); }
  const shown = list.filter((x) => cmd === '--all' || x.st !== 'done')
    .sort((a, b) => (a.st === 'new' ? 0 : 1) - (b.st === 'new' ? 0 : 1) || (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.at - b.at);
  console.log(`쪽지함: 새 ${n('new')} · 읽음 ${n('seen')} · 끝남 ${n('done')}${askPart}${qPart}\n`);
  for (const x of shown) {
    const nPh = (Array.isArray(x.ph) ? x.ph : Object.values(x.ph || {})).filter(Boolean).length;
    // 답장(rat) 뒤에 효니가 고친(ed) 새 쪽지 = 효니가 답했거나 덧붙임 → 받아 두기는 seen만(답장으로 덮지 않음)
    const answered = x.st === 'new' && x.re && x.ed && x.rat && x.ed > x.rat;
    // 앱 «답하기»(스레드)로 효니가 답한 새 쪽지 — 받아 두기는 위와 같이 seen만
    const replied = x.st === 'new' && x.hat && (!x.rat || x.hat > x.rat);
    const goMark = x.st === 'done' ? '' : x.run && x.run.n === 'wait' ? ` 🤖시킴(${x.run.pc || '?'}에서 할 차례)` : x.run ? ` 🤖하는 중(${x.run.pc || '?'})` : x.go ? ' 🤖시킴(PC 안 고름 — 실행기가 돌려보냄)' : x.rep ? ' 🔔다 했음(효니 확인 기다림)' : '';
    console.log(`[${x.id}] ${x.st}${goMark}${x.hot ? ' 🔥급함' : ''}${x.ask && x.st !== 'done' ? ' ❓답 기다림' : ''}${replied ? ' 💬 효니가 답함' : answered ? ' ✍️ 효니가 답장 뒤 고침' : ''} · ${x.tag || '일반'} · ${when(x.at)}${nPh ? ` · 📷 사진 ${nPh}장` : ''}`);
    console.log('  ' + (x.t ? String(x.t).replace(/\n/g, '\n  ') : '(글 없이 사진만)'));
    if (nPh) {
      if (process.argv.includes('--no-pics')) console.log(`  📷 사진 보기: node tools/inbox.js pics ${x.id}`);
      else for (const f of savePics(x.id, x.ph)) console.log('  📷 ' + f);
    }
    printThread(x, '  ');
    console.log('');
  }
  if (!shown.length) console.log('(보여 줄 쪽지 없음)');
}
