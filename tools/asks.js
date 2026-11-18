#!/usr/bin/env node
// «효니에게 물을 것» → 쪽지함(2026-11-18, 출처: 효니 말 «매번 내가 파일을 여는 게 번거롭지 않을까», «내 말은 웹앱에 붙일 수 없냐는 거야»).
// 세션현황판이 모으는 물을 것(웹앱\*\TODO.md, 클로드작업\산출물\**\*계획-인수인계.md, 작업 현황.md의 «효니에게 물을 것» 절)을
// 쪽지함 할 일 판 맨 위에 올리고, 효니가 앱에서 답하면 그 답을 출처 파일의 그 항목 아래에 적는다.
//   node tools/asks.js          한 번 맞추기(올리기·닫기·답 적기) 후 요약
//   node tools/asks.js --dry    무엇을 할지만(Firebase·파일 안 씀)
// 실행기(tools/runner.js)가 켜질 때와 10분마다 부른다. 매 답 끝 훅에서는 부르지 않는다(네트워크가 무거움).
// 쪽지 칸: id = q + sha1(출처 경로 + 물음) 앞 12자, t 물음, ask, st seen, tag 도구,
//   src { f 출처 파일(교사업무 기준, / 구분), l 출처 이름, d «답이 없으면 ○○», gone 원본에서 사라져 닫음 },
//   a 효니 답, aat 답한 때, aw 출처 파일에 적은 때.
// 학생 실명·열쇠 값처럼 보이는 항목은 올리지 않고 건수와 파일만 알린다(기준: TODO.md, blockedReason).
process.noDeprecation = true;
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const PROJECT = 'timetable-af612';
const BASE = `/users/${UID}/ideas`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 교사업무 폴더: 이 파일은 교사업무\웹앱\<idea-box 또는 작업 사본>\tools
function findRoot() {
  const cands = [path.resolve(__dirname, '../../..'), path.join(process.env.OneDriveCommercial || '', '교사업무'),
    'C:\\Users\\alfzl\\OneDrive - 대영중학교\\교사업무', 'D:\\OneDrive - 대영중학교\\교사업무'];
  return cands.find((p) => p && fs.existsSync(path.join(p, 'CLAUDE.md')) && fs.existsSync(path.join(p, '클로드작업', '도구', '현황판'))) || cands[0];
}
const ROOT = findRoot();
const panel = () => require(path.join(ROOT, '클로드작업', '도구', '현황판', '세션현황판.js'));

// ---------- 거르기 ----------
const SURNAME = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부';
const NAME = `[${SURNAME}][가-힣]{1,2}(?![가-힣])`; // 흔한 성씨로 시작하는 한글 2~3자
const BLOCK = [
  [new RegExp(`\\d+\\s*번\\s*${NAME}`), '번호+이름'],
  [new RegExp(`(?<![\\d-])\\d{1,2}\\s*[-–]\\s*\\d{1,2}(?![\\d-])\\s*번?\\s*${NAME}`), '반-번호+이름'],
  [new RegExp(`(?<!\\d)[1-3]\\d{3,4}(?!\\d)\\s*${NAME}`), '학번+이름'],
  [new RegExp(`[${SURNAME}][가-힣]{1,2}\\s?(학생|(군|양)(?![가-힣]))`), '이름+학생'],
  [/(비밀번호|비번|password|passwd|token|api[_ -]?key|secret)\s*[:=]\s*\S+/i, '열쇠 값'],
];
function blockedReason(text) {
  for (const [re, why] of BLOCK) if (re.test(text)) return why;
  return null;
}

// ---------- 모으기 ----------
// «답이 없으면 ○○»: 항목 안 어디든(괄호 안이든 → 뒤든). 앞은 물음, 뒤는 기본값
function splitDefault(text) {
  const m = /([(（]\s*)?답이?\s*없으면\s*/.exec(text);
  if (!m || m.index === 0) return { q: text.trim(), d: '' };
  const q = text.slice(0, m.index).replace(/[\s→—–:,(（-]+$/, '').trim();
  let d = text.slice(m.index + m[0].length);
  if (m[1]) { const close = d.search(/[)）]/); if (close >= 0) d = d.slice(0, close); }
  return { q: q || text.trim(), d: d.replace(/[\s.)）]+$/, '').trim() };
}
const idOf = (rel, text) => 'q' + crypto.createHash('sha1').update(rel + '\n' + text).digest('hex').slice(0, 12);
function labelOf(rel) {
  const parts = rel.split('/');
  if (parts[0] === '웹앱') return `${parts[1]} 작업 목록`;
  if (rel.endsWith('작업 현황.md')) return '작업 현황';
  return path.basename(rel, '.md').replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/_?[^_]*계획-인수인계$/, '') + ' 계획';
}
function collect() {
  const p = panel();
  const out = [];
  for (const abs of p.askFiles()) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    for (const e of p.askEntries(abs)) {
      const { q, d } = splitDefault(e.text);
      out.push({ id: idOf(rel, e.text), rel, abs, l: labelOf(rel), q: q.slice(0, 600), d: d.slice(0, 200), line: e.line, text: e.text, blocked: blockedReason(e.text) });
    }
  }
  return out;
}

// ---------- 답 적기 ----------
const ymd = (ms) => { const t = new Date(ms); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const answerLine = (x) => `  - → 효니 답(${ymd(x.aat || Date.now())}): ${String(x.a).trim().replace(/\s*\r?\n\s*/g, ' / ')}`;
// 그 항목을 지금 파일에서 다시 찾아(id가 같은 항목) 바로 아래 들여 쓴 줄들 뒤에 답 줄을 넣는다.
// 반환: 'written' | 'already'(같은 답 줄이 이미 있음) | 'missing'(항목을 못 찾음)
function writeAnswer(x, items, dry) {
  const it = items.find((i) => i.id === x.id);
  if (!it) return 'missing';
  let text;
  try { text = fs.readFileSync(it.abs, 'utf8'); } catch (e) { return 'missing'; }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const line = answerLine(x);
  let at = it.line + 1;
  while (at < lines.length && /^\s+\S/.test(lines[at])) { if (lines[at].trim() === line.trim()) return 'already'; at++; }
  if (dry) return 'written';
  lines.splice(at, 0, line);
  fs.writeFileSync(it.abs, lines.join(eol));
  return 'written';
}

// ---------- 맞추기 ----------
// all: 지금 ideas 전부(실행기가 이미 읽은 것을 넘기면 한 번 덜 읽음). 반환: { updates(여러 경로 patch), sum }
function plan(all, items, dry) {
  const now = Date.now();
  const up = {};
  const sum = { add: 0, close: 0, reopen: 0, write: 0, missing: 0, blocked: [], open: 0, answered: 0 };
  const live = new Set();
  for (const it of items) {
    if (it.blocked) { sum.blocked.push({ f: it.rel, why: it.blocked }); continue; }
    live.add(it.id);
    const x = all[it.id];
    if (!x) {
      up[it.id] = { t: it.q, at: now, tag: '도구', st: 'seen', ask: true, src: { f: it.rel, l: it.l, ...(it.d ? { d: it.d } : {}) } };
      sum.add++;
    } else if (x.st === 'done' && x.src && x.src.gone) {
      // 원본에서 사라져 닫았던 것이 다시 나타남(되돌리기·다른 PC 사본) → 다시 열기. 효니·세션이 끝낸 건 안 엶
      Object.assign(up, { [`${it.id}/st`]: 'seen', [`${it.id}/src/gone`]: null, [`${it.id}/ask`]: x.a ? null : true, [`${it.id}/re`]: null, [`${it.id}/rat`]: null });
      sum.reopen++;
    }
  }
  for (const [id, x] of Object.entries(all)) {
    if (!x || !x.src || x.st === 'done') continue;
    if (!live.has(id)) {
      if (x.run) continue; // 세션이 그 일을 하는 중이면 세션이 닫는다
      Object.assign(up, { [`${id}/st`]: 'done', [`${id}/src/gone`]: true, [`${id}/ask`]: null, [`${id}/go`]: null,
        [`${id}/re`]: x.a && !x.aw ? `원본 항목이 바뀌거나 정해져서 닫았어요. 답(«${String(x.a).slice(0, 80)}»)은 파일에 적지 못했어요.` : '원본 파일에서 정해졌거나 지워져서 닫았어요.', [`${id}/rat`]: now });
      sum.close++;
      continue;
    }
    // 효니가 답했는데 아직 파일에 안 적음(또는 답을 고침)
    if (x.a && (!x.aw || (x.aat || 0) > x.aw)) {
      const r = writeAnswer({ id, ...x }, items, dry);
      if (r === 'missing') sum.missing++;
      else { up[`${id}/aw`] = now; if (r === 'written') sum.write++; }
    }
    sum.open++;
    if (x.a && !x.go && !x.run) sum.answered++;
  }
  return { updates: up, sum };
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
function pushUpdates(up) {
  if (!Object.keys(up).length) return;
  for (const k of Object.keys(up)) if (!/^[\w-]+(\/[\w-]+)*$/.test(k)) throw new Error('이상한 경로: ' + k);
  const tmp = path.join(os.tmpdir(), `ideabox-asks-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(up));
  try { fbcli(['database:update', q(BASE), q(tmp), '--force']); } finally { fs.rmSync(tmp, { force: true }); }
}

// 실행기·손 실행 공통. all을 넘기면 다시 읽지 않는다.
function sync({ all, dry = false } = {}) {
  const items = collect();
  const data = all || readAll();
  const { updates, sum } = plan(data, items, dry);
  if (!dry) pushUpdates(updates);
  return { ...sum, items, updates };
}
// 시킨 물을 것 하나만 바로 답 적기(실행기가 세션을 열기 직전에)
function writeOne(id, x) {
  if (!x || !x.src || !x.a) return 'none';
  const r = writeAnswer({ id, ...x }, collect(), false);
  if (r !== 'missing') pushUpdates({ [`${id}/aw`]: Date.now() });
  return r;
}
const summary = (s) => `물을 것: 열림 ${s.open + s.add} · 새로 올림 ${s.add} · 닫음 ${s.close}${s.reopen ? ` · 다시 엶 ${s.reopen}` : ''} · 답 적음 ${s.write}${s.missing ? ` · 못 적음 ${s.missing}` : ''}`
  + (s.blocked.length ? ` · 안 올림 ${s.blocked.length}(학생 이름·열쇠처럼 보임: ${[...new Set(s.blocked.map((b) => b.f))].join(', ')})` : '');

module.exports = { sync, writeOne, collect, plan, blockedReason, summary, labelOf, idOf };

if (require.main === module) {
  const dry = process.argv.includes('--dry');
  try {
    const s = sync({ dry });
    console.log((dry ? '(미리보기) ' : '') + summary(s));
    if (dry) {
      for (const it of s.items) console.log(`${it.blocked ? '✋ 안 올림(' + it.blocked + ')' : it.id} · ${it.l} · ${it.blocked ? '(내용 숨김)' : it.q.slice(0, 60)}${it.d ? ` → 답이 없으면 ${it.d}` : ''}`);
      console.log(`쓸 경로 ${Object.keys(s.updates).length}개`);
    }
  } catch (e) {
    console.error('물을 것 맞추기 실패:', e.message.slice(0, 300));
    if (/login|auth|credentials/i.test(e.message)) console.error('→ 효니 터미널에서: npx firebase-tools login');
    process.exit(1);
  }
}
