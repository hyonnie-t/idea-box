// 현황 올리기(2026-11-20, 출처: 효니 말 «응, 모아줘» — 세션 현황판·예약 현황판을 쪽지함 «📋 시킨 일» 창 하나로).
// 쪽지함 실행기(runner.js)가 5분마다 부른다. 계산은 순수 함수(sessionsDoc·schedDoc), 읽기·쓰기는 sync가 한다.
//   ① 이 PC 열린 세션: 클로드작업\도구\현황판\세션현황판.js의 localSessions()(없으면 같은 폴더 PC-<이름>.json)
//      → users/{uid}/ideaBoards/pc/{PC} = { at 읽은 때, s: [{ n 이름, st busy|waiting|idle, u 마지막 움직임 }] }
//   ② 예약 작업 상태: 클로드작업\도구\예약작업\현황\전체.json(OneDrive, 세 PC가 같은 파일)
//      → users/{uid}/ideaBoards/sched = { at 파일 바뀐 때, pcs {PC: 모은 때}, n {ok fail miss run plan end}, bad [실패·놓침], top [이번 주 많이 쓴 3] }
//      여러 PC가 같은 파일을 올리므로, 원격 at보다 새 파일일 때만 쓴다(OneDrive가 늦게 내려온 PC가 새것을 덮지 않게).
// 올리지 않는 것: 폴더 경로(cwd)·세션 id·요약 전문. 이름·제목에 학생 실명·열쇠 값처럼 보이는 말이 있으면 «(가림)»(asks.js BLOCK 기준).
// 예약 작업 «멈춤» 수는 여기서 세지 않는다 — 멈춤 감시 알림 쪽지(warn.k가 's'로 시작)를 앱이 센다.
const fs = require('fs');
const path = require('path');

const WEEK = 7 * 86400e3;
const MAX_S = 12; // PC마다 올리는 세션 수 상한
const ST_ORDER = { waiting: 0, busy: 1, idle: 2 };
const SCHED_N = { 성공: 'ok', 실패: 'fail', 놓침: 'miss', '도는 중': 'run', 예정: 'plan', 끝남: 'end' };

let blocked = () => null;
try { blocked = require('./asks.js').blockedReason; } catch (e) {}
const safe = (s, len) => { const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, len); return blocked(t) ? '(가림)' : t; };
const ms = (s) => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };

// 세션 목록 → 올릴 꼴. 확인 기다림 → 하는 중 → 쉬는 중, 같은 칸에선 최근 것 먼저
function sessionsDoc(list, now) {
  const s = (list || []).filter((x) => x && x.status !== 'unknown').map((x) => ({ n: safe(x.name, 60) || '(제목 없음)', st: ST_ORDER[x.status] != null ? x.status : 'idle', u: x.updatedAt || 0 }))
    .sort((a, b) => ST_ORDER[a.st] - ST_ORDER[b.st] || b.u - a.u).slice(0, MAX_S);
  return { at: now, s };
}

// 전체.json 줄들 → 요약. top: 지난 7일 실행의 API 요금 환산(cost) 합 큰 순 3개
function schedDoc(rows, mtime, now) {
  const n = { ok: 0, fail: 0, miss: 0, run: 0, plan: 0, end: 0 };
  const pcs = {};
  const bad = [];
  const use = [];
  for (const r of rows || []) {
    if (!r || !r.state) continue;
    const k = SCHED_N[r.state];
    if (k) n[k]++;
    if (r.pc) pcs[r.pc] = Math.max(pcs[r.pc] || 0, ms(r.collected_at));
    if (r.state === '실패' || r.state === '놓침') bad.push({ t: safe(r.title || r.key, 50), pc: r.pc || '', st: k, at: ms(r.last_started) || ms(r.next_run) });
    const wk = (r.week || []).filter((w) => now - ms(w.started) < WEEK);
    if (wk.length) use.push({ t: safe(r.title || r.key, 50), pc: r.pc || '', c: Math.round(wk.reduce((a, w) => a + (Number(w.cost) || 0), 0) * 100) / 100, m: Math.round(wk.reduce((a, w) => a + (Number(w.minutes) || 0), 0)), r: wk.length });
  }
  bad.sort((a, b) => (a.st === b.st ? b.at - a.at : a.st === 'fail' ? -1 : 1));
  use.sort((a, b) => b.c - a.c || b.m - a.m);
  return { at: mtime, pcs, n, bad: bad.slice(0, 8), top: use.slice(0, 3) };
}

// 읽기·쓰기. fb = { get(path) → 값, update(path, obj) }. 같은 내용은 다시 안 쓴다(지난번 쓴 것을 기억).
const last = { pc: '', schedAt: 0 };
function sync({ root, pc, uid, fb, dry = false, now = Date.now() }) {
  const out = { pc: 'same', sched: 'same' };
  const base = `/users/${uid}/ideaBoards`;
  // ① 세션
  let list = null;
  try {
    const mod = path.join(root, '클로드작업', '도구', '현황판', '세션현황판.js');
    delete require.cache[require.resolve(mod)];
    const m = require(mod);
    if (typeof m.localSessions === 'function') list = m.localSessions();
  } catch (e) {}
  if (!list) {
    try { list = JSON.parse(fs.readFileSync(path.join(root, '클로드작업', '도구', '현황판', `PC-${pc}.json`), 'utf8')).sessions; } catch (e) { list = null; }
  }
  if (list) {
    const doc = sessionsDoc(list, now);
    const sig = JSON.stringify(doc.s);
    // 같은 목록이어도 30분에 한 번은 at을 새로 찍는다(앱이 «N분 전 기준»으로 낡음을 보이게)
    if (sig !== last.pc || now - (last.pcAt || 0) > 30 * 60e3) {
      if (dry) out.pc = doc;
      else { fb.update(base + '/pc', { [pc]: doc }); out.pc = 'wrote'; }
      last.pc = sig; last.pcAt = now;
    }
  } else out.pc = 'none';
  // ② 예약 작업
  const file = path.join(root, '클로드작업', '도구', '예약작업', '현황', '전체.json');
  let mtime = 0;
  try { mtime = Math.round(fs.statSync(file).mtimeMs); } catch (e) { out.sched = 'none'; return out; }
  if (mtime !== last.schedAt) {
    const doc = schedDoc(JSON.parse(fs.readFileSync(file, 'utf8')), mtime, now);
    if (dry) out.sched = doc;
    else {
      const remote = Number(fb.get(base + '/sched/at')) || 0;
      if (mtime > remote) { fb.update(base, { sched: doc }); out.sched = 'wrote'; } else out.sched = 'older';
    }
    last.schedAt = mtime;
  }
  return out;
}

module.exports = { sessionsDoc, schedDoc, sync };

// 시험: node tools/boards.js --test (가짜 자료 판정만) / --dry (진짜 파일을 읽어 올릴 꼴만 출력)
if (require.main === module) {
  const assert = require('assert');
  if (process.argv.includes('--test')) {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const sd = sessionsDoc([
      { name: '한가한 세션', status: 'idle', updatedAt: 5 }, { name: '권한 창 대기', status: 'waiting', updatedAt: 1 },
      { name: '일하는 중', status: 'busy', updatedAt: 3 }, { name: '3-12 김철수 세특', status: 'idle', updatedAt: 9 }, { name: 'x', status: 'unknown' },
    ], now);
    assert.deepStrictEqual(sd.s.map((x) => x.st), ['waiting', 'busy', 'idle', 'idle']);
    assert.strictEqual(sd.s[2].n, '(가림)');
    assert.ok(!JSON.stringify(sd).includes('cwd'));
    const rows = [
      { key: 'A:a', pc: 'A', title: '집 찾기', state: '성공', collected_at: '2026-11-20T10:00:00Z', week: [{ started: '2026-11-19T00:00:00Z', minutes: 2, cost: 1.5 }, { started: '2026-11-01T00:00:00Z', minutes: 99, cost: 99 }] },
      { key: 'A:b', pc: 'A', title: '아침 점검', state: '실패', last_started: '2026-11-18T00:00:00Z', week: [{ started: '2026-11-18T00:00:00Z', minutes: 10, cost: 3 }] },
      { key: 'B:c', pc: 'B', title: '놓친 일', state: '놓침', next_run: '2026-11-19T00:00:00Z', collected_at: '2026-11-19T10:00:00Z' },
      { key: 'B:d', pc: 'B', title: '도는 일', state: '도는 중', week: [{ started: '2026-11-20T00:00:00Z', minutes: 1, cost: 0.2 }] },
      { key: 'B:e', pc: 'B', title: '끝난 1회', state: '끝남' },
    ];
    const sc = schedDoc(rows, 123, now);
    assert.deepStrictEqual(sc.n, { ok: 1, fail: 1, miss: 1, run: 1, plan: 0, end: 1 });
    assert.deepStrictEqual(sc.bad.map((x) => x.st), ['fail', 'miss']);
    assert.deepStrictEqual(sc.top.map((x) => [x.t, x.c]), [['아침 점검', 3], ['집 찾기', 1.5], ['도는 일', 0.2]]);
    assert.strictEqual(sc.pcs.A, Date.parse('2026-11-20T10:00:00Z'));
    console.log('boards 시험 통과');
  } else if (process.argv.includes('--dry')) {
    const root = path.resolve(__dirname, '..', '..', '..');
    const fb = { get: () => 0, update: () => {} };
    const r = sync({ root, pc: process.env.COMPUTERNAME || require('os').hostname(), uid: 'x', fb, dry: true });
    console.log(JSON.stringify(r, null, 1));
  }
}
