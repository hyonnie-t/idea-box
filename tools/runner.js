#!/usr/bin/env node
// 쪽지함 «시키기» 실행기(2026-11-18, 출처: 효니 말 «그냥 내가 필요할 때 체크하면 네가 시작하면 좋겠는데»).
// 효니가 할 일 판에서 쪽지를 체크하면 쪽지에 go(시킨 때)가 생긴다. 이 실행기가 1분마다 보고, 그 쪽지를 가져가
// 이 PC에서 클로드 세션(claude -p, auto 권한)을 하나 연다. 세션이 쪽지를 읽고 일을 한 뒤 inbox.js done/reply/ask로 답장한다.
//   node tools/runner.js            계속 돈다(sync-pc.ps1이 세션 시작 때 창 없이 켬, 이미 돌면 그냥 끝남)
//   node tools/runner.js --once     한 번만 보고 끝(시험용) / --dry 가져가지 않고 무엇을 할지만 출력
// 쪽지 칸: go 시킨 때(ms, 앱이 씀) · run {pc, at, n, sid} 하는 중(이 실행기가 씀) · sid/spc 마지막 세션 id·PC(이어서 할 때 --resume)
// 여러 PC가 같이 돌아도 한 번만 하게: run에 내 표(n)를 쓰고 몇 초 뒤 다시 읽어 내 표일 때만 시작한다.
// 한 PC에서 한 번에 하나만 한다. 세션이 답장 없이 끝나면 클로드 마지막 말을 답장으로 남기고 go를 끈다(효니가 다시 체크하면 이어서).
process.noDeprecation = true;
const { spawnSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const PROJECT = 'timetable-af612';
const BASE = `/users/${UID}/ideas`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const PC = process.env.COMPUTERNAME || os.hostname();
const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const EVERY = 60e3;
const STALE = 4 * 3600e3; // 다른 PC의 «하는 중»이 이만큼 지나면 멈춘 것으로 본다
const LIMIT = 2 * 3600e3; // 세션 하나가 이보다 길면 끈다

// 교사업무 폴더: 이 파일은 교사업무\웹앱\idea-box\tools
function findRoot() {
  const cands = [path.resolve(__dirname, '../../..'), path.join(process.env.OneDriveCommercial || '', '교사업무'),
    'C:\\Users\\alfzl\\OneDrive - 대영중학교\\교사업무', 'D:\\OneDrive - 대영중학교\\교사업무'];
  return cands.find((p) => p && fs.existsSync(path.join(p, 'CLAUDE.md')) && fs.existsSync(path.join(p, '웹앱', 'idea-box'))) || cands[0];
}
const ROOT = findRoot();
const INBOX = path.join(ROOT, '웹앱', 'idea-box', 'tools', 'inbox.js');
const LOG_DIR = path.join(ROOT, '클로드작업', '산출물', '_자동', '쪽지함-시키기');
function log(msg) {
  const d = new Date();
  const line = `${d.toTimeString().slice(0, 8)} [${PC}] ${msg}`;
  if (ONCE || DRY) console.log(line);
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, `${d.toISOString().slice(0, 10)}_${PC}.log`), line + '\n'); } catch (e) {} // PC마다 따로(OneDrive 충돌 사본 막기)
}

// 한 PC에 실행기는 하나만(잠금 파일의 pid가 살아 있으면 끝)
const LOCK = path.join(os.tmpdir(), 'ideabox-runner.lock');
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); return false; } catch (e) {} }
  } catch (e) {}
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}

function fbcli(args) {
  const r = spawnSync(NPX, ['--yes', 'firebase-tools', ...args, '--project', PROJECT], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' '));
  return r.stdout;
}
const q = (s) => (process.platform === 'win32' ? `"${s}"` : s);
const readAll = () => JSON.parse(fbcli(['database:get', BASE]).trim() || 'null') || {};
const readOne = (id) => JSON.parse(fbcli(['database:get', q(`${BASE}/${id}`)]).trim() || 'null');
function patch(id, part) {
  if (!/^[\w-]+$/.test(id)) throw new Error('쪽지 id가 이상해요: ' + id);
  const tmp = path.join(os.tmpdir(), `ideabox-run-${id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(part));
  try { fbcli(['database:update', q(`${BASE}/${id}`), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (s) => (String(s || '').split('\n').find((l) => l.trim()) || '').trim();

function prompt(id, resumed) {
  const inbox = 'node 웹앱/idea-box/tools/inbox.js';
  return [
    resumed ? `효니가 쪽지 ${id}에 답하고 다시 시켰어요. 이어서 해 주세요.` : `효니가 클로드 쪽지함 «할 일 판»에서 체크해 클로드에게 시킨 일이에요. 쪽지 id: ${id}`,
    '',
    `1. \`${inbox} show ${id}\` 로 쪽지 전문(효니 답·앞선 클로드 답장 포함)을 읽는다. 사진 경로가 나오면 Read로 본다.`,
    '2. 교사업무 CLAUDE.md와 관련 레포 CLAUDE.md 규칙대로 끝까지 한다. 효니는 자리에 없다고 보고 묻지 않는다: 되돌릴 수 있는 일은 기본값으로 진행한다.',
    `3. 학생 기록 등록·문자·메일 발송·나이스 상신·지우기·강제 푸시·결제·공개 게시처럼 되돌리기 어려운 일, 효니만 정할 수 있는 일은 하지 않는다. 미리보기·초안까지 만든 뒤 \`${inbox} ask ${id} "질문(쉬운 말, 고를 것이 있으면 번호로)"\` 로 묻고 끝낸다.`,
    `4. 다 하면 \`${inbox} done ${id} "한 일 한두 줄(쉬운 말, 만든 파일·주소 포함)"\`. 다 못 했으면 \`${inbox} reply ${id} "한 것 · 남은 것"\`. 답장은 효니가 폰에서 읽는다.`,
    '6. 이 세션은 쪽지함이 연 자동 세션이다: 첫 응답 머릿말·사이드바 정리·결과 보고 페이지는 하지 않고, 결과는 쪽지 답장으로만 남긴다.',
    `5. 클로드작업/작업 현황.md «⏳ 열린 일»에 이 쪽지 id가 든 💌 줄이 있으면 done 때 그 줄을 지운다(여러 id를 묶은 줄이면 이 id만 빼기).`,
  ].join('\n');
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true; // 읽기·가져가기 동안 다음 tick이 끼어들지 않게. 세션을 열면 끝날 때 풂
  let started = false;
  try { started = await step(); } finally { if (!started) busy = false; }
}
async function step() {
  let all;
  try { all = readAll(); } catch (e) { log('읽기 실패: ' + e.message.slice(0, 160)); return; }
  const now = Date.now();
  // 이 PC가 맡았는데 지금 안 돌고 있는 일(실행기·PC가 꺼졌다 켜짐) → 멈췄다고 알리고 내려놓기
  for (const [id, x] of Object.entries(all)) {
    const stale = x.run && (x.run.pc === PC || now - (x.run.at || 0) > STALE);
    if (stale && x.st !== 'done' && !DRY) {
      log(`${id} 멈춘 일 내려놓음(맡은 PC ${x.run.pc})`);
      try { patch(id, { run: null, go: null, st: 'seen', re: `중간에 멈췄어요(${x.run.pc} PC가 꺼졌거나 끊김). 다시 체크하면 다시 할게요.`, rat: now }); } catch (e) {}
    }
  }
  const todo = Object.entries(all).filter(([, x]) => x.go && !x.run && x.st !== 'done').sort((a, b) => a[1].go - b[1].go);
  if (!todo.length) return;
  const [id, x] = todo[0];
  if (DRY) { log(`(dry) 할 일: ${id} «${firstLine(x.t).slice(0, 40)}»`); return; }
  // 가져가기: 내 표를 쓰고 몇 초 뒤 다시 읽어 확인(다른 PC와 겹치지 않게)
  const n = crypto.randomBytes(4).toString('hex');
  const resume = x.sid && x.spc === PC;
  const sid = resume ? x.sid : crypto.randomUUID();
  try {
    const pre = readOne(id); // 쓰기 직전에 한 번 더: 그새 다른 PC가 가져갔으면 손대지 않음
    if (!pre || pre.run || !pre.go || pre.st === 'done') { log(`${id} 그새 바뀜 — 건너뜀`); return; }
    // st new → seen: 받아 두기(ideabox-collect)가 «새 쪽지»로 보고 reply로 덮지 않게
    patch(id, { run: { pc: PC, at: Date.now(), n, sid }, ...(pre.st === 'new' ? { st: 'seen' } : {}) });
    await sleep(10000 + Math.random() * 5000);
    const back = readOne(id);
    if (!back || back.run?.n !== n) { log(`${id} 다른 PC가 가져감`); return; }
    if (!back.go) { log(`${id} 그새 효니가 체크를 풂`); patch(id, { run: null }); return; }
  } catch (e) { log(`${id} 가져가기 실패: ${e.message.slice(0, 160)}`); return; }
  log(`${id} 시작 «${firstLine(x.t).slice(0, 40)}» 세션 ${sid}${resume ? ' (이어서)' : ''}`);
  const args = ['-p', prompt(id, resume), '--permission-mode', 'auto', '--output-format', 'json',
    '-n', `💌 ${firstLine(x.t).slice(0, 24) || '쪽지 ' + id}`, ...(resume ? ['--resume', sid] : ['--session-id', sid])];
  const child = spawn('claude', args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => { err += String(e); });
  // 2시간이 넘으면 멈춘 것으로 보고 끈다(실행기가 영원히 붙잡히지 않게)
  const killer = setTimeout(() => { err += ' 2시간 넘어 끔'; try { child.kill(); } catch (e) {} }, LIMIT);
  child.on('close', (code) => {
    clearTimeout(killer);
    busy = false;
    let result = '';
    try { result = JSON.parse(out).result || ''; } catch (e) { result = out.trim().slice(-400); }
    log(`${id} 끝(코드 ${code})${err ? ' 오류: ' + err.trim().slice(-200) : ''}`);
    try {
      const after = readOne(id);
      if (after && after.st === 'done') patch(id, { run: null, go: null, sid, spc: PC }); // 효니가 그새 «끝남»으로 닫음 → 상태는 그대로
      else if (after && after.run?.n === n) {
        // 세션이 inbox.js로 답장을 남기지 않음 → 마지막 말을 답장으로 남기고 내려놓기
        const re = code === 0 && result ? `(답장을 못 남겨서 대신 적어요) ${result.slice(0, 600)}` : `하다가 멈췄어요(코드 ${code}). 다시 체크하면 이어서 할게요.`;
        patch(id, { run: null, go: null, st: 'seen', re, rat: Date.now(), sid, spc: PC });
      } else if (after) patch(id, { sid, spc: PC });
    } catch (e) { log(`${id} 마무리 쓰기 실패: ${e.message.slice(0, 160)}`); }
    if (ONCE) process.exit(0);
    setTimeout(tick, 2000); // 줄 선 다음 일
  });
  return true;
}

(async () => {
  if (!DRY && !takeLock()) { if (ONCE) console.log('이 PC에서 실행기가 이미 돌고 있어요'); return; } // 이미 도는 중
  log(`실행기 켜짐 (${ROOT})`);
  await tick();
  if (ONCE || DRY) { if (!busy) process.exit(0); return; }
  setInterval(tick, EVERY);
})();
