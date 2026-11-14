// 클로드 쪽지함 화면. 쪽지는 Firebase users/{주인uid}/ideas, ?demo=1이면 메모리에만.
// 보낼 쪽지는 먼저 이 기기(localStorage 우편함)에 넣고 Firebase에 올라가면 뺀다 — 인터넷이 끊겨도 쪽지를 잃지 않게.
import * as fb from './fb.js';

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

const TAGS = [
  ['일반', '💭'], ['책장', '📚'], ['시간표', '🗓️'], ['수업', '🏫'], ['학교 일', '📋'], ['글·블로그', '✍️'], ['대학원', '🎓'], ['도구', '🛠️'],
];
const STATES = { new: '새 쪽지', seen: '클로드가 읽음', done: '끝남' };
const FILTERS = [['open', '안 끝난 것'], ['new', '새 쪽지'], ['seen', '읽음'], ['done', '끝남'], ['all', '전체']];

let store = null;
let ideas = {};
let filter = 'open';
let editing = null;

// ---------- 저장 도우미 ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const OUTBOX = 'ideabox-outbox';
const DRAFT = 'ideabox-draft';
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function demoStore() {
  const now = Date.now();
  let data = {
    d1: { t: '책장 책 창에서 «읽는 중»이랑 «책 정보 고치기» 단추 하나로 합치면 좋겠어', at: now - 86400e3 * 2, tag: '책장', st: 'done', re: '계획 세션을 열어 두 양식을 하나로 합치는 안을 만들었어요.', rat: now - 86400e3 },
    d2: { t: '시간표 앱 할 일 탭에 «이번 주만 보기» 단추가 있으면 좋겠다', at: now - 3600e3 * 5, tag: '시간표', st: 'seen' },
    d3: { t: '다음 주 수업 웹앱 아이디어: 학생이 사료 카드를 시대순으로 끌어다 놓기', at: now - 600e3, tag: '수업', st: 'new', hot: true },
  };
  let cb = () => {};
  const emit = () => setTimeout(() => cb(structuredClone(data)), 120);
  return {
    async watch(f) { cb = f; emit(); },
    async create(id, item) { if (!data[id]) data[id] = item; emit(); },
    async patch(id, part) { data[id] = { ...data[id], ...part }; emit(); },
    async remove(id) { delete data[id]; emit(); },
  };
}

// ---------- 시작 ----------
async function start() {
  buildChips($('#tags'), 'tag', '일반');
  buildChips($('#edit-tags'), 'etag', '일반');
  bind();
  takeShare();
  restoreDraft();
  registerSW();
  if (isDemo) { status('데모예요. 저장은 이 화면에만 돼요.'); return open(demoStore()); }
  const tok = fb.takeIdToken();
  if (tok) {
    try {
      const u = await fb.finishRedirect(tok);
      if (!u) return gate('효니 계정이 아니라서 로그아웃했어요.');
    } catch (e) { return gate('로그인을 마치지 못했어요. 다시 눌러 주세요.'); }
  }
  if (!fb.wasOwner()) return gate();
  fb.warm();
  fb.watchAuth((user) => {
    if (fb.isOwner(user)) open(fb.firebaseStore());
    else if (!store) gate();
  }).catch(() => {
    // 인터넷 없이 열었을 때: 로그인 도구를 못 불러와도 쪽지는 이 기기 우편함에 쓰게 하고, 연결되면 다시 연다
    open(offlineStore());
    status('인터넷이 없어요. 쪽지는 이 기기에 모아 두고, 연결되면 올라가요.');
    window.addEventListener('online', () => location.reload(), { once: true });
  });
}
function offlineStore() {
  const no = () => Promise.reject(new Error('offline'));
  return { offline: true, async watch(cb) { cb({}); }, create: no, patch: no, remove: no };
}

function gate(msg = '') {
  $('#status').textContent = '';
  $('#gate').hidden = false;
  $('#content').hidden = true;
  $('#gate-msg').textContent = msg;
  fb.warm();
}

async function open(s) {
  if (store) return;
  store = s;
  $('#gate').hidden = true;
  $('#content').hidden = false;
  $('#signout').hidden = isDemo;
  try {
    await store.watch((v) => { ideas = v; if (!isDemo && !store.offline) status(''); render(); flush(); }, () => status('쪽지를 불러오지 못했어요. 새로고침해 주세요.'));
  } catch (e) { status('쪽지를 불러오지 못했어요. 인터넷을 확인해 주세요.'); }
  render();
  flush();
}

// ---------- 쪽지 넣기 ----------
function bind() {
  $('#signin').addEventListener('click', async () => {
    $('#gate-msg').textContent = '';
    try {
      const u = await fb.signIn();
      if (u === 'redirect') return;
      if (!u) return gate('효니 계정이 아니라서 로그아웃했어요.');
      open(fb.firebaseStore());
    } catch (e) { $('#gate-msg').textContent = '로그인 창이 닫혔거나 막혔어요. 다시 눌러 주세요.'; }
  });
  $('#signout').addEventListener('click', async () => { await fb.signOut(); location.reload(); });
  $('#refresh').addEventListener('click', hardRefresh);
  $('#compose').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  const t = $('#t');
  t.addEventListener('input', () => { grow(t); saveDraft(); });
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  $('#tags').addEventListener('change', saveDraft);
  $('#hot').addEventListener('change', saveDraft);
  $('#list').addEventListener('click', onListClick);
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    render();
  });
  $('#edit-form').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
  $('#edit-cancel').addEventListener('click', () => $('#edit').close());
  $('#edit-t').addEventListener('input', (e) => grow(e.target));
  for (const d of [$('#ask'), $('#edit')]) {
    // 바깥(어두운 곳)을 누르면 닫기
    // 창 자체에는 여백을 두지 않고(안쪽 form이 여백을 가짐) 바깥 좌표인지까지 본다 — 창 가장자리를 눌러 고치던 글이 날아가지 않게
    d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close('no');
    });
  }
  window.addEventListener('online', flush);
}

function buildChips(box, name, def) {
  for (const [tag, ico] of TAGS) {
    const l = document.createElement('label');
    l.className = 'chip';
    l.innerHTML = `<input type="radio" name="${name}" value="${tag}"${tag === def ? ' checked' : ''}><span>${ico} ${tag}</span>`;
    box.querySelector(".chip-row").appendChild(l);
  }
}
const chipVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '일반';
const setChip = (name, v) => { const r = document.querySelector(`input[name="${name}"][value="${CSS.escape(v || '일반')}"]`) || document.querySelector(`input[name="${name}"]`); r.checked = true; };

function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, window.innerHeight * 0.5) + 'px'; }

function saveDraft() {
  const t = $('#t').value;
  ls.set(DRAFT, t.trim() ? { t, tag: chipVal('tag'), hot: $('#hot').checked } : null);
  $('#draft').textContent = t.trim() ? '임시 저장됨' : '';
}
function restoreDraft() {
  const d = ls.get(DRAFT, null);
  if (!d || $('#t').value) return;
  $('#t').value = d.t || '';
  setChip('tag', d.tag);
  $('#hot').checked = !!d.hot;
  grow($('#t'));
  if (d.t) $('#draft').textContent = '쓰던 글을 불러왔어요';
}

// 안드로이드 «공유하기»로 들어온 글·주소를 입력칸에 채운다(manifest share_target)
function takeShare() {
  if (!['title', 'text', 'url'].some((k) => params.has(k))) return;
  const parts = [params.get('title'), params.get('text'), params.get('url')].map((x) => (x || '').trim()).filter(Boolean);
  // 다른 조각에 이미 들어 있는 조각은 뺀다(제목이 본문에 들어 있는 경우 등)
  const uniq = parts.filter((x, i) => !parts.some((y, j) => j !== i && (y.length > x.length || (y === x && j < i)) && y.includes(x)));
  if (uniq.length) {
    // 쓰던 글이 있으면 덮지 않고 아래에 붙인다
    const before = (ls.get(DRAFT, null)?.t || '').trim();
    restoreDraft();
    $('#t').value = (before ? before + '\n\n' : '') + uniq.join('\n');
    grow($('#t'));
    saveDraft();
  }
  try { history.replaceState(null, '', location.pathname + (isDemo ? '?demo=1' : '')); } catch (e) {}
}

async function send() {
  const t = $('#t').value.trim();
  if (!t) { $('#t').focus(); return; }
  const id = newId();
  const item = { t, at: Date.now(), tag: chipVal('tag'), st: 'new' };
  if ($('#hot').checked) item.hot = true;
  const box = ls.get(OUTBOX, {});
  box[id] = item;
  ls.set(OUTBOX, box);
  $('#t').value = '';
  $('#hot').checked = false;
  grow($('#t'));
  ls.set(DRAFT, null);
  $('#draft').textContent = '';
  if (filter === 'done' || filter === 'seen') filter = 'open';
  render(id);
  toast('쪽지를 넣었어요 💌');
  flush();
}

// 이 기기 우편함에 남은 쪽지를 올린다. 실패하면 남겨 두고 다음에(앱 열 때·인터넷 연결될 때) 다시.
// 서버에는 «없을 때만 만들기»로 올려서, 늦게 성공한 옛 쓰기가 나중의 고침·지움·답장을 덮지 않는다.
let flushing = false;
async function flush() {
  if (!store || flushing || store.offline) return;
  flushing = true;
  const tried = new Set();
  try {
    // 올리는 사이 새로 넣은 쪽지도 같은 차례에 올린다
    for (;;) {
      const box = ls.get(OUTBOX, {});
      const id = Object.keys(box).find((k) => !tried.has(k));
      if (!id) break;
      tried.add(id);
      await withTimeout(store.create(id, box[id]), 8000);
      dropOutbox(id);
    }
  } catch (e) {
    status('인터넷이 끊겨 쪽지를 이 기기에 모아 뒀어요. 연결되면 올라가요.');
  } finally { flushing = false; render(); }
}
function dropOutbox(id) { const box = ls.get(OUTBOX, {}); if (box[id]) { delete box[id]; ls.set(OUTBOX, box); } }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

// ---------- 목록 ----------
function allItems() {
  const box = ls.get(OUTBOX, {});
  const list = Object.entries(ideas).map(([id, v]) => ({ id, ...v }));
  for (const [id, v] of Object.entries(box)) if (!ideas[id]) list.push({ id, ...v, pending: true });
  const hot = (x) => (x.hot && x.st !== 'done' ? 1 : 0);
  return list.sort((a, b) => hot(b) - hot(a) || b.at - a.at);
}
const pass = (x) => filter === 'all' || (filter === 'open' ? x.st !== 'done' : x.st === filter);

function render(fresh) {
  const items = allItems();
  const n = (f) => items.filter((x) => (f === 'all' ? true : f === 'open' ? x.st !== 'done' : x.st === f)).length;
  $('#filters').innerHTML = FILTERS.map(([f, label]) => `<button type="button" class="fchip" data-f="${f}" aria-pressed="${f === filter}">${label} <b>${n(f)}</b></button>`).join('');
  const shown = items.filter(pass);
  const ol = $('#list');
  ol.innerHTML = shown.map(card).join('');
  if (fresh) ol.querySelector(`[data-id="${fresh}"]`)?.classList.add('fresh');
  const empty = $('#empty');
  empty.hidden = shown.length > 0;
  empty.textContent = items.length ? '여기엔 쪽지가 없어요.' : '아직 쪽지가 없어요. 떠오르는 생각을 위에 적어 보세요.';
  reveal();
}

function card(x) {
  const ico = (TAGS.find(([t]) => t === x.tag) || TAGS[0])[1];
  const st = x.pending ? '<span class="badge wait">올라가길 기다리는 중</span>' : `<span class="badge ${x.st}">${STATES[x.st] || ''}</span>`;
  const re = x.re ? `<div class="reply"><span class="who">클로드</span><p>${esc(x.re)}</p>${x.rat ? `<time>${when(x.rat)}</time>` : ''}</div>` : '';
  const doneBtn = x.st === 'done' ? '<button type="button" data-act="reopen">다시 열기</button>' : '<button type="button" data-act="done">끝남으로</button>';
  return `<li class="card${x.hot && x.st !== 'done' ? ' is-hot' : ''}${x.st === 'done' ? ' is-done' : ''}${shownIds.has(x.id) ? ' show' : ''}" data-id="${esc(x.id)}">
    <div class="meta"><span class="tag">${ico} ${esc(x.tag || '일반')}</span>${x.hot ? '<span class="hotmark">🔥 급해요</span>' : ''}<time>${when(x.at)}${x.ed ? ' · 고침' : ''}</time></div>
    <p class="text">${esc(x.t)}</p>
    ${re}
    <div class="row">${st}<span class="acts">${x.pending ? '' : `<button type="button" data-act="edit">고치기</button>${doneBtn}`}<button type="button" class="del" data-act="del">지우기</button></span></div>
  </li>`;
}

async function onListClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  const x = ideas[id];
  const act = b.dataset.act;
  if (act === 'del') {
    if (!(await ask('이 쪽지를 지울까요? 되돌릴 수 없어요.'))) return;
    // 우편함에서 먼저 빼야 다음 올리기가 지운 쪽지를 되살리지 않는다
    dropOutbox(id);
    render();
    if (!ideas[id]) return toast('지웠어요');
    return run(store.remove(id), '지웠어요');
  }
  if (!x) return;
  if (act === 'edit') return openEdit(id, x);
  if (act === 'done') return run(store.patch(id, { st: 'done' }), '끝남으로 옮겼어요');
  if (act === 'reopen') return run(store.patch(id, { st: x.re ? 'seen' : 'new' }), '다시 열었어요');
}
async function run(p, msg) {
  try { await withTimeout(p, 8000); toast(msg); } catch (e) { toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}

function openEdit(id, x) {
  editing = id;
  $('#edit-t').value = x.t;
  setChip('etag', x.tag);
  $('#edit-hot').checked = !!x.hot;
  $('#edit').showModal();
  grow($('#edit-t'));
}
async function saveEdit() {
  const t = $('#edit-t').value.trim();
  if (!t || !editing) return;
  const part = { t, tag: chipVal('etag'), hot: $('#edit-hot').checked || null, ed: Date.now() };
  // 클로드가 읽은 뒤 고쳤으면 다시 «새 쪽지»로 돌려 다음에 또 읽게 한다
  if (ideas[editing]?.st === 'seen' && t !== ideas[editing].t) part.st = 'new';
  $('#edit').close();
  await run(store.patch(editing, part), '고쳤어요');
  editing = null;
}

// 앱 안 확인 창(브라우저 confirm 대신)
function ask(msg) {
  const d = $('#ask');
  $('#ask-msg').textContent = msg;
  return new Promise((ok) => {
    const done = (v) => { d.removeEventListener('close', onClose); $('#ask-yes').onclick = $('#ask-no').onclick = null; ok(v); };
    const onClose = () => done(d.returnValue === 'yes');
    $('#ask-yes').onclick = () => d.close('yes');
    $('#ask-no').onclick = () => d.close('no');
    d.returnValue = '';
    d.addEventListener('close', onClose);
    d.showModal();
    $('#ask-no').focus();
  });
}

// 카드가 보이는 순간 한 장씩 떠오름(한 번만)
let io;
const shownIds = new Set(); // 이미 떠오른 카드는 목록이 다시 그려져도 또 움직이지 않게
function reveal() {
  const cards = [...document.querySelectorAll('.card:not(.show)')];
  if (!('IntersectionObserver' in window)) return cards.forEach((c) => c.classList.add('show'));
  io ||= new IntersectionObserver((ents) => {
    let k = 0;
    for (const en of ents) if (en.isIntersecting) { en.target.style.transitionDelay = `${Math.min(k++, 6) * 0.05}s`; en.target.classList.add('show'); shownIds.add(en.target.dataset.id); io.unobserve(en.target); }
  });
  cards.forEach((c) => io.observe(c));
}

// ---------- 작은 도우미 ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function when(ms) {
  const d = new Date(ms), now = new Date();
  const min = Math.round((now - d) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400e3);
  if (diff === 0) return `오늘 ${hm}`;
  if (diff === 1) return `어제 ${hm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
function status(msg) { $('#status').textContent = msg; $('#status').hidden = !msg; }
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- 새로고침(홈 화면 앱용) ----------
async function hardRefresh() {
  $('#refresh lucian-refresh')?.setState?.('loading');
  if (!navigator.onLine) { toast('인터넷이 없어서 새로 받지 못해요.'); $('#refresh lucian-refresh')?.setState?.('idle'); return; }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    const keys = await caches?.keys?.() || [];
    await Promise.all(keys.filter((k) => k.startsWith('ideabox-')).map((k) => caches.delete(k)));
  } catch (e) {}
  location.reload();
}
function registerSW() {
  if ('serviceWorker' in navigator && !isLocal) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
