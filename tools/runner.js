#!/usr/bin/env node
// 쪽지함 «시키기» 실행기(2026-11-18, 출처: 효니 말 «그냥 내가 필요할 때 체크하면 네가 시작하면 좋겠는데»).
// 효니가 할 일 판에서 쪽지를 체크하면 쪽지에 go(시킨 때)가 생긴다. 이 실행기가 1분마다 보고, 그 쪽지를 가져가
// 이 PC에서 클로드 세션(claude -p, auto 권한)을 하나 연다. 세션이 쪽지를 읽고 일을 한 뒤 inbox.js done/reply/ask로 답장한다.
//   node tools/runner.js            계속 돈다(sync-pc.ps1이 세션 시작 때 창 없이 켬, 이미 돌면 그냥 끝남)
//   node tools/runner.js --once     한 번만 보고 끝(시험용) / --dry 가져가지 않고 무엇을 할지만 출력
// 쪽지 칸: go 시킨 때(ms, 앱이 씀) · run {pc, at, n, sid} 하는 중(이 실행기가 씀) · sid/spc 마지막 세션 id·PC(이어서 할 때 --resume)
// PC 고르기(2026-11-18 오후, 출처: 효니 말 «왜 켜진 컴퓨터 말고 학교 PC가 가져갔냐», «차라리 나한테 물어보는 게 낫지않냐»):
//   앱이 체크할 때 «어느 PC에서 할까요?»를 묻고 go와 함께 run {pc, at, n:'wait'}를 적는다 → 그 PC 실행기만 가져간다.
//   실행기는 1분마다 users/{uid}/ideaRunners/{PC} = {at, ok, why} 켜짐 신호를 쓴다(앱이 켜진 PC만 고르게). claude를 못 여는 PC는 가져가지 않는다.
//   go만 있고 run이 없는 쪽지(옛 화면, spc 없는 답하기)는 예전처럼 먼저 본 PC가(쓰는 PC 먼저) 가져간다.
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

// 한 PC에 실행기는 하나만. 잠금 파일은 «없을 때만 만들기»(wx)로 잡는다 — 읽고 나서 쓰면 같은 순간에 켜진 둘이 다 잡는다
// (2026-11-18 학교 PC: 같은 초에 둘이 켜져, 하나가 연 일을 다른 하나가 «멈췄어요»로 꺼 버림).
// 잠금이 살아 있다 = 그 pid가 살아 있고 5분 안에 손댄 흔적이 있다(실행기는 1분마다 잠금 파일 시각을 새로 찍는다).
// pid만 보면 재부팅 뒤 같은 번호를 다른 프로그램이 쓰고 있을 때 실행기가 영영 안 켜진다.
const LOCK = path.join(os.tmpdir(), 'ideabox-runner.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lockPid = () => { try { return Number(fs.readFileSync(LOCK, 'utf8')) || 0; } catch (e) { return 0; } };
function takeLock() {
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; } catch (e) {}
    const pid = lockPid();
    if (pid === process.pid) return true;
    let fresh = false;
    try { fresh = Date.now() - fs.statSync(LOCK).mtimeMs < 5 * 60e3; } catch (e) {}
    if (pid && fresh && alive(pid)) return false;
    try { fs.rmSync(LOCK, { force: true }); } catch (e) {}
  }
  return false;
}
const touchLock = () => { try { const t = new Date(); fs.utimesSync(LOCK, t, t); } catch (e) {} };

// 잠금을 잡은 뒤, 이 PC에 남은 다른 실행기(잠금을 안 보는 2026-11-18 오전 판)를 끈다. 새 판은 잠금이 남의 것이면 스스로 끝나므로
// 여기서 걸리는 것은 옛 판뿐이다. 옛 판이 살아 있으면 새 판이 연 일을 «멈췄어요»로 꺼 버린다.
function killOldRunners() {
  if (process.platform !== 'win32') return;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'idea-box.tools.runner\\.js' -and $_.CommandLine -notmatch '--(dry|once)' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const ids = (r.stdout || '').trim().split(/\s+/).filter((s) => /^\d+$/.test(s));
    if (ids.length) log(`옛 실행기 ${ids.length}개 끔(pid ${ids.join(', ')})`);
  } catch (e) {}
}

// 이 PC에서 claude를 열 수 있나(세션을 열 때와 같은 방식으로 불러 본다). 못 열면 쪽지를 가져가지 않고, 앱 PC 창에도 못 고르게 뜬다.
// 2026-11-18 학교 PC가 쪽지를 가져간 뒤 `spawn claude ENOENT`로 바로 멈춘 일에서.
let canRun = { ok: false, why: '아직 확인 전', at: 0 };
function checkClaude() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  canRun = r.error || r.status !== 0
    ? { ok: false, why: r.error && r.error.code === 'ENOENT' ? 'claude 명령을 찾지 못해요' : 'claude가 열리지 않아요', at: Date.now() }
    : { ok: true, why: '', at: Date.now() };
  return canRun;
}

// 이 PC를 효니가 마지막으로 만진 지 몇 ms(Windows만, 못 재면 0 = 쓰는 중으로 봄)
function idleMs() {
  if (process.platform !== 'win32') return 0;
  const ps = `Add-Type @'
using System;using System.Runtime.InteropServices;
public class IdleT{[StructLayout(LayoutKind.Sequential)]public struct L{public uint s;public uint t;}
[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref L l);
public static uint Ms(){L l=new L();l.s=(uint)Marshal.SizeOf(l);GetLastInputInfo(ref l);return (uint)Environment.TickCount-l.t;}}
'@
[IdleT]::Ms()`;
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const n = Number((r.stdout || '').trim().split(/\s+/).pop());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) { return 0; }
}
const IDLE = 5 * 60e3; // 이만큼 안 만졌으면 «쉬는 PC»
const YIELD = 90e3; // 쉬는 PC가 쓰는 PC에 양보하는 시간(쓰는 PC가 1분 뒤에야 볼 수도 있고, 표를 쓰기까지 20~30초 걸림)

// 실행기 파일이 바뀌면(OneDrive로 새 판이 옴) 일이 없을 때 스스로 새 판으로 다시 켠다 — 한번 켜지면 며칠씩 도는 프로그램이라
const SELF_M = (() => { try { return fs.statSync(__filename).mtimeMs; } catch (e) { return 0; } })();
function restartIfChanged() {
  let m = SELF_M;
  try { m = fs.statSync(__filename).mtimeMs; } catch (e) { return; }
  if (m === SELF_M || Date.now() - m < 60e3) return; // 막 바뀐 파일은 다 내려올 때까지 한 번 더 기다림
  if (spawnSync(process.execPath, ['--check', __filename], { windowsHide: true }).status !== 0) return; // 덜 내려온 파일이면 그대로 돈다
  log('실행기 파일이 바뀌어 새 판으로 다시 켬');
  try { fs.rmSync(LOCK, { force: true }); } catch (e) {}
  spawn(process.execPath, [__filename], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
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
// 켜짐 신호. PC 이름(한글일 수 있음)을 명령줄에 넣지 않으려고 윗칸에 { PC: … }로 쓴다.
// 일하는 중에도 찍히게 tick과 따로 돈다(안 그러면 바쁜 PC가 앱에 «꺼져 있어요»로 뜬다).
function beat() {
  if (Date.now() - canRun.at > 10 * 60e3) { const was = canRun.ok; checkClaude(); if (was !== canRun.ok) log(canRun.ok ? 'claude 열 수 있음' : `claude 못 엶: ${canRun.why}`); }
  const tmp = path.join(os.tmpdir(), 'ideabox-run-beat.json');
  try {
    fs.writeFileSync(tmp, JSON.stringify({ [PC]: { at: Date.now(), ok: canRun.ok, why: canRun.why || null } }));
    fbcli(['database:update', `/users/${UID}/ideaRunners`, q(tmp), '--force']);
  } catch (e) { log('켜짐 신호 실패: ' + e.message.slice(0, 160)); } finally { fs.rmSync(tmp, { force: true }); }
}
const isWait = (x) => !!x.run && x.run.n === 'wait'; // 앱이 «이 PC에서 해 줘»라고 적어 둔 것(아직 아무도 안 가져감)
// 내 일: 효니가 이 PC를 고른 쪽지, 또는 PC를 안 고른 옛 방식(go만 있음)
const mine = (x) => !!x && !!x.go && x.st !== 'done' && (isWait(x) ? x.run.pc === PC : !x.run);
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
let myN = ''; // 이 실행기가 지금 돌리는 일의 표
async function tick() {
  if (!DRY) touchLock();
  if (busy) return;
  if (!ONCE && !DRY) { if (lockPid() !== process.pid) { log('잠금이 다른 실행기 것이라 끝냄'); process.exit(0); } restartIfChanged(); }
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
    if (isWait(x)) {
      // 효니가 고른 PC가 4시간 넘게 안 가져감(꺼져 있음) → 알리고 내려놓기. 그 전엔 그대로 둔다(하는 중인 run이 아님)
      if (now - (x.run.at || 0) > STALE && x.st !== 'done' && !DRY) {
        log(`${id} 고른 PC(${x.run.pc})가 안 가져감 — 내려놓음`);
        try { patch(id, { run: null, go: null, st: 'seen', re: `${x.run.pc} PC가 시작하지 못했어요(꺼져 있거나 클로드를 못 엶). 다시 체크해서 켜진 PC를 골라 주세요.`, rat: now }); } catch (e) {}
      }
      continue;
    }
    // 이 PC 것: 내가 돌리는 일도 아니고, 그 일을 연 실행기(run.rp)도 죽었을 때만. 다른 PC 것: 4시간 넘었을 때
    // (세션 제한 2시간+10분이 넘은 run은 pid가 살아 있어도 멈춘 것 — 재부팅 뒤 같은 pid를 다른 프로그램이 쓸 수 있다)
    const tooOld = x.run && now - (x.run.at || 0) > LIMIT + 10 * 60e3;
    const mineDead = x.run && x.run.pc === PC && x.run.n !== myN && (tooOld || !(x.run.rp && x.run.rp !== process.pid && alive(x.run.rp)));
    const stale = x.run && (x.run.pc === PC ? mineDead : now - (x.run.at || 0) > STALE);
    if (stale && x.st !== 'done' && !DRY) {
      log(`${id} 멈춘 일 내려놓음(맡은 PC ${x.run.pc})`);
      try { patch(id, { run: null, go: null, st: 'seen', re: `중간에 멈췄어요(${x.run.pc} PC가 꺼졌거나 끊김). 다시 체크하면 다시 할게요.`, rat: now }); } catch (e) {}
    }
  }
  const todo = Object.entries(all).filter(([, x]) => mine(x)).sort((a, b) => a[1].go - b[1].go);
  if (!todo.length) return;
  const [id, x] = todo[0];
  if (DRY) { log(`(dry) 할 일: ${id} «${firstLine(x.t).slice(0, 40)}»${isWait(x) ? ' (효니가 이 PC를 고름)' : ''}${canRun.ok ? '' : ` — 못 가져감(${canRun.why})`}`); return; }
  if (!canRun.ok) { if (Date.now() - canRun.at > 5 * 60e3) checkClaude(); if (!canRun.ok) { log(`${id} 건너뜀: ${canRun.why}`); return; } }
  // 가져가기: 내 표를 쓰고 몇 초 뒤 다시 읽어 확인(다른 PC와 겹치지 않게)
  const n = crypto.randomBytes(4).toString('hex');
  const resume = x.sid && x.spc === PC;
  const sid = resume ? x.sid : crypto.randomUUID();
  try {
    // 쓰는 PC 먼저(2026-11-18, 출처: 효니 말 «학교 PC로 갔다는데 왜 글로 가?»): 효니가 5분 넘게 안 만진 PC는 90초 기다렸다가 본다.
    // 그 사이 효니가 쓰고 있는 PC가 가져가면 아래 «그새 바뀜»으로 물러난다. 쓰는 PC가 없으면 쉬는 PC가 한다.
    const idle = isWait(x) ? 0 : idleMs(); // 효니가 이 PC를 골랐으면 양보하지 않는다
    if (idle > IDLE) { log(`${id} 이 PC는 쉬는 중(${Math.round(idle / 60e3)}분) — 쓰는 PC에 90초 양보`); await sleep(YIELD); }
    const pre = readOne(id); // 쓰기 직전에 한 번 더: 그새 다른 PC가 가져갔으면 손대지 않음
    if (!mine(pre)) { log(`${id} 그새 바뀜 — 건너뜀`); return; }
    // st new → seen: 받아 두기(ideabox-collect)가 «새 쪽지»로 보고 reply로 덮지 않게
    myN = n;
    patch(id, { run: { pc: PC, at: Date.now(), n, sid, rp: process.pid }, ...(pre.st === 'new' ? { st: 'seen' } : {}) });
    await sleep(10000 + Math.random() * 5000);
    const back = readOne(id);
    if (!back || back.run?.n !== n) { log(`${id} 다른 PC가 가져감`); return; }
    if (!back.go) { log(`${id} 그새 효니가 체크를 풂`); patch(id, { run: null }); return; }
  } catch (e) { myN = ''; log(`${id} 가져가기 실패: ${e.message.slice(0, 160)}`); return; } // myN을 비워야 쓰다 만 내 run을 다음 tick이 내려놓는다
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
    myN = '';
    let result = '';
    try { result = JSON.parse(out).result || ''; } catch (e) { result = out.trim().slice(-400); }
    log(`${id} 끝(코드 ${code})${err ? ' 오류: ' + err.trim().slice(-200) : ''}`);
    try {
      const after = readOne(id);
      if (after && after.st === 'done') patch(id, { run: null, go: null, sid, spc: PC }); // 효니가 그새 «끝남»으로 닫음 → 상태는 그대로
      else if (after && after.run?.n === n) {
        // 세션이 inbox.js로 답장을 남기지 않음 → 마지막 말을 답장으로 남기고 내려놓기
        // 세션을 열지도 못한 경우(claude 없음)는 그대로 말한다 — «PC가 꺼졌다»로 잘못 알리지 않게. 세션이 없으니 sid·spc도 남기지 않는다(다음에 없는 세션을 --resume하지 않게)
        const noStart = /ENOENT/.test(err);
        if (noStart) canRun = { ok: false, why: 'claude 명령을 찾지 못해요', at: Date.now() };
        const re = code === 0 && result ? `(답장을 못 남겨서 대신 적어요) ${result.slice(0, 600)}`
          : noStart ? `${PC} PC에서 클로드를 열지 못해 시작하지 못했어요. 다시 체크해서 다른 PC를 골라 주세요.`
            : `하다가 멈췄어요(코드 ${code}). 다시 체크하면 이어서 할게요.`;
        patch(id, { run: null, go: null, st: 'seen', re, rat: Date.now(), ...(noStart ? {} : { sid, spc: PC }) });
      } else if (after) patch(id, { sid, spc: PC });
    } catch (e) { log(`${id} 마무리 쓰기 실패: ${e.message.slice(0, 160)}`); }
    if (ONCE) process.exit(0);
    setTimeout(tick, 2000); // 줄 선 다음 일
  });
  return true;
}

(async () => {
  if (!DRY && !takeLock()) { if (ONCE) console.log('이 PC에서 실행기가 이미 돌고 있어요'); return; } // 이미 도는 중
  if (!DRY) { await sleep(400 + Math.random() * 600); if (lockPid() !== process.pid) return; } // 같은 순간에 켜진 다른 실행기가 잠금을 가져갔으면 물러남
  if (!DRY && !ONCE) killOldRunners();
  checkClaude();
  log(`실행기 켜짐 (${ROOT})${canRun.ok ? '' : ` — ${canRun.why}, 쪽지를 가져가지 않아요`}`);
  if (!DRY) beat();
  await tick();
  if (ONCE || DRY) { if (!busy) process.exit(0); return; }
  setInterval(tick, EVERY);
  setInterval(beat, EVERY);
})();
