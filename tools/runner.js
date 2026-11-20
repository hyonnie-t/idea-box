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
// «효니에게 물을 것»(2026-11-18): 켜질 때와 10분마다 tools/asks.js로 계획·작업 목록의 물을 것을 올리고 효니 답을 출처 파일에 적는다.
//   물을 것(src 칸)을 시키면 그 출처 파일에서 이어 가라는 지시문으로 세션을 연다.
// 한 PC에서 한 번에 2개(MAX)까지 한다(2026-11-18 밤, 출처: 효니 말 «2개씩은 되야할 거 같은데»). 켜짐 신호에 지금 도는 수(busy)·상한(max)도 적는다.
// 세션이 답장 없이 끝나면 클로드 마지막 말을 답장으로 남기고 go를 끈다(효니가 다시 체크하면 이어서).
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
const MAX = 2; // 한 PC에서 동시에 돌리는 세션 수 상한(세션마다 MCP 서버까지 떠서 RAM이 빠듯함 — 2026-11-10 RAM 바닥 일)

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
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true, timeout: 90000, env: { ...process.env, MSYS_NO_PATHCONV: '1' }, // 멈춘 firebase 명령이 실행기 전체를 세우지 않게
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
    // busy = 지금 이 PC에서 도는 시킨 일 수, max = 상한(앱이 «앞 일 N개»를 보일 때 씀. 옛 실행기는 이 두 칸이 없다)
    fs.writeFileSync(tmp, JSON.stringify({ [PC]: { at: Date.now(), ok: canRun.ok, why: canRun.why || null, busy: running.size, max: MAX } }));
    fbcli(['database:update', `/users/${UID}/ideaRunners`, q(tmp), '--force']);
  } catch (e) { log('켜짐 신호 실패: ' + e.message.slice(0, 160)); } finally { fs.rmSync(tmp, { force: true }); }
}
// 시킨 일 기록(2026-11-20, 출처: 효니 말 «쪽지함 시키기 로그를 내가 보기 편한 방식으로 알려주면 안 돼»):
// users/{uid}/ideaRunLog/{키} = { id 쪽지, t 첫 줄, pc, at 시작, re 이어서, end 끝난 때, how 끝 모양 }. 앱 «📋 시킨 일 기록» 창이 읽는다.
// 키: 세션 하나 = 표 n(시작에 쓰고 끝에 end·how를 더함). 내려놓기·돌려보내기는 쪽지·때로 만든 키라 여러 PC가 같이 써도 한 줄.
// how: reply 답장 남김 · ask 물어봄 · done 효니가 그새 끝냄 · noreply 답장 없이 끝남 · stop 멈춤 · nostart 못 엶 · gone 쪽지 지워짐
//      · drop 멈춘 일 내려놓음 · late 고른 PC가 안 가져감 · nopc PC 안 고른 시키기. 30일 지난 줄은 1시간마다 지운다.
const LOG_BASE = `/users/${UID}/ideaRunLog`;
const LOG_KEEP = 30 * 86400e3;
function runLog(key, part) {
  if (DRY || !/^[\w-]+$/.test(key)) return;
  const tmp = path.join(os.tmpdir(), `ideabox-runlog-${key}.json`);
  try { fs.writeFileSync(tmp, JSON.stringify(part)); fbcli(['database:update', q(`${LOG_BASE}/${key}`), q(tmp), '--force']); }
  catch (e) { log(`기록 쓰기 실패(${key}): ${String(e.message || e).slice(0, 120)}`); } finally { fs.rmSync(tmp, { force: true }); }
}
let pruneAt = 0;
function pruneLog() {
  if (DRY || Date.now() - pruneAt < 3600e3) return;
  pruneAt = Date.now();
  const tmp = path.join(os.tmpdir(), 'ideabox-runlog-prune.json');
  try {
    const all = JSON.parse(fbcli(['database:get', LOG_BASE]).trim() || 'null') || {};
    const old = Object.entries(all).filter(([, v]) => !v || Date.now() - (v.end || v.at || 0) > LOG_KEEP).map(([k]) => [k, null]);
    if (!old.length) return;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(old)));
    fbcli(['database:update', LOG_BASE, q(tmp), '--force']);
    log(`지난 기록 ${old.length}줄 지움`);
  } catch (e) { log('지난 기록 지우기 실패: ' + String(e.message || e).slice(0, 120)); } finally { fs.rmSync(tmp, { force: true }); }
}
const logT = (x) => firstLine(x && x.t).slice(0, 60) || '(사진 쪽지)';
const isWait = (x) => !!x.run && x.run.n === 'wait'; // 앱이 «이 PC에서 해 줘»라고 적어 둔 것(아직 아무도 안 가져감)
// 내 일: 효니가 이 PC를 고른 쪽지만. PC를 안 고른 시키기(go만, 옛 화면)는 아무 PC도 가져가지 않고 «앱을 다시 열고 체크»로 돌려보낸다
// (2026-11-18, 출처: 효니 말 «쪽지함에서 일 시키면 컴퓨터 고르게 한다고 하지 않았냐», 이 PC를 쓰지도 않는데 학교 PC가 먼저 보던 일)
const mine = (x) => !!x && !!x.go && x.st !== 'done' && isWait(x) && x.run.pc === PC;
const noPick = (x) => !!x && !!x.go && !x.run && x.st !== 'done';
const NO_PICK_RE = 'PC를 고르지 않고 시켜서 시작하지 않았어요(앱이 예전 화면이었을 수 있어요). 앱을 완전히 껐다 다시 열고 체크하면 «어느 PC에서 할까요?»가 떠요.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (s) => (String(s || '').split('\n').find((l) => l.trim()) || '').trim();

// 자동 세션이 하지 않을 일(2026-11-18, 물을 것 붙이기 때 넓힘): 미리보기·초안까지만 하고 ask로 다시 묻는다
const NO_GO = '지우기(파일·글·쪽지·레포·브랜치)·배포(push·PR 병합·Pages·Apps Script 배포)·학생 기록 등록·학부모·학생 문자·메일 발송·나이스 상신·힉스필드 사용(크레딧)·강제 푸시·결제·공개 게시';
function prompt(id, resumed, x = {}) {
  const inbox = 'node 웹앱/idea-box/tools/inbox.js';
  const stop = `되돌리기 어려운 일 — ${NO_GO} — 과 효니만 정할 수 있는 일은 하지 않는다. 미리보기·초안까지 만든 뒤 \`${inbox} ask ${id} "질문"\` 으로 묻고 끝낸다. 질문은 쉬운 말로, 물을 것이 여럿이면 «① …» «② …» 줄마다 하나씩, 고를 것은 줄 끝에 «[가 / 나 / 다]» — 앱이 질문마다 답 칸과 번호 단추를 보인다.`;
  const tail = [
    `다 하면 \`${inbox} reply ${id} "결과(쉬운 말, 만든 파일·주소 포함)"\` — «끝남»은 효니가 답장을 보고 앱에서 정하니 done은 쓰지 않는다. 묻는 답이면 답 자체를 답장에 적는다(«파일 보세요»로 끝내지 않기). 다 못 했으면 \`${inbox} reply ${id} "한 것 · 남은 것"\`. 답장은 효니가 폰에서 읽는다.`,
    '이 세션은 쪽지함이 연 자동 세션이다: 첫 응답 머릿말·사이드바 정리·결과 보고 페이지는 하지 않고, 결과는 쪽지 답장으로만 남긴다.',
  ];
  if (x.src) {
    // «효니에게 물을 것»(tools/asks.js가 계획·작업 목록에서 올린 항목) — 그 출처 파일에서 이어 간다
    return [
      resumed ? `효니가 물을 것 ${id}에 다시 답하고 시켰어요. 이어서 해 주세요.` : `효니가 쪽지함 할 일 판 «❓ 효니에게 물을 것»에서 체크해 클로드에게 시킨 일이에요. 쪽지 id: ${id}`,
      `출처: ${x.src.l || ''} — 교사업무/${x.src.f}`,
      '',
      `1. \`${inbox} show ${id}\` 로 물음·효니 답을 읽는다. 효니 답은 출처 파일의 그 항목 바로 아래 «→ 효니 답(날짜): …» 줄로도 적혀 있다. 답이 없으면 그 항목의 «답이 없으면 ○○»대로 진행한다.`,
      `2. 출처 파일(교사업무/${x.src.f})을 처음부터 읽고, 그 파일이 가리키는 레포 CLAUDE.md·체크리스트·«새 세션에게»대로 이어서 한다. 효니는 자리에 없다고 보고 묻지 않는다: 되돌릴 수 있는 일은 기본값으로 진행한다. 레포 코드는 worktree에서 고친다.`,
      `3. ${stop}`,
      '4. 그 물음이 정해졌으면 출처 파일의 그 항목 첫머리를 ~~줄 긋기~~하고 끝에 « → 정함(YYYY-MM-DD): 무엇으로»를 붙인다(그래야 쪽지함·세션현황판에서 빠진다). 효니가 정한 결정이면 클로드작업/효니위키/도구/결정-기록.md에도 한 줄(출처: 효니 말 «…»).',
      `5. ${tail[0]}`,
      `6. ${tail[1]}`,
    ].join('\n');
  }
  return [
    resumed ? `효니가 쪽지 ${id}에 답하고 다시 시켰어요. 이어서 해 주세요.` : `효니가 클로드 쪽지함 «할 일 판»에서 체크해 클로드에게 시킨 일이에요. 쪽지 id: ${id}`,
    '',
    `1. \`${inbox} show ${id}\` 로 쪽지 전문과 «— 대화 —»(앞선 클로드 답장·질문, 효니 답이 때 순서로)를 읽는다. 효니 답은 원래 글이 아니라 대화 칸에 있다. 사진 경로가 나오면 Read로 본다.`,
    '2. 교사업무 CLAUDE.md와 관련 레포 CLAUDE.md 규칙대로 끝까지 한다. 효니는 자리에 없다고 보고 묻지 않는다: 되돌릴 수 있는 일은 기본값으로 진행한다.',
    `3. ${stop}`,
    `4. ${tail[0]}`,
    `5. 클로드작업/작업 현황.md «⏳ 열린 일»의 이 쪽지 💌 줄은 그대로 둔다(효니가 앱에서 끝내면 받아 두기가 지운다).`,
    `6. ${tail[1]}`,
  ].join('\n');
}

// «효니에게 물을 것» 맞추기(tools/asks.js): 켜질 때 한 번 + 10분마다. 세션이 도는 중에도 따로 돈다.
const ASK_EVERY = 10 * 60e3;
let asksBusy = false;
let lastBlocked = '';
function asksTick() {
  if (asksBusy) return;
  asksBusy = true;
  try {
    const asks = require('./asks.js');
    const s = asks.sync({ dry: DRY });
    // 바뀐 게 있을 때만 남긴다(거른 항목만 있으면 같은 줄이 10분마다 쌓이지 않게)
    const line = asks.summary(s);
    const blockedLine = line.replace(/^.*?(?= · 안 올림|$)/, '');
    if (s.add || s.close || s.reopen || s.write || s.missing || blockedLine !== lastBlocked || ONCE || DRY) log((DRY ? '(dry) ' : '') + line);
    lastBlocked = blockedLine;
  } catch (e) { log('물을 것 맞추기 실패: ' + String(e.message || e).slice(0, 160)); } finally { asksBusy = false; }
  pruneLog(); // 1시간에 한 번만 실제로 돈다
}

// 멈춤 감시(2026-11-20, 출처: 효니 말 «둘 다 넣자» — 트윗 0ooooo0의 «30분 넘게 진행 없으면 감지»). 5분마다 본다. 알림까지만 하고 다시 돌리지 않는다.
//   ① 이 PC가 돌리는 시킨 일: 그 세션 대화 기록(~/.claude/projects/…/<sid>.jsonl, 서브에이전트 기록 포함)이 30분 넘게 그대로
//   ② 효니가 고른 PC가 30분 넘게 안 가져감(4시간 뒤 내려놓기는 위 step이 그대로 함)
//   ③ 다른 PC가 하는 중인데 그 PC 실행기 켜짐 신호가 30분 넘게 끊김(실행기가 죽었거나 PC가 잠듦 — 11-18 학교 PC처럼 아무도 모르던 일)
//   ④ 이 PC 예약 작업 실행이 30분 넘게 움직임 없음(클로드작업\도구\예약작업\현황\멈춤감시.js가 디스크 기록으로 판정)
// 알림 = 쪽지 하나(id «w»+판정 열쇠 해시, 주제 도구·급해요·st seen·re·rep) → 앱이 «🔔 클로드 답장이 왔어요» 창과 «내 차례» 띠로 보인다.
// 같은 일은 쪽지 id가 같아서 PC가 여럿이어도, 실행기가 다시 켜져도 한 번만 만든다(있으면 안 씀). 효니가 끝내거나 지워도 다시 안 만든다(지운 건 이 실행기 기억으로만 막음).
const WATCH_EVERY = 5 * 60e3;
const STALL = 30 * 60e3;
const WATCH_FAKE = (() => { const i = process.argv.indexOf('--watch-fake'); return i > 0 ? Number(process.argv[i + 1]) || 40 : 0; })(); // 시험: 가짜 «N분 멈춘 예약 실행»
// 이 PC가 이미 낸·본 알림 id는 파일에도 적어 둔다 — 실행기가 다시 켜진 뒤 효니가 지운 알림을 또 만들지 않게(7일 지난 건 버림)
const WARNED = path.join(os.tmpdir(), 'ideabox-warned.json');
const warned = (() => {
  const s = new Set();
  try { for (const [id, t] of Object.entries(JSON.parse(fs.readFileSync(WARNED, 'utf8')))) if (Date.now() - t < 7 * 864e5) s.add(id); } catch (e) {}
  return s;
})();
function rememberWarned(id) {
  warned.add(id);
  if (DRY) return;
  let m = {};
  try { m = JSON.parse(fs.readFileSync(WARNED, 'utf8')); } catch (e) {}
  m[id] = Date.now();
  for (const [k, t] of Object.entries(m)) if (Date.now() - t > 7 * 864e5) delete m[k];
  try { fs.writeFileSync(WARNED, JSON.stringify(m)); } catch (e) {}
}
const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
// 시킨 일 세션의 마지막 움직임(대화 기록·서브에이전트 기록 중 가장 늦게 바뀐 때). 기록이 아직 없으면 0
function sessionActivity(sid) {
  const tp = path.join(os.homedir(), '.claude', 'projects', slugOf(ROOT), `${sid}.jsonl`);
  let t = 0;
  try { t = fs.statSync(tp).mtimeMs; } catch (e) { return 0; }
  const sub = path.join(tp.replace(/\.jsonl$/, ''), 'subagents');
  try { for (const f of fs.readdirSync(sub)) t = Math.max(t, fs.statSync(path.join(sub, f)).mtimeMs); } catch (e) {}
  return t;
}
const mins = (ms) => (ms >= 90 * 60e3 ? `${Math.round(ms / 3600e3)}시간` : `${Math.round(ms / 60e3)}분`);
const kstTime = (t) => new Date(t + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace(/^0/, '').replace('-', '/');
// 예약 작업 한국어 이름: 현황\<PC>.json의 title(없으면 작업 id)
function schedTitle(task) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, '클로드작업', '도구', '예약작업', '현황', `${PC}.json`), 'utf8'));
    const t = (j.tasks || []).find((x) => x.task === task);
    if (t && t.title) return t.title;
  } catch (e) {}
  return task;
}
function warnOnce(key, head, body) {
  const id = 'w' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  if (warned.has(id)) return false;
  if (DRY) { log(`(dry) 알림 낼 것 ${id}: ${head}`); warned.add(id); return false; }
  try {
    if (readOne(id)) { rememberWarned(id); return false; } // 다른 PC·이전 실행기가 이미 알림
    const now = Date.now();
    patch(id, { t: `⚠️ ${head}`, at: now, tag: '도구', hot: true, st: 'seen', re: `${body}\n\n(멈춤 감시가 남긴 알림이에요. 다시 돌리지는 않았어요. 확인했으면 «끝남으로» 눌러 주세요.)`, rat: now, rep: now, warn: { k: key.slice(0, 120), pc: PC } });
    rememberWarned(id);
    log(`멈춤 알림 ${id}: ${head}`);
    return true;
  } catch (e) { log(`멈춤 알림 실패(${key.slice(0, 40)}): ${String(e.message || e).slice(0, 160)}`); return false; }
}
// 판정만(쓰기 없음): 쪽지·켜짐 신호·지금 시각·내가 돌리는 표·세션 움직임 → 낼 알림 목록 {key, head, body}. --watch-test가 가짜 자료로 부른다.
function stallChecks(all, beats, now, mineRunning = running, activityOf = sessionActivity) {
  const out = [];
  for (const [id, x] of Object.entries(all || {})) {
    if (!x || !x.run || x.st === 'done' || !x.go) continue;
    const what = `«${logT(x)}»`;
    if (isWait(x)) {
      // 고른 PC가 켜져 있고 시킨 일을 상한(max)만큼 돌리는 중이면 줄 서 있는 것 — 알리지 않는다(2026-11-20 검토자 지적)
      const pb = beats[x.run.pc];
      const queued = pb && now - (pb.at || 0) < 5 * 60e3 && pb.max && pb.busy >= pb.max;
      if (!queued && now - (x.run.at || 0) > STALL) out.push({ key: `wait:${id}:${x.run.at}`, head: `시킨 일 안 가져감: ${what} — ${x.run.pc} PC, ${mins(now - x.run.at)}째`,
        body: `${kstTime(x.run.at)}에 ${x.run.pc} PC로 시켰는데 아직 시작하지 않았어요. 그 PC가 꺼져 있거나 쪽지함 실행기가 안 도는 것 같아요. 체크를 풀고 켜진 PC를 다시 골라 주세요(4시간이 지나면 실행기가 알아서 내려놓아요).` });
      continue;
    }
    if (x.run.pc === PC) {
      if (!mineRunning.has(x.run.n) || now - (x.run.at || 0) < STALL) continue;
      const act = Math.max(activityOf(x.run.sid), x.run.at || 0);
      if (now - act > STALL) out.push({ key: `run:${x.run.n}`, head: `시킨 일 멈춤: ${what} — ${PC}, ${mins(now - act)}째 움직임 없음`,
        body: `${kstTime(x.run.at)}에 시작한 세션의 기록이 ${kstTime(act)} 뒤로 그대로예요(세션 ${x.run.sid}). 권한 창에서 기다리거나 멈춘 것 같아요. 2시간이 넘으면 실행기가 끄고 «멈췄어요»로 알려요.` });
    } else {
      const b = beats[x.run.pc];
      const last = Math.max((b && b.at) || 0, x.run.at || 0);
      if (now - last > STALL) out.push({ key: `beat:${x.run.n}`, head: `시킨 일 연락 끊김: ${what} — ${x.run.pc} PC 실행기, ${mins(now - last)}째`,
        body: `${x.run.pc} PC가 꺼졌거나 잠들었거나 실행기가 죽은 것 같아요(마지막 신호 ${b && b.at ? kstTime(b.at) : '없음'}). 그 PC를 켜면 실행기가 «멈췄어요»로 정리해요. 급하면 체크를 풀고 다른 PC로 다시 시켜 주세요.` });
    }
  }
  return out;
}
// 예약 작업(이 PC 디스크 기록) 판정. 모듈이 아직 안 내려온 PC면 빈 목록
function schedChecks(now) {
  const mod = path.join(ROOT, '클로드작업', '도구', '예약작업', '현황', '멈춤감시.js');
  if (!fs.existsSync(mod)) return [];
  delete require.cache[require.resolve(mod)]; // OneDrive로 새 판이 오면 다음 검사부터 새 판
  return require(mod).stalledScheduled({ now, fake: WATCH_FAKE }).map((s) => ({
    key: s.key, head: `예약 작업 멈춤: «${s.fake ? s.title : schedTitle(s.task)}» — ${PC}, ${mins(now - s.last)}째 움직임 없음`,
    body: `${kstTime(s.started)}에 시작한 실행이 ${kstTime(s.last)} 뒤로 멈춰 있어요(도구를 부르던 중에 끊겼거나 기다리는 중). 예약 작업 목록엔 «성공»으로 뜰 수도 있어요. 다시 돌리려면 앱 «예약 작업»에서 그 작업 «지금 실행»(세션 ${s.sid}).`,
  }));
}
// 현황 올리기(2026-11-20, 출처: 효니 말 «응, 모아줘»): 이 PC 열린 세션·예약 작업 상태를 앱 «📋 시킨 일» 창으로(tools/boards.js). 5분마다, 바뀐 것만 쓴다.
const BOARD_EVERY = 5 * 60e3;
function boardsTick() {
  try {
    const tmp = path.join(os.tmpdir(), 'ideabox-run-boards.json');
    const fb = {
      get: (p) => JSON.parse(fbcli(['database:get', q(p)]).trim() || 'null'),
      // PC 이름(한글일 수 있음)은 명령줄이 아니라 파일 안 열쇠로
      update: (p, obj) => { fs.writeFileSync(tmp, JSON.stringify(obj)); try { fbcli(['database:update', q(p), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); } },
    };
    const r = require('./boards.js').sync({ root: ROOT, pc: PC, uid: UID, fb, dry: DRY });
    if (DRY) log('(dry) 현황 올릴 것: ' + JSON.stringify(r).slice(0, 400));
    else if (r.sched === 'wrote') log('현황: 예약 작업 상태 올림');
  } catch (e) { log('현황 올리기 실패: ' + String(e.message || e).slice(0, 160)); }
}
let watchBusy = false;
function watchTick(all) {
  if (watchBusy) return;
  watchBusy = true;
  try {
    const now = Date.now();
    if (!all) { try { all = readAll(); } catch (e) { log('멈춤 감시 읽기 실패: ' + e.message.slice(0, 120)); return; } }
    let beats = {};
    try { beats = JSON.parse(fbcli(['database:get', `/users/${UID}/ideaRunners`]).trim() || 'null') || {}; } catch (e) {}
    const list = stallChecks(all, beats, now);
    try { list.push(...schedChecks(now)); } catch (e) { log('예약 작업 멈춤 감시 실패: ' + String(e.message || e).slice(0, 160)); }
    for (const w of list) warnOnce(w.key, w.head, w.body);
  } finally { watchBusy = false; }
}

// 이 실행기가 지금 돌리는(또는 가져가는 중인) 일: 표 n → 쪽지 id. 2개까지(MAX).
// «멈췄어요» 판정은 이 표들 전부를 봐야 한다 — 표 하나만 보면 두 번째 일을 남의 멈춘 일로 꺼 버린다.
const running = new Map();
let stepping = false; // 읽기·가져가기 동안 다음 tick이 끼어들지 않게(세션이 도는 동안은 막지 않음)
async function tick() {
  if (!DRY) touchLock();
  if (stepping) return;
  if (!ONCE && !DRY) {
    if (lockPid() !== process.pid) { log('잠금이 다른 실행기 것이라 끝냄'); process.exit(0); }
    if (!running.size) restartIfChanged(); // 새 판으로 바꿔 켜기는 도는 일이 하나도 없을 때만
  }
  if (running.size >= MAX) return;
  stepping = true;
  try { await step(); } finally { stepping = false; }
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
        try { patch(id, { run: null, go: null, st: 'seen', re: `${x.run.pc} PC가 시작하지 못했어요(꺼져 있거나 클로드를 못 엶). 다시 체크해서 켜진 PC를 골라 주세요.`, rat: now, rep: now }); } catch (e) {}
        runLog(`l${id}${x.run.at || 0}`, { id, t: logT(x), pc: x.run.pc, at: x.run.at || now, end: now, how: 'late' });
      }
      continue;
    }
    // 이 PC 것: 내가 돌리는 일도 아니고, 그 일을 연 실행기(run.rp)도 죽었을 때만. 다른 PC 것: 4시간 넘었을 때
    // (세션 제한 2시간+10분이 넘은 run은 pid가 살아 있어도 멈춘 것 — 재부팅 뒤 같은 pid를 다른 프로그램이 쓸 수 있다)
    const tooOld = x.run && now - (x.run.at || 0) > LIMIT + 10 * 60e3;
    const mineDead = x.run && x.run.pc === PC && !running.has(x.run.n) && (tooOld || !(x.run.rp && x.run.rp !== process.pid && alive(x.run.rp)));
    const stale = x.run && (x.run.pc === PC ? mineDead : now - (x.run.at || 0) > STALE);
    if (stale && x.st !== 'done' && !DRY) {
      log(`${id} 멈춘 일 내려놓음(맡은 PC ${x.run.pc})`);
      try { patch(id, { run: null, go: null, st: 'seen', re: `중간에 멈췄어요(${x.run.pc} PC가 꺼졌거나 끊김). 다시 체크하면 다시 할게요.`, rat: now, rep: now }); } catch (e) {}
      // 그 세션의 시작 줄(키 = 표 n)이 있으면 그 줄을 닫고, 없으면(옛 판이 연 일) 따로 한 줄
      runLog(/^[0-9a-f]{8}$/.test(x.run.n || '') ? x.run.n : `d${id}${x.run.at || 0}`, { id, t: logT(x), pc: x.run.pc, at: x.run.at || now, end: now, how: 'drop' });
    }
  }
  for (const [id, x] of Object.entries(all)) {
    if (!noPick(x)) continue;
    if (DRY) { log(`(dry) ${id} PC를 안 고른 시키기 — 돌려보낼 것`); continue; }
    log(`${id} PC를 안 고른 시키기 — 돌려보냄`);
    // st는 그대로(새 쪽지면 받아 두기가 계속 읽게). 같은 순간 옛 실행기가 run을 썼다면 그쪽이 go 없음을 보고 스스로 내려놓는다
    try { patch(id, { go: null, again: null, re: NO_PICK_RE, rat: now, rep: now }); } catch (e) {}
    runLog(`p${id}${x.go || 0}`, { id, t: logT(x), at: x.go || now, end: now, how: 'nopc' });
  }
  const todo = Object.entries(all).filter(([, x]) => mine(x)).sort((a, b) => a[1].go - b[1].go);
  if (!todo.length) return;
  if (DRY) {
    todo.forEach(([id, x], i) => log(`(dry) 할 일: ${id} «${firstLine(x.t).slice(0, 40)}»${isWait(x) ? ' (효니가 이 PC를 고름)' : ''}${canRun.ok ? (i < MAX - running.size ? ' — 지금 시작' : ' — 앞 일이 끝나면 시작') : ` — 못 가져감(${canRun.why})`}`));
    return;
  }
  if (!canRun.ok) { if (Date.now() - canRun.at > 5 * 60e3) checkClaude(); if (!canRun.ok) { log(`${todo[0][0]} 건너뜀: ${canRun.why}`); return; } }
  // 빈 칸만큼 오래 기다린 것부터 차례로 가져간다(가져가기 하나에 10~15초, 줄 선 나머지는 앞 일이 끝나면 close가 tick을 부름)
  for (const [id, x] of todo) {
    if (running.size >= MAX) break;
    await startOne(id, x);
  }
}
async function startOne(id, x) {
  // 가져가기: 내 표를 쓰고 몇 초 뒤 다시 읽어 확인(다른 PC와 겹치지 않게)
  const n = crypto.randomBytes(4).toString('hex');
  const resume = x.sid && x.spc === PC;
  const sid = resume ? x.sid : crypto.randomUUID();
  let took = false;
  try {
    // 쓰는 PC 먼저(2026-11-18, 출처: 효니 말 «학교 PC로 갔다는데 왜 글로 가?»): 효니가 5분 넘게 안 만진 PC는 90초 기다렸다가 본다.
    // 그 사이 효니가 쓰고 있는 PC가 가져가면 아래 «그새 바뀜»으로 물러난다. 쓰는 PC가 없으면 쉬는 PC가 한다.
    const idle = isWait(x) ? 0 : idleMs(); // 효니가 이 PC를 골랐으면 양보하지 않는다
    if (idle > IDLE) { log(`${id} 이 PC는 쉬는 중(${Math.round(idle / 60e3)}분) — 쓰는 PC에 90초 양보`); await sleep(YIELD); }
    const pre = readOne(id); // 쓰기 직전에 한 번 더: 그새 다른 PC가 가져갔으면 손대지 않음
    if (!mine(pre)) { log(`${id} 그새 바뀜 — 건너뜀`); return; }
    // st new → seen: 받아 두기(ideabox-collect)가 «새 쪽지»로 보고 reply로 덮지 않게
    running.set(n, id); // patch 전에 넣어야 이 사이 «멈췄어요» 판정이 내 표를 남의 것으로 보지 않는다
    patch(id, { run: { pc: PC, at: Date.now(), n, sid, rp: process.pid }, rep: null, ...(pre.st === 'new' ? { st: 'seen' } : {}) });
    await sleep(10000 + Math.random() * 5000);
    const back = readOne(id);
    if (!back || back.run?.n !== n) { log(`${id} 다른 PC가 가져감`); return; }
    if (!back.go) { log(`${id} 그새 효니가 체크를 풂`); patch(id, { run: null }); return; }
    took = true;
  } catch (e) { log(`${id} 가져가기 실패: ${e.message.slice(0, 160)}`); return; } finally { if (!took) running.delete(n); } // 표를 빼야 쓰다 만 내 run을 다음 tick이 내려놓는다
  // 물을 것이면 효니 답을 출처 파일에 먼저 적어 둔다(10분 맞추기를 기다리지 않게)
  if (x.src && x.a) { try { log(`${id} 답 적기: ${require('./asks.js').writeOne(id, x)}`); } catch (e) { log(`${id} 답 적기 실패: ${String(e.message || e).slice(0, 160)}`); } }
  log(`${id} 시작 «${firstLine(x.t).slice(0, 40)}» 세션 ${sid}${resume ? ' (이어서)' : ''}`);
  const logHead = { id, t: logT(x), pc: PC, at: Date.now(), ...(resume ? { re: true } : {}) };
  runLog(n, logHead);
  const args = ['-p', prompt(id, resume, x), '--permission-mode', 'auto', '--output-format', 'json',
    '-n', `💌 ${firstLine(x.t).slice(0, 24) || '쪽지 ' + id}`, ...(resume ? ['--resume', sid] : ['--session-id', sid])];
  // IDEABOX_AUTO: 세션 안 inbox.js가 done을 답장으로 바꾸고 rep(보고)를 찍는다
  const child = spawn('claude', args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, IDEABOX_AUTO: '1' } });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => { err += String(e); });
  // 2시간이 넘으면 멈춘 것으로 보고 끈다(실행기가 영원히 붙잡히지 않게)
  const killer = setTimeout(() => { err += ' 2시간 넘어 끔'; try { child.kill(); } catch (e) {} }, LIMIT);
  child.on('close', (code) => {
    clearTimeout(killer);
    let result = '';
    try { result = JSON.parse(out).result || ''; } catch (e) { result = out.trim().slice(-400); }
    log(`${id} 끝(코드 ${code})${err ? ' 오류: ' + err.trim().slice(-200) : ''}`);
    let how = code === 0 ? 'reply' : 'stop';
    try {
      const after = readOne(id);
      if (!after) how = 'gone';
      else if (after.st === 'done') how = 'done';
      else if (after.run?.n === n) how = /ENOENT/.test(err) ? 'nostart' : code === 0 && result ? 'noreply' : 'stop';
      else if (after.ask) how = 'ask';
      if (after && after.st === 'done') patch(id, { run: null, go: null, sid, spc: PC }); // 효니가 그새 «끝남»으로 닫음 → 상태는 그대로
      else if (after && after.run?.n === n) {
        // 세션이 inbox.js로 답장을 남기지 않음 → 마지막 말을 답장으로 남기고 내려놓기
        // 세션을 열지도 못한 경우(claude 없음)는 그대로 말한다 — «PC가 꺼졌다»로 잘못 알리지 않게. 세션이 없으니 sid·spc도 남기지 않는다(다음에 없는 세션을 --resume하지 않게)
        const noStart = /ENOENT/.test(err);
        if (noStart) canRun = { ok: false, why: 'claude 명령을 찾지 못해요', at: Date.now() };
        const re = code === 0 && result ? `(답장을 못 남겨서 대신 적어요) ${result.slice(0, 600)}`
          : noStart ? `${PC} PC에서 클로드를 열지 못해 시작하지 못했어요. 다시 체크해서 다른 PC를 골라 주세요.`
            : `하다가 멈췄어요(코드 ${code}). 다시 체크하면 이어서 할게요.`;
        patch(id, { run: null, go: null, st: 'seen', re, rat: Date.now(), rep: Date.now(), ...(noStart ? {} : { sid, spc: PC }) });
      } else if (after) patch(id, { sid, spc: PC });
    } catch (e) { log(`${id} 마무리 쓰기 실패: ${e.message.slice(0, 160)}`); }
    runLog(n, { ...logHead, end: Date.now(), how, code: code ?? null }); // 시작 줄 쓰기가 실패했어도 끝 줄만으로 한 줄이 되게
    // 마무리를 쓴 뒤에 표를 뺀다(firebase 쓰기는 동기라 그 사이 tick이 끼지 않지만, 순서로도 «내 일»이 남의 멈춘 일로 보이지 않게)
    running.delete(n);
    if (ONCE) { if (!running.size) process.exit(0); return; }
    setTimeout(tick, 2000); // 줄 선 다음 일
  });
}

// 멈춤 감시 시험(2026-11-20):
//   --watch-test  가짜 쪽지·켜짐 신호로 판정만 출력(아무 데도 안 씀). 맞으면 종료 코드 0
//   --watch-only  잠금·시키기 없이 멈춤 감시만 한 번 진짜로(알림 쪽지를 씀). --watch-fake N 과 같이 쓰면 가짜 예약 멈춤 하나를 더함
if (process.argv.includes('--watch-test')) {
  const now = Date.now(), M = 60e3;
  const all = {
    a: { t: '안 가져간 일', go: 1, run: { pc: 'USER', n: 'wait', at: now - 40 * M } }, // 알림
    b: { t: '막 시킨 일', go: 1, run: { pc: 'USER', n: 'wait', at: now - 5 * M } }, // 아직
    c: { t: '내 PC 멈춘 일', go: 1, run: { pc: PC, n: 'aaaa1111', at: now - 50 * M, sid: 'S1' } }, // 알림(기록 45분 전)
    d: { t: '내 PC 도는 일', go: 1, run: { pc: PC, n: 'bbbb2222', at: now - 50 * M, sid: 'S2' } }, // 아직(기록 2분 전)
    e: { t: '학교 PC 끊긴 일', go: 1, run: { pc: '신영현-학생자치', n: 'cccc3333', at: now - 60 * M } }, // 알림(신호 40분 전)
    f: { t: 'USER 도는 일', go: 1, run: { pc: 'USER', n: 'dddd4444', at: now - 60 * M } }, // 아직(신호 1분 전)
    g: { t: '끝난 일', st: 'done', go: 1, run: { pc: 'USER', n: 'wait', at: now - 90 * M } }, // 빼기
    h: { t: '남의 PC 표, 내 실행기 것 아님', go: 1, run: { pc: PC, n: 'eeee5555', at: now - 50 * M, sid: 'S3' } }, // 빼기(step이 내려놓음)
    i: { t: '줄 선 셋째 일', go: 1, run: { pc: 'QPC', n: 'wait', at: now - 40 * M } }, // 빼기(그 PC가 2개 돌리는 중)
  };
  const beats = { '신영현-학생자치': { at: now - 40 * M }, USER: { at: now - 1 * M }, QPC: { at: now - 1 * M, busy: 2, max: 2 } };
  const mineR = new Map([['aaaa1111', 'c'], ['bbbb2222', 'd']]);
  const act = (sid) => ({ S1: now - 45 * M, S2: now - 2 * M }[sid] || 0);
  const got = stallChecks(all, beats, now, mineR, act).map((w) => w.key);
  const want = [`wait:a:${now - 40 * M}`, 'run:aaaa1111', 'beat:cccc3333'];
  stallChecks(all, beats, now, mineR, act).forEach((w) => console.log('알림:', w.head));
  const ok = got.length === want.length && want.every((k) => got.includes(k));
  console.log(ok ? '판정 시험 통과' : `판정 시험 실패: 받은 ${JSON.stringify(got)}`);
  process.exit(ok ? 0 : 1);
}
if (process.argv.includes('--watch-only')) { watchTick(); process.exit(0); }
if (process.argv.includes('--boards-only')) { boardsTick(); process.exit(0); } // 현황만 한 번 진짜로 올림(잠금·시키기 없음)

(async () => {
  if (!DRY && !takeLock()) { if (ONCE) console.log('이 PC에서 실행기가 이미 돌고 있어요'); return; } // 이미 도는 중
  if (!DRY) { await sleep(400 + Math.random() * 600); if (lockPid() !== process.pid) return; } // 같은 순간에 켜진 다른 실행기가 잠금을 가져갔으면 물러남
  if (!DRY && !ONCE) killOldRunners();
  checkClaude();
  log(`실행기 켜짐 (${ROOT})${canRun.ok ? '' : ` — ${canRun.why}, 쪽지를 가져가지 않아요`}`);
  if (!DRY) beat();
  asksTick();
  boardsTick();
  await tick();
  if (ONCE || DRY) { watchTick(); if (!running.size) process.exit(0); return; }
  setInterval(tick, EVERY);
  setInterval(beat, EVERY);
  setInterval(asksTick, ASK_EVERY);
  setInterval(boardsTick, BOARD_EVERY);
  setTimeout(() => { watchTick(); setInterval(watchTick, WATCH_EVERY); }, 2 * 60e3); // 켜지자마자 말고 2분 뒤부터(켜짐 신호가 먼저 돌게)
})();
