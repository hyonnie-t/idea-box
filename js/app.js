// 클로드 쪽지함 화면. 쪽지는 Firebase users/{주인uid}/ideas, ?demo=1이면 메모리에만.
// 보낼 쪽지는 먼저 이 기기(localStorage 우편함)에 넣고 Firebase에 올라가면 뺀다 — 인터넷이 끊겨도 쪽지를 잃지 않게.
import * as fb from './fb.js';
import { shrink, newPicKey, MAX_PICS } from './pics.js';

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

const TAGS = [
  ['일반', '💭'], ['책장', '📚'], ['시간표', '🗓️'], ['수업', '🏫'], ['학교 일', '📋'], ['글·블로그', '✍️'], ['대학원', '🎓'], ['도구', '🛠️'],
];
const STATES = { new: '새 쪽지', seen: '클로드가 읽음', done: '끝남' };
const FILTERS = [['open', '안 끝난 것'], ['re', '답장 옴'], ['new', '새 쪽지'], ['seen', '읽음'], ['done', '끝남'], ['all', '전체']];

let store = null;
let ideas = {};
let filter = 'open';
// 찾기(2026-11-18): 이 화면에서만 기억. 쪽지 목록과 할 일 판 둘 다 거른다.
let query = '';
let editing = null;
// 할 일 판: 보는 방법·접은 묶음은 이 기기에 기억, 펼친 줄·끝낸 것 펼침은 이 화면에서만(다시 그려도 유지)
const VIEW = 'ideabox-view';
const CLOSED = 'ideabox-board-closed';
let view = 'list';
let closedGroups = new Set();
const openRows = new Set();
const openDone = new Set();

// ---------- 저장 도우미 ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const OUTBOX = 'ideabox-outbox';
const DRAFT = 'ideabox-draft';
// 사진: 우편함 쪽지의 사진은 OUTBOX_PICS {쪽지id: {사진키: {s, b}}}, 쓰던 쪽지의 사진은 DRAFT_PICS [{k, s, b}].
// 기기 저장 칸(보통 5MB)이 모자라면 이 화면 메모리에만 두고(memOutPics) 알린다.
const OUTBOX_PICS = 'ideabox-outbox-pics';
const DRAFT_PICS = 'ideabox-draft-pics';
const memOutPics = {};
const trySet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const outPics = (id) => memOutPics[id] || ls.get(OUTBOX_PICS, {})[id] || null;
function dropOutPics(id) { delete memOutPics[id]; const m = ls.get(OUTBOX_PICS, {}); if (m[id]) { delete m[id]; trySet(OUTBOX_PICS, m); } }
let composePics = []; // 쓰는 중인 쪽지에 붙인 사진 [{k, s, b}]
let editPics = []; // 고치기 창의 사진 [{k, s?, b?, old}] — old면 이미 올라간 사진
const thumbs = new Map(); // `${쪽지id}/${사진키}` → 작은 그림(한 번 받으면 다시 안 받음)
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function demoStore() {
  const now = Date.now();
  let data = {
    d1: { t: '책장 책 창에서 «읽는 중»이랑 «책 정보 고치기» 단추 하나로 합치면 좋겠어', at: now - 86400e3 * 2, tag: '책장', st: 'done', re: '계획 세션을 열어 두 양식을 하나로 합치는 안을 만들었어요.', rat: now - 86400e3 },
    d2: { t: '시간표 앱 할 일 탭에 «이번 주만 보기» 단추가 있으면 좋겠다', at: now - 3600e3 * 5, tag: '시간표', st: 'seen' },
    d3: { t: '다음 주 수업 웹앱 아이디어: 학생이 사료 카드를 시대순으로 끌어다 놓기', at: now - 600e3, tag: '수업', st: 'new', hot: true },
    d7: { t: '블로그 글감 폴더 정리해 줘', at: now - 3600e3 * 2, tag: '글·블로그', st: 'seen', go: now - 60e3, run: { pc: 'CHAN', at: now - 60e3, n: 'wait' } },
    d9: { t: '위시리스트 앱 가격 알림 넣어 줘', at: now - 3600e3 * 6, tag: '일반', st: 'seen', go: now - 1800e3, run: { pc: 'USER', at: now - 1800e3, n: 'wait' } },
    d4: { t: '책장 표지 색을 좀 더 따뜻하게 바꾸고 싶어', at: now - 86400e3 * 3, tag: '책장', st: 'seen', ask: true, again: true, re: '두 가지만 정해 주세요.\n① «따뜻하게»는 어느 쪽이에요? [귤색 / 바랜 종이색 / 둘 다 섞기]\n② 다크 모드도 같이 바꿀까요? [같이 / 밝은 화면만]', rat: now - 86400e3 * 2 },
    d5: { t: '시간표 위젯 글씨가 작아\n폰에서 보면 한눈에 안 들어와', at: now - 86400e3 * 4, tag: '시간표', st: 'seen', re: '좋아요. 18px로 키워 두고 작업 현황에 올렸어요.', rat: now - 86400e3 * 2,
      th: { m1: { w: 'c', x: '얼마나 키울까요? [16px / 18px / 20px]', at: now - 86400e3 * 3, q: true }, m2: { w: 'h', x: '18px', at: now - 86400e3 * 2.5 }, m3: { w: 'c', x: '좋아요. 18px로 키워 두고 작업 현황에 올렸어요.', at: now - 86400e3 * 2 } }, hat: now - 86400e3 * 2.5 },
    d8: { t: '책장 앱 검색창 글씨 크기 키워 줘', at: now - 3600e3 * 3, tag: '책장', st: 'seen', go: now - 600e3, run: { pc: 'CHAN', at: now - 300e3 } },
    // 시킨 일이 끝나 보고한 것(rep) — 열면 «🔔 클로드가 다 했어요» 창
    d10: { t: '전세 대출 최대 한도 계산해 줘', at: now - 3600e3 * 7, tag: '일반', st: 'seen', rep: now - 120e3, sid: 'demo', spc: 'CHAN', re: '최대 3억 2천만 원까지 가능해요.\n① 은행 전세대출 2억 4천\n② 공제회 신용대출 8천\n계산 파일: 클로드작업/산출물/개인생활/전세한도.md', rat: now - 120e3 },
    d6: { t: '쪽지함 도구 정리', at: now - 86400e3 * 6, tag: '도구', st: 'done', re: '정리했어요.', rat: now - 86400e3 * 5 },
    // «효니에게 물을 것»(src, tools/asks.js가 계획·작업 목록에서 올림) — 판 맨 위 칸
    qa1: { t: '책장 실물 책등을 기본 보기로 할지', at: now - 3600e3, tag: '도구', st: 'seen', ask: true, src: { f: '웹앱/bookshelf/TODO.md', l: 'bookshelf 작업 목록', d: '실물 책등이 기본, 색 에디션 창에서 바꿀 수 있음' } },
    qa2: { t: '홈페이지 방명록(댓글)을 넣을지', at: now - 3600e3 * 2, tag: '도구', st: 'seen', ask: true, src: { f: '클로드작업/산출물/도구설정/2026-11-18_대시보드재설계/2026-11-18_대시보드재설계_계획-인수인계.md', l: '대시보드재설계 계획', d: '넣지 않는다' } },
    qa3: { t: '처인성 장면(멀리 작은 실루엣)을 넣을지', at: now - 3600e3 * 3, tag: '도구', st: 'seen', ask: true, src: { f: '웹앱/survive-eras/TODO.md', l: 'survive-eras 작업 목록', d: '뺌 — 강화도 한 가지 생각만' } },
    qa4: { t: '화면 비율 1:1 vs 세로 9:16', at: now - 3600e3 * 4, tag: '도구', st: 'seen', a: '세로 9:16으로 해 줘', aat: now - 1800e3, aw: now - 1500e3, src: { f: '웹앱/survive-eras/TODO.md', l: 'survive-eras 작업 목록', d: '1:1' } },
    qa5: { t: '제호 «효니실록» 이름을 그대로 둘지', at: now - 3600e3 * 5, tag: '도구', st: 'seen', ask: true, go: now - 60e3, src: { f: '클로드작업/산출물/개인생활/2026-11-18_효니문서/2026-11-18_효니문서_계획-인수인계.md', l: '효니문서 계획', d: '제호는 그대로, 첫 화면만 인물 문서로' } },
    qa6: { t: '노트마다 검색어를 처음 정할 때 몇 개 노트부터 할지', at: now - 3600e3 * 6, tag: '도구', st: 'seen', ask: true, src: { f: '웹앱/geulgam/TODO.md', l: 'geulgam 작업 목록', d: '글감·초안 칸에 있는 노트만' } },
    qa9: { t: '이미 정해진 물음(끝남 — 판에 안 보임)', at: now - 86400e3, tag: '도구', st: 'done', src: { f: '웹앱/idea-box/TODO.md', l: 'idea-box 작업 목록', gone: true } },
  };
  // 데모 사진 한 장(그려서 만든 그림)
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 640, 480); gr.addColorStop(0, '#ffd8b8'); gr.addColorStop(1, '#bcd6ff');
  g.fillStyle = gr; g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#22304a'; g.font = 'bold 56px sans-serif'; g.fillText('데모 사진', 180, 260);
  const demoPic = { s: c.toDataURL('image/jpeg', 0.6), b: c.toDataURL('image/jpeg', 0.8) };
  data.d2.ph = ['pdemo'];
  const pics = { d2: { pdemo: demoPic } };
  let cb = () => {};
  const emit = () => setTimeout(() => cb(structuredClone(data)), 120);
  const wait = () => new Promise((r) => setTimeout(r, 150));
  return {
    async watch(f) { cb = f; emit(); },
    async create(id, item) { if (!data[id]) data[id] = item; emit(); },
    // Firebase update처럼 'th/키' 같은 깊은 길도 받는다
    async patch(id, part) {
      const o = (data[id] = structuredClone(data[id] || {}));
      for (const [path, v] of Object.entries(part)) {
        const ks = path.split('/');
        let p = o;
        for (const k of ks.slice(0, -1)) p = p[k] = p[k] && typeof p[k] === 'object' ? p[k] : {};
        if (v === null) delete p[ks.at(-1)]; else p[ks.at(-1)] = v;
      }
      emit();
    },
    async remove(id) { delete data[id]; delete pics[id]; emit(); },
    async putPics(id, p) { await wait(); pics[id] = { ...pics[id], ...p }; },
    async dropPics(id, keys) { for (const k of keys) delete pics[id]?.[k]; },
    async getPic(id, k, size) { await wait(); return pics[id]?.[k]?.[size] || ''; },
    // 데모 PC 셋: 켜짐 / 켜졌지만 클로드를 못 엶 / 꺼짐. ?demo=1&nopc=1 이면 켜진 PC 없음
    async runners() { await wait(); const t = Date.now(); return { CHAN: { at: new URLSearchParams(location.search).has('nopc') ? t - 7200e3 : t - 20e3, ok: true }, '신영현-학생자치': { at: t - 40e3, ok: false, why: 'claude 명령을 찾지 못해요' }, USER: { at: t - 86400e3 * 2, ok: true } }; },
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
  return { offline: true, async watch(cb) { cb({}); }, create: no, patch: no, remove: no, putPics: no, dropPics: no, getPic: no, runners: no };
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
    await store.watch((v) => { ideas = buryDeleted(v); if (!isDemo && !store.offline) status(''); render(); flush(); maybeReport(); }, () => status('쪽지를 불러오지 못했어요. 새로고침해 주세요.'));
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
  view = ls.get(VIEW, 'list') === 'board' ? 'board' : 'list';
  closedGroups = new Set((ls.get(CLOSED, []) || []).filter((x) => typeof x === 'string'));
  $('#views').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    ls.set(VIEW, view);
    render();
  });
  $('#groups').addEventListener('click', onBoardClick);
  $('#groups').addEventListener('change', onBoardCheck);
  $('#undo-btn').addEventListener('click', doUndo);
  // 보고 창: 단추 · «나중에»(Esc·바깥 포함)는 지금 보고들을 이 화면에서만 덮어 둠 · 다른 창이 닫히면 기다리던 보고를 띄움
  $('#rep-list').addEventListener('click', onReportAct);
  $('#rep').addEventListener('close', () => { for (const x of repItems()) repLater.set(x.id, x.rep); });
  $('#rep-later').addEventListener('click', () => $('#rep').close());
  for (const d of document.querySelectorAll('dialog')) if (d.id !== 'rep') d.addEventListener('close', () => setTimeout(maybeReport, 300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') repLater.clear(); else maybeReport(); });
  const qIn = $('#q');
  // 한글은 자모마다 input이 와서, 다시 그리기는 잠깐 멈춘 뒤 한 번만(지우기 단추는 바로)
  let qTimer = 0;
  const syncQ = () => { clearTimeout(qTimer); query = qIn.value; $('#q-clear').hidden = !query; render(); };
  qIn.addEventListener('input', () => { $('#q-clear').hidden = !qIn.value; clearTimeout(qTimer); qTimer = setTimeout(syncQ, 150); });
  qIn.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qIn.value) { e.preventDefault(); qIn.value = ''; syncQ(); } });
  $('#q-clear').addEventListener('click', () => { qIn.value = ''; syncQ(); qIn.focus(); });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    render();
  });
  $('#edit-form').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
  $('#edit-cancel').addEventListener('click', () => $('#edit').close());
  $('#edit-t').addEventListener('input', (e) => grow(e.target));
  // 답하기 창(스레드)
  $('#reply-form').addEventListener('submit', (e) => { e.preventDefault(); sendReply(); });
  $('#reply-cancel').addEventListener('click', () => $('#reply').close());
  $('#reply-edit').addEventListener('click', () => {
    const id = replying?.id;
    $('#reply').close();
    if (id && ideas[id]) openEdit(id, ideas[id]);
  });
  $('#reply').addEventListener('close', () => { saveReplyDraft(); replying = null; });
  $('#reply-qs').addEventListener('input', (e) => { if (e.target.matches('textarea')) grow(e.target); saveReplyDraft(); });
  $('#reply-qs').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); } });
  $('#reply-qs').addEventListener('click', (e) => {
    const b = e.target.closest('.ropt');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    for (const o of b.parentElement.querySelectorAll('.ropt')) o.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-pressed', String(on));
    saveReplyDraft();
  });
  for (const d of [$('#ask'), $('#edit'), $('#pick'), $('#reply')]) {
    // 바깥(어두운 곳)을 누르면 닫기
    // 창 자체에는 여백을 두지 않고(안쪽 form이 여백을 가짐) 바깥 좌표인지까지 본다 — 창 가장자리를 눌러 고치던 글이 날아가지 않게
    // 누른 곳과 뗀 곳이 모두 창 밖일 때만 닫는다(글을 고르다 바깥에서 손을 떼도 안 닫히게)
    const outside = (e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let downOut = false;
    d.addEventListener('pointerdown', (e) => { downOut = e.target === d && outside(e); });
    d.addEventListener('click', (e) => {
      if (e.target === d && downOut && outside(e)) d.close('no');
      downOut = false;
    });
  }
  // 사진: 고르기(폰은 찍기·앨범 고르기가 같이 뜸)·붙여넣기(PC 캡처)·빼기·크게 보기
  $('#pic-in').addEventListener('change', (e) => { addPics([...e.target.files], 'compose'); e.target.value = ''; });
  $('#edit-pic-in').addEventListener('change', (e) => { addPics([...e.target.files], 'edit'); e.target.value = ''; });
  const onPaste = (which) => (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    if (which === 'edit' && editSrc) { e.preventDefault(); return toast('물음의 답에는 사진을 붙일 수 없어요. 글로 적어 주세요.'); }
    e.preventDefault();
    addPics(files, which);
  };
  $('#t').addEventListener('paste', onPaste('compose'));
  $('#edit-t').addEventListener('paste', onPaste('edit'));
  $('#pics').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]');
    if (b) { composePics = composePics.filter((p) => p.k !== b.dataset.rm); renderComposePics(); saveDraft(); }
  });
  $('#edit-pics').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]');
    if (b) { editPics = editPics.filter((p) => p.k !== b.dataset.rm); renderEditPics(); }
  });
  $('#viewer-close').addEventListener('click', () => $('#viewer').close());
  $('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer' || e.target.id === 'viewer-img') $('#viewer').close(); });
  $('#viewer').addEventListener('close', () => { $('#viewer-img').removeAttribute('src'); });
  window.addEventListener('online', flush);
}

// ---------- 사진 ----------
// 줄이는 동안 보내기·저장을 막는다(줄인 사진이 다음 쪽지에 잘못 붙지 않게). editGen은 고치기 창을 다시 열면 바뀐다.
const shrinking = { compose: 0, edit: 0 };
let editGen = 0;
async function addPics(files, which) {
  const get = () => (which === 'compose' ? composePics : editPics);
  const draw = which === 'compose' ? renderComposePics : renderEditPics;
  const gen = editGen;
  const room = MAX_PICS - get().length - shrinking[which];
  if (room <= 0) return toast(`사진은 ${MAX_PICS}장까지 붙일 수 있어요.`);
  const take = files.slice(0, room);
  if (files.length > room) toast(`사진은 ${MAX_PICS}장까지라 ${room}장만 붙였어요.`);
  shrinking[which] += take.length; draw();
  for (const f of take) {
    let p = null;
    try { p = { k: newPicKey(), ...(await shrink(f)) }; } catch (e) { toast('이 사진은 열지 못했어요.'); }
    if (which === 'edit' && gen !== editGen) continue; // 그사이 창을 닫고 다른 쪽지를 열었으면 버린다(숫자는 openEdit가 0으로 돌려 둠)
    shrinking[which]--;
    if (p) get().push(p);
    draw();
  }
  if (which === 'compose') saveDraft();
}
function picStrip(list, alt, busy) {
  // 이미 올라간 사진(old)은 src 없이 data-pic만 두고 fillThumbs가 채운다
  return list.map((p, i) => `<span class="pic"><img${p.s ? ` src="${esc(p.s)}"` : ''} alt="${alt} ${i + 1}"${p.src ? ` data-pic="${esc(p.src)}"` : ''}><button type="button" class="pic-rm" data-rm="${esc(p.k)}" aria-label="사진 ${i + 1} 빼기">×</button></span>`).join('')
    + '<span class="pic pic-busy" role="status" aria-label="사진 줄이는 중"></span>'.repeat(busy);
}
function renderComposePics() {
  $('#pics').innerHTML = picStrip(composePics, '붙인 사진', shrinking.compose);
  $('#pics').hidden = !composePics.length && !shrinking.compose;
  $('#pic-add').hidden = composePics.length + shrinking.compose >= MAX_PICS;
}
function renderEditPics() {
  $('#edit-pics').innerHTML = picStrip(editPics, '쪽지 사진', shrinking.edit);
  $('#edit-pics').hidden = !editPics.length && !shrinking.edit;
  $('#edit-pic-add').hidden = editPics.length + shrinking.edit >= MAX_PICS;
  fillThumbs($('#edit-pics'));
}
// 카드·고치기 창의 작은 그림을 채운다(처음 한 번만 받아 와서 기억)
function fillThumbs(root) {
  for (const img of root.querySelectorAll('img[data-pic]')) {
    if (img.getAttribute('src') || !img.dataset.pic) continue;
    const key = img.dataset.pic;
    // thumbs 값: 그림 주소 / null 받는 중(받으면 아래에서 채움) / '' 서버에 없음
    if (thumbs.has(key)) { const v = thumbs.get(key); if (v) img.src = v; else if (v === '') img.closest('.pic, .thumb')?.classList.add('gone'); continue; }
    const [id, k] = key.split('/');
    const local = outPics(id)?.[k];
    if (local) { img.src = local.s; continue; }
    if (!store || store.offline) continue;
    thumbs.set(key, null); // 받는 중(겹쳐 부르지 않게)
    store.getPic(id, k, 's').then((u) => {
      thumbs.set(key, u);
      document.querySelectorAll(`img[data-pic="${CSS.escape(key)}"]`).forEach((el) => { if (u) el.src = u; else el.closest('.pic, .thumb')?.classList.add('gone'); });
    }).catch(() => thumbs.delete(key));
  }
}
async function viewPic(id, k, i) {
  const d = $('#viewer');
  const img = $('#viewer-img');
  img.alt = `쪽지 사진 ${i + 1}`;
  const local = outPics(id)?.[k];
  const first = local?.b || thumbs.get(`${id}/${k}`); // 큰 그림이 오기 전엔 작은 그림을 늘려 보여 준다
  if (first) img.src = first; else img.removeAttribute('src');
  d.showModal();
  if (local || !store || store.offline) return;
  try { const u = await withTimeout(store.getPic(id, k, 'b'), 15000); if (u && d.open) img.src = u; } catch (e) { toast('큰 사진을 받지 못했어요.'); }
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
  const has = t.trim() || composePics.length;
  ls.set(DRAFT, has ? { t, tag: chipVal('tag'), hot: $('#hot').checked } : null);
  // 사진은 따로(기기 저장 칸이 모자라면 사진만 못 남김)
  const picsOk = trySet(DRAFT_PICS, composePics.length ? composePics : null);
  $('#draft').textContent = !has ? '' : picsOk ? '임시 저장됨' : '글만 임시 저장됨(사진은 기기에 자리가 없어요)';
}
function restoreDraft() {
  const d = ls.get(DRAFT, null);
  if (!d || $('#t').value) return;
  $('#t').value = d.t || '';
  setChip('tag', d.tag);
  $('#hot').checked = !!d.hot;
  composePics = (ls.get(DRAFT_PICS, []) || []).filter((p) => p && p.k && p.s && p.b).slice(0, MAX_PICS);
  renderComposePics();
  grow($('#t'));
  if (d.t || composePics.length) $('#draft').textContent = '쓰던 글을 불러왔어요';
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
    const add = uniq.join('\n');
    // 같은 공유가 두 번 들어와(새로고침 등) 똑같은 글이 겹쳐 붙지 않게
    $('#t').value = before.includes(add) ? before : (before ? before + '\n\n' : '') + add;
    grow($('#t'));
    saveDraft();
  }
  try { history.replaceState(null, '', location.pathname + (isDemo ? '?demo=1' : '')); } catch (e) {}
}

async function send() {
  const t = $('#t').value.trim();
  if (shrinking.compose) return toast('사진을 줄이는 중이에요. 잠깐만요.');
  if (!t && !composePics.length) { $('#t').focus(); return; } // 사진만 있는 쪽지도 된다
  const id = newId();
  const item = { t, at: Date.now(), tag: chipVal('tag'), st: 'new' };
  if ($('#hot').checked) item.hot = true;
  if (composePics.length) {
    item.ph = composePics.map((p) => p.k);
    const pics = Object.fromEntries(composePics.map((p) => [p.k, { s: p.s, b: p.b }]));
    const m = ls.get(OUTBOX_PICS, {});
    m[id] = pics;
    if (!trySet(OUTBOX_PICS, m)) memOutPics[id] = pics; // 기기 칸이 모자라면 이 화면에서만 들고 있다가 올린다
  }
  const box = ls.get(OUTBOX, {});
  box[id] = item;
  ls.set(OUTBOX, box);
  $('#t').value = '';
  $('#hot').checked = false;
  composePics = [];
  renderComposePics();
  trySet(DRAFT_PICS, null);
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
  let failed = 0;
  // 올리는 사이 새로 넣은 쪽지도 같은 차례에 올리고, 한 장이 실패해도 나머지는 계속 올린다
  for (;;) {
    const box = ls.get(OUTBOX, {});
    const id = Object.keys(box).find((k) => !tried.has(k));
    if (!id) break;
    tried.add(id);
    try {
      // 사진을 먼저 올리고 쪽지를 만든다. 사진이 이 기기에서 사라졌으면(저장 칸 부족 뒤 새로고침) 사진 표시만 빼고 올린다.
      let item = box[id];
      const pics = item.ph?.length ? outPics(id) : null;
      if (item.ph?.length && !pics) item = { ...item, ph: null, t: (item.t ? item.t + '\n' : '') + '(사진은 올리지 못했어요)' };
      if (pics) await withTimeout(store.putPics(id, pics), 30000);
      // 사진을 올리는 사이 지웠으면 쪽지를 만들지 않고 올린 사진도 지운다
      if (ls.get(DELETED, {})[id]) { await store.remove(id).catch(() => {}); continue; }
      await withTimeout(store.create(id, item), 8000);
      dropOutbox(id); dropOutPics(id);
    } catch (e) { failed++; }
  }
  if (failed) status('인터넷이 끊겨 쪽지를 이 기기에 모아 뒀어요. 연결되면 올라가요.');
  flushing = false;
  render();
}
function dropOutbox(id) { const box = ls.get(OUTBOX, {}); if (box[id]) { delete box[id]; ls.set(OUTBOX, box); } }

// 지운 쪽지 표시(7일 보관). 올라가는 중에 지운 쪽지가 늦게 서버에 생겨도 다시 지우고 화면에 안 보이게 한다.
const DELETED = 'ideabox-deleted';
function markDeleted(id) {
  const now = Date.now();
  const d = Object.fromEntries(Object.entries(ls.get(DELETED, {})).filter(([, t]) => now - t < 7 * 86400e3));
  d[id] = now;
  ls.set(DELETED, d);
}
function buryDeleted(v) {
  const d = ls.get(DELETED, {});
  const out = { ...v };
  for (const id of Object.keys(out)) if (d[id]) { delete out[id]; store?.remove(id).catch(() => {}); }
  return out;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

// ---------- 목록 ----------
function allItems() {
  const box = ls.get(OUTBOX, {});
  const list = Object.entries(ideas).map(([id, v]) => ({ id, ...v }));
  for (const [id, v] of Object.entries(box)) if (!ideas[id]) list.push({ id, ...v, pending: true });
  const hot = (x) => (x.hot && x.st !== 'done' ? 1 : 0);
  return list.sort((a, b) => hot(b) - hot(a) || b.at - a.at);
}
// «답장 옴»(2026-11-18, 효니 말 «쪽지함에서 답장 온 것들을 따로 분류»): 안 끝난 쪽지 중 클로드가 실제로 답한 것.
// 받아 두기(ideabox-collect)의 «받아 둠 — …» 자동 답장만 있는 쪽지는 넣지 않는다.
const isReplied = (x) => {
  if (x.st === 'done' || x.pending || x.src) return false;
  // 마지막 말이 클로드여야 함 — 효니가 그 뒤에 답했으면 다시 클로드 차례라 «답장 옴»이 아니다
  const c = threadOf(x).at(-1);
  return !!c && c.w === 'c' && !/^받아 둠/.test(c.x.trim());
};
const passF = (f, x) => (f === 'all' ? true : f === 'open' ? x.st !== 'done' : f === 're' ? isReplied(x) : x.st === f);
const pass = (x) => passF(filter, x);
// 찾기: 띄어 쓴 낱말이 모두 들어 있으면 맞음(글·주제·클로드 답장·효니 답·물을 것 출처)
let wordsCache = ['', []];
const words = () => (wordsCache[0] === query ? wordsCache[1] : (wordsCache = [query, query.toLowerCase().split(/\s+/).filter(Boolean)])[1]);
function matchQ(x) {
  const ws = words();
  if (!ws.length) return true;
  const hay = [x.t, x.tag, x.a, x.src?.l, x.src?.d, ...threadOf(x).map((m) => m.x)].filter(Boolean).join('\n').toLowerCase();
  return ws.every((w) => hay.includes(w));
}

// 새로 넣은 쪽지의 통통 움직임: 넣은 직후 곧바로 다시 그려져도(올리기·실시간 갱신) 0.8초 동안은 계속 붙인다
let freshMark = null;
function render(fresh) {
  if (fresh) freshMark = { id: fresh, t: Date.now() };
  else if (freshMark && Date.now() - freshMark.t < 800) fresh = freshMark.id;
  const all = allItems();
  const items = query.trim() ? all.filter(matchQ) : all;
  const board = view === 'board';
  for (const b of document.querySelectorAll('#views button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('#filters').hidden = $('#list').hidden = board;
  $('#board').hidden = !board;
  if (board) { $('#empty').hidden = true; return renderBoard(items, fresh, all); }
  // «효니에게 물을 것»(src)은 효니 쪽지가 아니라 판 맨 위에만 보인다(쪽지 목록·숫자에 섞지 않음)
  return renderList(items.filter((x) => !x.src), fresh);
}
function renderList(items, fresh) {
  const n = (f) => items.filter((x) => passF(f, x)).length;
  $('#filters').innerHTML = FILTERS.map(([f, label]) => `<button type="button" class="fchip" data-f="${f}" aria-pressed="${f === filter}">${label} <b>${n(f)}</b></button>`).join('');
  const shown = items.filter(pass);
  const ol = $('#list');
  ol.innerHTML = shown.map(card).join('');
  if (fresh) ol.querySelector(`[data-id="${fresh}"]`)?.classList.add('fresh');
  const empty = $('#empty');
  empty.hidden = shown.length > 0;
  empty.textContent = query.trim() ? `«${query.trim()}» 들어간 쪽지가 ${items.length ? '이 칸엔 ' : ''}없어요.` : items.length ? '여기엔 쪽지가 없어요.' : '아직 쪽지가 없어요. 떠오르는 생각을 위에 적어 보세요.';
  fillThumbs(ol);
  reveal();
}

// ---------- 할 일 판 ----------
// 쪽지를 주제별 묶음으로 보고 체크(=끝남)한다. 새 상태는 만들지 않는다: 체크 = st done, 풀기 = 다시 열기와 같다.
const isAsk = (x) => !!x.ask && x.st !== 'done' && !x.pending;
const firstLine = (s) => (String(s || '').split('\n').find((l) => l.trim()) || '').trim();

// ---------- 답하기 스레드(2026-11-18) ----------
// th = {키: {w 'c'|'h', x 글, at 때, q 질문}}. re·rat은 «클로드 마지막 말» 사본이라, th의 클로드 말 중에 같은 글이 없으면
// (옛 쪽지, 또는 re만 쓰는 runner.js·글감 ideas.js) 그 re를 rat 자리에 끼워 보인다. tools/inbox.js threadOf와 같은 식.
function threadOf(x) {
  const th = x.th && typeof x.th === 'object' ? x.th : {};
  const list = Object.entries(th)
    .filter(([, m]) => m && typeof m.x === 'string')
    .map(([k, m]) => ({ k, w: m.w === 'h' ? 'h' : 'c', x: m.x, at: Number(m.at) || 0, q: !!m.q }));
  if (x.re && !list.some((m) => m.w === 'c' && m.x === x.re)) list.push({ k: '', w: 'c', x: String(x.re), at: Number(x.rat) || Number(x.at) || 0, q: !!x.ask, legacy: true });
  return list.sort((a, b) => a.at - b.at);
}
const lastClaude = (x) => threadOf(x).filter((m) => m.w === 'c').at(-1) || null;
// 답할 수 있나: 안 끝났고, 올라간 쪽지이고, 클로드 말이 하나라도 있음
// 물을 것(src, asks.js)은 답을 a 칸으로 받아 계획 파일에 적으므로 이 창을 쓰지 않는다(옛 답하기 openSrcAnswer)
const canReply = (x) => x.st !== 'done' && !x.pending && !x.src && !!lastClaude(x);
// 클로드 질문 나누기: ①②… 줄이 둘 이상이면 질문마다, 줄 끝 [가 / 나]는 고르는 단추. 질문이 하나면 [ ]가 있을 때만.
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
function parseQs(text) {
  const opts = (s) => {
    const m = /\[([^\[\]]+)\]\s*$/.exec(s);
    if (!m || !m[1].includes('/')) return { q: s.trim(), o: [] };
    return { q: s.slice(0, m.index).trim(), o: m[1].split('/').map((v) => v.trim()).filter(Boolean).slice(0, 6) };
  };
  const lines = String(text || '').split('\n');
  const qs = lines.filter((l) => CIRCLED.includes(l.trim()[0] || ' ')).map((l) => ({ n: l.trim()[0], ...opts(l.trim().slice(1)) }));
  if (qs.length >= 2) return qs;
  const one = lines.map((l) => opts(l)).find((r) => r.o.length);
  return one ? [{ n: '', q: one.q, o: one.o }] : [];
}
// 말풍선들. 지금 묻는 중인 질문(ask 켜짐 + 마지막 클로드 말)만 귤색으로
let freshMsg = null; // 방금 보낸 내 답(키) — 한 번 떠오르는 움직임
function threadHtml(x) {
  const list = threadOf(x);
  if (!list.length) return '';
  const lastC = list.filter((m) => m.w === 'c').at(-1);
  const asking = isAsk(x);
  return `<ol class="thread">${list.map((m) => {
    const now = asking && m === lastC;
    const cls = m.w === 'h' ? 'msg me' : `msg cl${now ? ' is-ask' : ''}`;
    const who = m.w === 'h' ? '내 답' : now ? '❓ 클로드가 물어요' : m.q ? '클로드가 물었어요' : '클로드';
    return `<li class="${cls}${m.k && m.k === freshMsg ? ' fresh' : ''}"><span class="who">${who}</span><p>${esc(m.x)}</p>${m.at ? `<time>${when(m.at)}</time>` : ''}</li>`;
  }).join('')}</ol>`;
}
// 체크·되돌리기 patch(같은 계산을 카드 «끝남으로»·판 체크·되돌리기 줄이 함께 쓴다)
// «답 필요»(ask)는 건드리지 않는다: 끝난 쪽지엔 표시가 안 되고, 나중에 «다시 열기»하면 질문이 그대로 돌아온다.
// (Claude가 inbox.js reply/done을 하면 그때 꺼짐)
// 고른 PC가 아직 안 가져간 쪽지(run.n 'wait')를 끝내면 그 예약도 같이 지운다(끝난 쪽지를 실행기가 붙들지 않게). 하는 중인 run은 실행기가 정리한다.
// 끝내면 «다 했어요» 보고(rep)도 같이 지운다(되돌리면 복원).
function planCheck(x) { const w = isWait(x); return { patch: { st: 'done', go: null, rep: null, ...(w ? { run: null } : {}) }, undo: { st: x.st === 'done' ? 'seen' : x.st || 'new', go: x.go || null, rep: x.rep || null, ...(w ? { run: x.run } : {}) } }; }
// 다시 열 때 남은 go·run은 지운다(글감 옮기기 등 바깥에서 끝남이 된 쪽지를 열자마자 실행기가 시작하지 않게)
function planReopen(x) { return { patch: { st: x.re ? 'seen' : 'new', go: null, run: null }, undo: { st: 'done', go: x.go || null, run: x.run || null } }; }
// 클로드에게 시키기(2026-11-18): 판에서 안 끝난 쪽지를 체크하면 go(시킨 때)를 쓰고, PC 실행기(tools/runner.js)가 가져가 run {pc, at}을 쓴다.
// 클로드가 inbox.js done/reply/ask를 하면 go·run이 지워진다. 하는 중(run)엔 체크를 못 풀고, 4시간 넘게 멈춰 있으면 풀 수 있다.
// PC 고르기(2026-11-18, 출처: 효니 말 «왜 켜진 컴퓨터 말고 학교 PC가 가져갔냐», «차라리 나한테 물어보는 게 낫지않냐»): 체크하면 켜진 PC를 보여 주고 고르게 한다.
// 고른 PC는 run { pc, at, n: 'wait' }로 적는다 — 그 PC 실행기만 가져가고, 옛 실행기는 run이 있는 쪽지를 건드리지 않는다.
const STALE = 4 * 3600e3;
const SLOW = 3 * 60e3; // 고른 PC가 이만큼 지나도 안 가져가면 알린다(실행기는 1분마다 봄)
const LIVE = 150e3; // 켜짐 신호가 이 안에 있으면 켜진 PC
const isWait = (x) => !!x.run && x.run.n === 'wait' && x.st !== 'done' && !x.pending;
const isRun = (x) => !!x.run && x.run.n !== 'wait' && x.st !== 'done' && !x.pending;
const isStale = (x) => isRun(x) && Date.now() - (x.run.at || 0) > STALE;
const isGo = (x) => (!!x.go || isRun(x) || isWait(x)) && x.st !== 'done' && !x.pending;
// 시킨 일이 끝나 클로드가 보고함(rep = 보고한 때, 실행기·자동 세션이 씀) — 효니가 «끝남으로»·«봤어요»·답하기 전까지
const isRep = (x) => !!x.rep && x.st !== 'done' && !x.pending && !isGo(x);
// 시킨 일 중에 클로드가 물은 것(again)에 답하면 하던 PC(spc)에서 이어서 하게 다시 시킨다.
// 하던 PC를 모르면 시키지 않는다 — PC를 안 고른 시키기는 실행기가 받지 않으므로(2026-11-18, 출처: 효니 말 «나한테 안 물어보던데»)
const PICK_AGAIN = '답을 넣었어요. 이어서 시키려면 체크해서 PC를 골라 주세요';
function rego(cur, now) {
  if (!cur.again) return {};
  return cur.spc ? { go: now, again: null, run: { pc: cur.spc, at: now, n: 'wait' } } : { again: null };
}
function planGo(x, pc) { const now = Date.now(); return { patch: { go: now, again: null, run: { pc, at: now, n: 'wait' } }, undo: { go: null, again: x.again || null, run: null } }; }
function planStop(x) { return { patch: { go: null, run: null }, undo: { go: x.go || null, run: x.run || null } }; }

function renderBoard(found, fresh, everything = found) {
  // 물을 것(src)은 맨 위 칸에만, 끝난 것은 안 보임(원본 파일이 기록)
  const asks = everything.filter((x) => x.src && x.st !== 'done');
  const items = everything.filter((x) => !x.src);
  // 남은 일·답 필요·시킨 일 모두 물을 것까지 같이 센다(숫자끼리 어긋나지 않게)
  const open = [...items.filter((x) => x.st !== 'done'), ...asks];
  const nAsk = open.filter(isAsk).length;
  const nHot = open.filter((x) => x.hot).length;
  const nGo = open.filter(isGo).length;
  const nRep = open.filter((x) => isRep(x) && !isAsk(x)).length;
  $('#board-sum').innerHTML = items.length || asks.length
    ? `남은 일 <b>${open.length}</b>${nRep ? ` · <span class="sum-rep">🔔 확인할 것 <b>${nRep}</b></span>` : ''}${nAsk ? ` · <span class="sum-ask">❓ 답 필요 <b>${nAsk}</b></span>` : ''}${nHot ? ` · <span class="sum-hot">🔥 급해요 <b>${nHot}</b></span>` : ''}${nGo ? ` · <span class="sum-go">🤖 시킨 일 <b>${nGo}</b></span>` : ''}<br><span class="sum-help">체크하면 어느 PC에서 할지 물어봐요. 고른 PC에서 클로드가 시작하고, 다 하면 답장이 달려요.</span>`
    : '아직 쪽지가 없어요. 떠오르는 생각을 위에 적어 보세요.';
  const searching = !!query.trim();
  const fAsks = searching ? asks.filter(matchQ) : asks;
  // 찾은 수는 판에 실제로 보이는 것만(끝난 물을 것은 판에 안 보이므로 뺀다)
  if (searching) $('#board-sum').innerHTML += `<br><span class="sum-find">🔎 «${esc(query.trim())}» 찾은 것 <b>${found.filter((x) => !x.src).length + fAsks.length}</b></span>`;
  // 묶음: 주제 순서대로, 남은 일이 있는 묶음 먼저. 모르는 주제는 «일반»에.
  const known = new Set(TAGS.map(([t]) => t));
  const groups = TAGS.map(([tag, ico]) => {
    const all = items.filter((x) => (known.has(x.tag) ? x.tag : '일반') === tag && (!searching || matchQ(x)));
    const rank = (x) => (isAsk(x) ? 8 : 0) + (isRep(x) ? 4 : 0) + (isGo(x) ? 2 : 0) + (x.hot ? 1 : 0);
    const todo = all.filter((x) => x.st !== 'done').sort((a, b) => rank(b) - rank(a) || b.at - a.at);
    const done = all.filter((x) => x.st === 'done').sort((a, b) => (b.rat || b.at) - (a.rat || a.at));
    return { tag, ico, todo, done };
  }).filter((g) => g.todo.length || g.done.length);
  groups.sort((a, b) => (b.todo.length ? 1 : 0) - (a.todo.length ? 1 : 0));
  // 통째로 다시 그려도 키보드 자리를 잃지 않게: 누르던 단추(같은 쪽지·같은 동작 또는 같은 묶음 머리)로 돌려놓는다
  const a = document.activeElement;
  const box = $('#groups');
  const keep = a && box.contains(a) ? { id: a.closest('[data-id]')?.dataset.id, tag: a.closest('.group')?.dataset.tag, act: a.dataset.act } : null;
  box.innerHTML = (asksBlock(fAsks) + groups.map((g) => group(g, searching)).join('')) || (searching ? '<p class="empty">찾는 말이 들어간 쪽지가 없어요.</p>' : '');
  if (keep) {
    const sel = keep.id ? `[data-id="${CSS.escape(keep.id)}"] [data-act="${keep.act}"]` : `.group[data-tag="${CSS.escape(keep.tag || '')}"] [data-act="${keep.act}"]`;
    box.querySelector(sel)?.focus({ preventScroll: true });
  }
  if (fresh) box.querySelector(`[data-id="${CSS.escape(fresh)}"]`)?.classList.add('fresh');
  fillThumbs($('#groups'));
}
// «❓ 효니에게 물을 것»(2026-11-18): 여러 일의 계획·작업 목록에서 모은 물음. 건수와 앞의 3개만, 나머지는 접힘.
// 순서: 아직 답 안 한 것 → 답한 것 → 시킨 것, 같은 칸 안에선 최근 것 먼저. 줄은 쪽지 줄(row)과 같은 체크(=시키기)·펼치기·답하기를 쓴다.
let asksOpen = false;
function asksBlock(asks) {
  if (!asks.length) return '';
  const rank = (x) => (isGo(x) ? 2 : x.a ? 1 : 0);
  const list = [...asks].sort((a, b) => rank(a) - rank(b) || b.at - a.at);
  const all3 = asksOpen || !!query.trim();
  const head = list.slice(0, 3);
  const rest = list.slice(3);
  const nA = asks.filter((x) => x.a && !isGo(x)).length;
  return `<section class="group asks" data-tag="❓" aria-labelledby="asks-h">
    <h3 class="asks-head" id="asks-h"><span class="gname">❓ 효니에게 물을 것</span><span class="gcount"><b>${asks.length}</b>건${nA ? ` · 답한 것 ${nA}` : ''}</span></h3>
    <p class="asks-help">여러 일의 계획에서 모았어요. 답하면 그 계획 파일에 적히고, 체크하면 클로드가 그 답으로 바로 이어서 해요.</p>
    <div class="gbody">
      <ul class="rows">${head.map(row).join('')}</ul>
      ${rest.length ? `${all3 ? `<ul class="rows asks-rest">${rest.map(row).join('')}</ul>` : ''}
      ${query.trim() ? '' : `<button type="button" class="done-toggle" data-act="asksfold" aria-expanded="${asksOpen}">나머지 ${rest.length}개 ${asksOpen ? '접기' : '보기'}</button>`}` : ''}
    </div>
  </section>`;
}
function group(g, searching = false) {
  const closed = !searching && closedGroups.has(g.tag);
  const gid = 'g-' + TAGS.findIndex(([t]) => t === g.tag);
  const doneOpen = searching || openDone.has(g.tag);
  return `<section class="group${closed ? ' closed' : ''}" data-tag="${esc(g.tag)}">
    <h3><button type="button" class="ghead" data-act="group" aria-expanded="${!closed}" aria-controls="${gid}">
      <span class="gname">${g.ico} ${esc(g.tag)}</span><span class="gcount">${g.todo.length ? `남은 <b>${g.todo.length}</b>` : '다 끝남'}</span><span class="caret" aria-hidden="true"></span>
    </button></h3>
    <div class="gbody" id="${gid}"${closed ? ' hidden' : ''}>
      ${g.todo.length ? `<ul class="rows">${g.todo.map(row).join('')}</ul>` : ''}
      ${g.done.length ? `<button type="button" class="done-toggle" data-act="donefold" aria-expanded="${doneOpen}">끝낸 것 ${g.done.length}개 ${doneOpen ? '접기' : '보기'}</button>
      ${doneOpen ? `<ul class="rows rows-done">${g.done.map(row).join('')}</ul>` : ''}` : ''}
    </div>
  </section>`;
}
function row(x) {
  const done = x.st === 'done';
  const ask = isAsk(x);
  const go = isGo(x);
  const running = isRun(x);
  const stale = isStale(x);
  const expanded = openRows.has(x.id);
  const ph = Array.isArray(x.ph) ? x.ph.filter(Boolean) : [];
  const title = firstLine(x.t) || (ph.length ? `📷 사진 ${ph.length}장` : '(빈 쪽지)');
  const last = threadOf(x).at(-1);
  const sub = x.pending ? '<span class="tsub wait">올라가길 기다리는 중</span>'
    : stale ? '<span class="tsub wait">⚠️ 멈춘 것 같아요 — 체크를 풀고 다시 체크해 주세요</span>'
    : running ? `<span class="tsub go">⏳ 클로드가 하는 중 · ${esc(x.run.pc || '')}</span>`
    : isWait(x) ? (Date.now() - (x.run.at || 0) > SLOW ? `<span class="tsub wait">⚠️ ${esc(x.run.pc || '')}가 아직 안 가져갔어요 — 체크를 풀고 다시 골라 주세요</span>` : `<span class="tsub go">🤖 시켰어요 · ${esc(x.run.pc || '')}에서 곧 시작해요</span>`)
    : go ? '<span class="tsub go">🤖 시켰어요 · 곧 시작해요</span>'
    : isRep(x) && !ask && last ? `<span class="tsub rep">🔔 다 했어요 · ${esc(firstLine(last.x))}</span>`
    // 물을 것: 출처와 «답이 없으면», 답했으면 내 답(클로드가 덧붙여 물었으면 그 물음)
    : x.src && !(ask && x.re) ? (x.a ? `<span class="tsub">✍️ 내 답: ${esc(firstLine(x.a))}</span>`
      : `<span class="tsub src">📌 ${esc(x.src.l || '')}${x.src.d ? ` · 답이 없으면 ${esc(x.src.d)}` : ''}</span>`)
    : last?.w === 'h' ? `<span class="tsub me">💬 내 답: ${esc(firstLine(last.x))}</span>`
    : last ? `<span class="tsub${ask ? ' ask' : ''}">${ask ? '❓ ' : '클로드: '}${esc(firstLine(last.x))}</span>` : '';
  const marks = `${x.hot && !done ? '<span class="tmark hot" title="급해요">🔥</span>' : ''}${ph.length ? '<span class="tmark" title="사진">📷</span>' : ''}`;
  // 펼치면 제목 줄이 첫 줄 전체를 보여 주므로, 글은 그 다음 줄부터만
  const rest = String(x.t || '').replace(/^\s*[^\n]*\n?/, '').replace(/^\s+/, '');
  const src = x.src ? `<p class="src-info">📌 ${esc(x.src.l || '')} <span class="src-path">${esc(x.src.f || '')}</span></p>
      ${x.src.d ? `<p class="src-def">답이 없으면: ${esc(x.src.d)}</p>` : ''}
      ${x.a ? `<div class="reply mine"><span class="who">✍️ 내 답</span><p>${esc(x.a)}</p><time>${when(x.aat || x.at)}${x.aw ? ' · 계획 파일에 적음' : ''}</time></div>` : ''}` : '';
  // 물을 것(src)은 답 칸 a로 답한다(계획 파일에 적힘, openSrcAnswer). 일반 쪽지는 클로드 말이 있으면 대화(답하기 창)
  const editBtn = x.src ? `<button type="button" data-act="edit">${x.a && !ask ? '답 고치기' : '답하기'}</button>`
    : canReply(x) ? '<button type="button" data-act="reply">답하기</button>' : '<button type="button" data-act="edit">고치기</button>';
  const more = expanded ? `<div class="tmore">
      ${rest ? `<p class="text">${esc(rest)}</p>` : ''}
      ${src}
      ${ph.length ? `<div class="thumbs">${ph.map((k, i) => `<button type="button" class="thumb" data-act="pic" data-k="${esc(k)}" data-i="${i}" aria-label="사진 ${i + 1} 크게 보기"><img alt="" data-pic="${esc(x.id)}/${esc(k)}"></button>`).join('')}</div>` : ''}
      ${threadHtml(x)}
      <div class="row"><span class="tmeta">${when(x.at)}${x.ed ? ' · 고침' : ''}</span><span class="acts">${x.pending ? '' : `${editBtn}${done || x.src ? '' : '<button type="button" data-act="done">끝남으로</button>'}`}${x.src ? '' : '<button type="button" class="del" data-act="del">지우기</button>'}</span></div>
    </div>` : '';
  return `<li class="trow${done ? ' is-done' : ''}${go ? ' is-go' : ''}${ask ? ' is-ask' : ''}${x.hot && !done ? ' is-hot' : ''}${expanded ? ' open' : ''}" data-id="${esc(x.id)}">
    ${done ? `<label class="tcheck"><input type="checkbox" data-act="check" checked><span class="vh">끝남 — 풀면 다시 열어요: ${esc(title)}</span></label>`
      : `<label class="tcheck go" title="${running && !stale ? '클로드가 하는 중이에요' : go ? '풀면 시키기를 취소해요' : '체크하면 클로드가 시작해요'}"><input type="checkbox" data-act="go"${go ? ' checked' : ''}${x.pending || (running && !stale) ? ' disabled' : ''}><span class="vh">${running && !stale ? '클로드가 하는 중' : go ? '클로드에게 시킴 — 풀면 취소' : '클로드에게 시키기'}: ${esc(title)}</span></label>`}
    <button type="button" class="tmain" data-act="expand" aria-expanded="${expanded}"><span class="ttitle">${esc(title)}</span>${sub}</button>
    ${marks ? `<span class="tmarks">${marks}</span>` : ''}
    ${more}
  </li>`;
}
function onBoardClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'group') {
    const tag = b.closest('.group').dataset.tag;
    closedGroups.has(tag) ? closedGroups.delete(tag) : closedGroups.add(tag);
    ls.set(CLOSED, [...closedGroups]);
    return render();
  }
  if (act === 'donefold') {
    const tag = b.closest('.group').dataset.tag;
    openDone.has(tag) ? openDone.delete(tag) : openDone.add(tag);
    return render();
  }
  if (act === 'asksfold') { asksOpen = !asksOpen; return render(); }
  if (act === 'expand') {
    const id = b.closest('[data-id]').dataset.id;
    openRows.has(id) ? openRows.delete(id) : openRows.add(id);
    return render();
  }
  return onListClick(e); // 사진·고치기·지우기는 카드와 같은 처리
}
function onBoardCheck(e) {
  const box = e.target.closest('input[data-act="check"], input[data-act="go"]');
  if (!box) return;
  const id = box.closest('[data-id]').dataset.id;
  const x = ideas[id];
  if (!x) { box.checked = !box.checked; return toast('아직 올라가지 않은 쪽지예요.'); }
  if (box.dataset.act === 'go') return goItem(id, x, box.checked);
  checkItem(id, x, box.checked);
}
// 시키기 또는 취소. 되돌리기 줄은 끝남 체크와 같다.
async function goItem(id, x, on) {
  let pc = '';
  if (on) {
    pc = await pickPc();
    if (!pc) return render(); // 그만둠 → 체크 풀기
    if (!ideas[id] || ideas[id].st === 'done' || isRun(ideas[id])) { render(); return toast('그새 쪽지가 바뀌었어요.'); }
    x = ideas[id];
  }
  const plan = on ? planGo(x, pc) : planStop(x);
  try {
    await withTimeout(store.patch(id, plan.patch), 8000);
    if (on) ls.set(LASTPC, pc);
    showUndo(on ? `${pc}에서 하라고 시켰어요` : '시키기를 취소했어요', id, plan.undo);
  } catch (e) { hideUndo(); render(); toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}
// 체크(끝남) 또는 풀기(다시 열기). 되돌리기 줄을 목록 밖 아래에 띄운다.
async function checkItem(id, x, toDone) {
  const plan = toDone ? planCheck(x) : planReopen(x);
  const msg = toDone ? '끝남으로 옮겼어요' : '다시 열었어요';
  try {
    await withTimeout(store.patch(id, plan.patch), 8000);
    showUndo(msg, id, plan.undo);
  } catch (e) { hideUndo(); render(); toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}
let undoState = null;
let undoTimer;
function showUndo(msg, id, part) {
  undoState = { id, part };
  $('#undo-msg').textContent = msg;
  $('#undo').hidden = false;
  $('#toast').classList.remove('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}
function hideUndo() { clearTimeout(undoTimer); undoState = null; $('#undo').hidden = true; }
async function doUndo() {
  const u = undoState;
  hideUndo();
  if (!u || !ideas[u.id]) return toast('되돌릴 쪽지가 없어요.');
  await run(store.patch(u.id, u.part), '되돌렸어요');
}

function card(x) {
  const ico = (TAGS.find(([t]) => t === x.tag) || TAGS[0])[1];
  const st = x.pending ? '<span class="badge wait">올라가길 기다리는 중</span>' : `<span class="badge ${x.st}">${STATES[x.st] || ''}</span>`;
  const ask = isAsk(x);
  const re = threadHtml(x);
  const editBtn = canReply(x) ? '<button type="button" data-act="reply">답하기</button>' : '<button type="button" data-act="edit">고치기</button>';
  const ph = Array.isArray(x.ph) ? x.ph.filter(Boolean) : [];
  const pics = ph.length ? `<div class="thumbs">${ph.map((k, i) => `<button type="button" class="thumb" data-act="pic" data-k="${esc(k)}" data-i="${i}" aria-label="사진 ${i + 1} 크게 보기"><img alt="" data-pic="${esc(x.id)}/${esc(k)}"></button>`).join('')}</div>` : '';
  const doneBtn = x.st === 'done' ? '<button type="button" data-act="reopen">다시 열기</button>' : '<button type="button" data-act="done">끝남으로</button>';
  return `<li class="card${x.hot && x.st !== 'done' ? ' is-hot' : ''}${x.st === 'done' ? ' is-done' : ''}${shownIds.has(x.id) ? ' show' : ''}" data-id="${esc(x.id)}">
    <div class="meta"><span class="tag">${ico} ${esc(x.tag || '일반')}</span>${x.hot ? '<span class="hotmark">🔥 급해요</span>' : ''}${ask ? '<span class="askmark">❓ 답 필요</span>' : isRep(x) ? '<span class="repmark">🔔 다 했어요</span>' : ''}${isRun(x) ? '<span class="gomark">⏳ 클로드가 하는 중</span>' : isWait(x) ? `<span class="gomark">🤖 시킴 · ${esc(x.run.pc || '')}</span>` : isGo(x) ? '<span class="gomark">🤖 시킴</span>' : ''}<time>${when(x.at)}${x.ed ? ' · 고침' : ''}</time></div>
    ${x.t ? `<p class="text">${esc(x.t)}</p>` : ''}
    ${pics}
    ${re}
    <div class="row">${st}<span class="acts">${x.pending ? '' : `${editBtn}${doneBtn}`}<button type="button" class="del" data-act="del">지우기</button></span></div>
  </li>`;
}

async function onListClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  const x = ideas[id];
  const act = b.dataset.act;
  if (act === 'pic') return viewPic(id, b.dataset.k, Number(b.dataset.i) || 0);
  if (act === 'del') {
    if (!(await ask('이 쪽지를 지울까요? 되돌릴 수 없어요.'))) return;
    // 우편함에서 먼저 빼야 다음 올리기가 지운 쪽지를 되살리지 않는다
    dropOutbox(id);
    dropOutPics(id);
    markDeleted(id);
    setReplyDraft(id, null);
    render();
    if (!ideas[id]) return toast('지웠어요');
    return run(store.remove(id), '지웠어요');
  }
  if (!x) return;
  if (act === 'edit') return openEdit(id, x);
  if (act === 'reply') return openReply(id);
  if (act === 'done') return checkItem(id, x, true);
  if (act === 'reopen') return checkItem(id, x, false);
}
async function run(p, msg) {
  try { await withTimeout(p, 8000); toast(msg); } catch (e) { toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}

// 물을 것(src)의 답하기: 물음(t)은 그대로 두고 빈 칸에 답만 적어 a·aat에 저장. 주제·급해요·사진 칸은 숨김.
let editSrc = false;
function setEditMode(src) {
  editSrc = src;
  $('#edit-tags').hidden = src;
  $('#edit-form .edit-row').hidden = src;
  $('#edit-t').placeholder = src ? '답을 적어 주세요' : '';
  $('#edit-ask .ask-who').textContent = '❓ 클로드가 물어요';
}
function openSrcAnswer(id, x) {
  editing = id;
  setEditMode(true);
  $('#edit-t').value = x.a || '';
  $('#edit-ask').hidden = false;
  $('#edit-ask .ask-who').textContent = `📌 ${x.src.l || '계획'}에서 물어요`;
  $('#edit-ask-q').textContent = (x.t || '') + (x.src.d ? `\n\n답이 없으면: ${x.src.d}` : '') + (x.ask && x.re ? `\n\n클로드가 덧붙여 물어요: ${x.re}` : '');
  $('#edit-title').textContent = x.a && !x.ask ? '답 고치기' : '물음에 답하기';
  $('#edit-ask .ask-help').textContent = x.again && x.spc ? '저장하면 계획 파일에 적히고 클로드가 바로 이어서 해요.'
    : '저장하면 그 계획 파일에 날짜와 함께 적혀요. 클로드가 바로 하게 하려면 판에서 체크해 주세요.';
  editGen++;
  editPics = [];
  renderEditPics();
  $('#edit').showModal();
  grow($('#edit-t'));
}
async function saveAnswer() {
  const a = $('#edit-t').value.trim();
  const id = editing;
  const cur = ideas[id];
  if (!cur) { $('#edit').close(); editing = null; return toast('다른 곳에서 지워진 물음이에요.'); }
  if (!a) { $('#edit-t').focus(); return toast('답을 적어 주세요.'); }
  $('#edit').close();
  editing = null;
  if (a === (cur.a || '') && !cur.ask) return toast('바뀐 게 없어요');
  const part = { a, aat: Date.now(), ask: null, rep: null };
  // 시킨 일을 하다 클로드가 덧붙여 물은 것(again)에 답하면 다시 시킨다
  Object.assign(part, rego(cur, part.aat));
  try {
    await withTimeout(store.patch(id, part), 8000);
    toast(part.go ? '답을 넣었어요. 클로드가 이어서 해요' : cur.again ? PICK_AGAIN : '답을 넣었어요. 계획 파일에 적어 둘게요');
  } catch (e) { toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}

function openEdit(id, x) {
  if (x.src) return openSrcAnswer(id, x);
  editing = id;
  setEditMode(false);
  $('#edit-t').value = x.t;
  setChip('etag', x.tag);
  $('#edit-hot').checked = !!x.hot;
  // 답은 «답하기» 창(스레드)으로 한다. 이 창은 원래 글·사진·주제만 고친다(2026-11-18).
  // 질문 상자(#edit-ask)는 물을 것(src) 답하기만 쓴다
  $('#edit-ask').hidden = true;
  $('#edit-title').textContent = '쪽지 고치기';
  editGen++;
  shrinking.edit = 0; // 앞 창에서 줄이던 사진은 버리므로 «줄이는 중» 칸도 비운다
  editPics = (Array.isArray(x.ph) ? x.ph.filter(Boolean) : []).map((k) => ({ k, src: `${id}/${k}`, old: true }));
  renderEditPics();
  $('#edit').showModal();
  grow($('#edit-t'));
}
async function saveEdit() {
  const t = $('#edit-t').value.trim();
  if (!editing) return;
  if (editSrc) return saveAnswer();
  if (shrinking.edit) return toast('사진을 줄이는 중이에요. 잠깐만요.');
  if (!t && !editPics.length) { $('#edit-t').focus(); return toast('글이나 사진 중 하나는 있어야 해요.'); }
  const id = editing;
  const cur = ideas[id];
  if (!cur) { $('#edit').close(); editing = null; return toast('다른 곳에서 지워진 쪽지예요.'); }
  const oldKeys = Array.isArray(cur.ph) ? cur.ph.filter(Boolean) : [];
  const newKeys = editPics.map((p) => p.k);
  const added = editPics.filter((p) => !p.old);
  const removed = oldKeys.filter((k) => !newKeys.includes(k));
  const picsChanged = added.length > 0 || removed.length > 0;
  const part = { t, tag: chipVal('etag'), hot: $('#edit-hot').checked || null, ed: Date.now() };
  if (picsChanged) part.ph = newKeys.length ? newKeys : null;
  // 클로드가 읽은 뒤 글이나 사진을 고쳤으면 다시 «새 쪽지»로 돌려 다음에 또 읽게 한다
  if (cur.st === 'seen' && (t !== (cur.t || '') || picsChanged)) part.st = 'new';
  // «답 필요» 쪽지에 글·사진을 더했으면 답한 것으로 보고 끈다(위 줄이 «새 쪽지»로 돌려 클로드가 다시 읽음)
  if (cur.ask && cur.st !== 'done' && (t !== (cur.t || '') || picsChanged)) { part.ask = null; part.st = 'new'; }
  // 시킨 일을 하다 클로드가 물은 것(again)에 답하면 다시 시켜 이어서 하게 한다
  if (part.ask === null) Object.assign(part, { rep: null }, rego(cur, part.ed));
  $('#edit').close();
  editing = null;
  // 순서: 새 사진 올리기 → 쪽지 고치기 → 뺀 사진 지우기(중간에 끊겨도 쪽지가 없는 사진을 가리키지 않게)
  try {
    await withTimeout(store.putPics(id, Object.fromEntries(added.map((p) => [p.k, { s: p.s, b: p.b }]))), 30000);
    await withTimeout(store.patch(id, part), 8000);
    for (const p of added) thumbs.set(`${id}/${p.k}`, p.s);
    toast(part.go ? '답을 넣었어요. 클로드가 이어서 해요' : part.ask === null && cur.again ? PICK_AGAIN : part.ask === null ? '답을 넣었어요. 클로드가 다음에 읽어요' : '고쳤어요');
  } catch (e) { return toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
  store.dropPics(id, removed).catch(() => {});
}

// «어느 PC에서 할까요?» 창. 켜져 있고 클로드를 열 수 있는 PC만 누를 수 있다. 고른 PC 이름 또는 ''(그만둠).
const LASTPC = 'ideabox-last-pc';
const ago = (ms) => (ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60e3))}분 전` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}시간 전` : `${Math.round(ms / 86400e3)}일 전`);
async function pickPc() {
  let rs;
  try { rs = await withTimeout(store.runners(), 8000); } catch (e) { toast('PC 목록을 불러오지 못했어요. 인터넷을 확인해 주세요.'); return ''; }
  const now = Date.now();
  const last = ls.get(LASTPC, '');
  const list = Object.entries(rs || {}).filter(([, r]) => r && r.at).map(([pc, r]) => ({ pc, at: r.at, live: now - r.at < LIVE, ok: !!r.ok, why: r.why || '' }))
    .sort((a, b) => (b.live && b.ok ? 1 : 0) - (a.live && a.ok ? 1 : 0) || (b.pc === last ? 1 : 0) - (a.pc === last ? 1 : 0) || b.at - a.at);
  const can = list.filter((r) => r.live && r.ok);
  const d = $('#pick');
  $('#pick-help').textContent = can.length ? '켜져 있는 PC만 고를 수 있어요.' : list.length ? '지금 켜진 PC가 없어요. PC에서 클로드 Code를 한 번 열면 1~2분 뒤 여기에 떠요.' : '아직 준비된 PC가 없어요. PC에서 클로드 Code를 한 번 열어 주세요.';
  $('#pick-list').innerHTML = list.map((r) => `<li><button type="button" class="pc${r.live && r.ok ? '' : ' off'}" data-pc="${esc(r.pc)}"${r.live && r.ok ? '' : ' disabled'}><span class="pc-name">💻 ${esc(r.pc)}</span><span class="pc-st">${!r.live ? `꺼져 있어요 · ${ago(now - r.at)}` : r.ok ? '켜져 있어요' : `켜져 있지만 클로드를 못 열어요${r.why ? ` (${esc(r.why)})` : ''}`}</span></button></li>`).join('');
  return new Promise((ok) => {
    const onPick = (e) => { const b = e.target.closest('button[data-pc]'); if (b && !b.disabled) d.close('pc:' + b.dataset.pc); };
    const onClose = () => { d.removeEventListener('close', onClose); $('#pick-list').removeEventListener('click', onPick); $('#pick-no').onclick = null; ok(d.returnValue.startsWith('pc:') ? d.returnValue.slice(3) : ''); };
    $('#pick-list').addEventListener('click', onPick);
    $('#pick-no').onclick = () => d.close('');
    d.returnValue = '';
    d.addEventListener('close', onClose);
    d.showModal();
    ($('#pick-list button:not([disabled])') || $('#pick-no')).focus();
  });
}

// ---------- «클로드가 다 했어요» 보고 창 ----------
// 시킨 일이 끝나면 실행기·자동 세션이 rep(보고한 때)를 찍는다. 앱을 열 때·화면으로 돌아올 때·새 보고가 올 때 이 창을 띄운다.
// 끝남은 효니가 여기서 정한다(2026-11-18, 출처: 효니 말 «나 확인도 안 했는데 그냥 완료됨으로 넘어가버리는데», «끝나면 나한테 보고를 해줘야 알 거 아냐 팝업을 띄우든지»).
// «나중에 볼게요»는 이 화면에서만 덮어 두고, 화면을 떠났다 오면 다시 띄운다. 창이 열린 다른 창(고치기·답하기 등)이 있으면 기다린다.
const repLater = new Map(); // 쪽지 id → 덮어 둔 보고(rep)
const repItems = () => Object.entries(ideas).map(([id, x]) => ({ ...x, id })).filter((x) => isRep(x) && !isAsk(x) && !x.src && lastClaude(x)).sort((a, b) => a.rep - b.rep);
function maybeReport() {
  if (!store || store.offline) return;
  const d = $('#rep');
  const list = repItems();
  if (d.open) return list.length ? fillReport(list) : d.close();
  if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return;
  if (!list.some((x) => repLater.get(x.id) !== x.rep)) return;
  fillReport(list);
  d.showModal();
  ($('#rep-list button') || $('#rep-later')).focus();
}
function fillReport(list) {
  $('#rep-list').innerHTML = list.map((x) => `<li class="rep-item" data-rid="${esc(x.id)}">
    <span class="rep-t">${esc(firstLine(x.t) || '(사진 쪽지)')}</span>
    <p class="rep-re">${esc(lastClaude(x).x)}</p>
    <div class="rep-acts"><button type="button" class="text-btn" data-rep="seen">봤어요(안 끝남)</button>${canReply(x) ? '<button type="button" class="text-btn" data-rep="reply">답하기</button>' : ''}<button type="button" class="text-btn" data-rep="done">끝남으로</button></div>
  </li>`).join('');
}
async function onReportAct(e) {
  const b = e.target.closest('button[data-rep]');
  if (!b) return;
  const id = b.closest('[data-rid]').dataset.rid;
  const x = ideas[id];
  if (!x) return maybeReport();
  const act = b.dataset.rep;
  b.disabled = true;
  try {
    if (act === 'done') {
      const plan = planCheck(x);
      await withTimeout(store.patch(id, plan.patch), 8000);
      showUndo('끝남으로 옮겼어요', id, plan.undo);
    } else if (act === 'reply') {
      // 보고(rep)는 답을 실제로 보낼 때 지운다(sendReply) — 답하기 창을 그냥 닫아도 🔔이 남게
      $('#rep').close();
      openReply(id);
    } else await withTimeout(store.patch(id, { rep: null }), 8000);
  } catch (err) { b.disabled = false; toast('저장하지 못했어요. 인터넷을 확인해 주세요.'); }
}

// ---------- 답하기 창(스레드) ----------
// 원래 글은 그대로 두고 답을 th에 새 메시지로 쌓는다. 쓰던 답은 쪽지마다 기기에 남긴다(창을 실수로 닫아도).
const REPLY_DRAFT = 'ideabox-reply-draft';
let replying = null; // { id, qs }
function setReplyDraft(id, v) {
  const m = ls.get(REPLY_DRAFT, {}) || {};
  if (v == null) { if (!(id in m)) return; delete m[id]; } else m[id] = v;
  ls.set(REPLY_DRAFT, m);
}
function openReply(id) {
  const x = ideas[id];
  if (!x || !canReply({ ...x, id })) return;
  const lc = lastClaude(x);
  // 지금 묻는 중이면 그 질문을 나눠 칸마다 답하게, 아니면 한 칸
  const qs = isAsk({ ...x, id }) ? parseQs(lc.x) : [];
  // lcAt: 창을 연 때의 클로드 마지막 말. 보낼 때 바뀌었으면(새 질문·끝남) 다시 보여 준다.
  // k: 이 창에서 보낼 답의 키 — 끊겨서 다시 눌러도 같은 칸을 덮어 두 번 쌓이지 않게
  replying = { id, qs, lcAt: lc.at, k: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), sending: false };
  // 쓰던 답은 같은 질문(lcAt)일 때만 되살린다 — 클로드가 새로 물으면 옛 답이 새 칸에 들어가지 않게
  const saved = ls.get(REPLY_DRAFT, {})?.[id];
  const draft = saved && (saved.for == null || saved.for === lc.at) ? saved : {};
  $('#reply-title').textContent = isAsk({ ...x, id }) ? '클로드에게 답하기' : '클로드와 이야기';
  // 원래 글(내 쪽지)도 첫 말풍선으로
  const ph = Array.isArray(x.ph) ? x.ph.filter(Boolean).length : 0;
  $('#reply-thread').innerHTML = `<ol class="thread"><li class="msg me first"><span class="who">내 쪽지</span><p>${esc(x.t || '')}${ph ? `${x.t ? '\n' : ''}📷 사진 ${ph}장` : ''}</p><time>${when(x.at)}</time></li></ol>${threadHtml({ ...x, id })}`;
  const box = $('#reply-qs');
  if (qs.length) {
    box.innerHTML = qs.map((q, i) => `<fieldset class="rq" data-i="${i}">
      <legend>${q.n ? `<b>${q.n}</b> ` : ''}${esc(q.q || '고르기')}</legend>
      ${q.o.length ? `<div class="ropts">${q.o.map((o) => `<button type="button" class="ropt" data-o="${esc(o)}" aria-pressed="${draft.pick?.[i] === o}">${esc(o)}</button>`).join('')}</div>` : ''}
      <label class="vh" for="rq-${i}">${q.n || ''} ${q.o.length ? '덧붙일 말' : '답'}</label>
      <textarea id="rq-${i}" rows="${q.o.length ? 1 : 2}" maxlength="2000" placeholder="${q.o.length ? '덧붙일 말(안 써도 돼요)' : '답'}">${esc(draft.text?.[i] || '')}</textarea>
    </fieldset>`).join('');
  } else {
    box.innerHTML = `<label class="vh" for="rq-0">답</label><textarea id="rq-0" rows="3" maxlength="4000" placeholder="답을 적어 주세요">${esc(draft.text?.[0] || '')}</textarea>`;
  }
  $('#reply-help').textContent = `보내면 ${x.again && x.spc ? `클로드가 ${x.spc}에서 바로 이어서 해요` : x.again ? '답이 저장돼요. 이어서 시키려면 판에서 체크해 PC를 골라 주세요' : '클로드가 다음에 읽어요'}. 원래 쪽지 글은 그대로예요.`;
  $('#reply').showModal();
  for (const t of box.querySelectorAll('textarea')) grow(t);
  // 대화 맨 아래(지금 질문)가 보이게
  const th = $('#reply-thread'); th.scrollTop = th.scrollHeight;
  (box.querySelector('.ropt') || box.querySelector('textarea'))?.focus({ preventScroll: true });
}
function readReply() {
  const box = $('#reply-qs');
  const text = [...box.querySelectorAll('textarea')].map((t) => t.value.trim());
  const pick = (replying?.qs || []).map((q, i) => box.querySelector(`.rq[data-i="${i}"] .ropt[aria-pressed="true"]`)?.dataset.o || '');
  return { text, pick };
}
function saveReplyDraft() {
  if (!replying) return;
  const d = readReply();
  setReplyDraft(replying.id, d.text.some(Boolean) || d.pick.some(Boolean) ? { ...d, for: replying.lcAt } : null);
}
async function sendReply() {
  // 보내는 중에 또 누르면(Ctrl+Enter 두 번 등) 무시 — 같은 답이 두 번 쌓이지 않게
  if (!replying || replying.sending) return;
  const r = replying;
  const { id, qs } = r;
  const cur = ideas[id];
  if (!cur) { $('#reply').close(); return toast('다른 곳에서 지워진 쪽지예요.'); }
  // 창을 연 사이 끝났거나(실행기 done·판 체크) 클로드가 새 말을 달았으면 보내지 않고 새 내용을 다시 보여 준다(쓴 답은 남음)
  if (cur.st === 'done') { saveReplyDraft(); $('#reply').close(); return toast('그새 끝난 쪽지예요. 이어서 하려면 «다시 열기» 뒤에 답해 주세요.'); }
  if ((lastClaude(cur)?.at || 0) !== r.lcAt) { saveReplyDraft(); $('#reply').close(); toast('클로드가 그새 새 말을 달았어요. 다시 보여 드릴게요.'); return openReply(id); }
  const { text, pick } = readReply();
  let msg;
  if (qs.length) {
    const ans = qs.map((q, i) => [pick[i], text[i]].filter(Boolean).join(' — '));
    if (!ans.some(Boolean)) return toast('답을 하나는 적거나 골라 주세요.');
    const missing = qs.filter((q, i) => !ans[i]).map((q) => q.n || '질문');
    if (missing.length && !(await ask(`${missing.join(' ')}에 답이 비었어요. 그래도 보낼까요?`, { yes: '그래도 보내기', no: '마저 답하기', danger: false }))) return;
    msg = qs.length === 1 && !qs[0].n ? ans[0] : qs.map((q, i) => `${q.n || `${i + 1}.`} ${ans[i] || '(답 안 함)'}`).join('\n');
  } else {
    msg = text[0];
    if (!msg) { $('#rq-0').focus(); return toast('답을 적어 주세요.'); }
  }
  if (replying !== r) return; // 확인 창을 띄운 사이 창이 닫혔으면 그만
  // 확인 창을 띄운 사이 끝났거나 새 질문이 왔으면 위와 같이 보내지 않는다
  if (!ideas[id] || ideas[id].st === 'done' || (lastClaude(ideas[id])?.at || 0) !== r.lcAt) { saveReplyDraft(); $('#reply').close(); return toast('그새 쪽지가 바뀌었어요. 다시 열어 확인해 주세요.'); }
  const now = Date.now();
  const k = r.k;
  const part = { [`th/${k}`]: { w: 'h', x: msg, at: now }, hat: now, st: 'new', ask: null, rep: null };
  // 옛 방식 답장(re만 있고 th에 없음)은 같이 th로 옮겨 둔다 — 다음 답장이 re를 덮어도 대화에 남게
  for (const m of threadOf(cur)) if (m.legacy) part[`th/m${(m.at || now).toString(36)}r`] = { w: 'c', x: m.x, at: m.at || now, ...(m.q ? { q: true } : {}) };
  // 시킨 일 중에 물은 것(again)에 답하면 다시 시켜 이어서 하게 한다
  Object.assign(part, rego(cur, now));
  const btn = $('#reply-send');
  btn.disabled = true;
  r.sending = true;
  try {
    await withTimeout(store.patch(id, part), 8000);
    setReplyDraft(id, null);
    replying = null;
    freshMsg = k;
    setTimeout(() => { if (freshMsg === k) freshMsg = null; }, 1500);
    $('#reply').close();
    toast(part.go ? '답을 보냈어요. 클로드가 이어서 해요' : cur.again ? PICK_AGAIN : '답을 보냈어요. 클로드가 다음에 읽어요');
    render();
  } catch (e) { toast('보내지 못했어요. 다시 눌러도 한 번만 들어가요.'); }
  finally { btn.disabled = false; r.sending = false; }
}

// 앱 안 확인 창(브라우저 confirm 대신)
// 단추 글은 기본이 «지우기»(빨강)/«그만두기», 답하기 창은 다른 글을 넘긴다
function ask(msg, { yes = '지우기', no = '그만두기', danger = true } = {}) {
  const d = $('#ask');
  $('#ask-msg').textContent = msg;
  $('#ask-yes').textContent = yes;
  $('#ask-yes').classList.toggle('danger', danger);
  $('#ask-no').textContent = no;
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
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('lift', !$('#undo').hidden); /* 되돌리기 줄이 떠 있으면 그 위에 */ t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1800); }

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
// ---------- 낡은 화면 막기 ----------
// 새 판이 배포돼도 열어 둔 화면은 옛 코드로 돈다. 2026-11-18: 체크가 «끝남»에서 «시키기»로 바뀐 날,
// 새로고침 안 한 옛 화면에서 체크한 줄이 모두 «끝남»으로 저장됐다(출처: 효니 말 «새로고침 안 하고 체크했더니 … 다 끝남으로 넘어가버림»).
// 그래서 화면으로 돌아올 때마다(그리고 켜 둔 채 10분마다) 새 판을 찾고, 새 서비스워커가 넘겨받으면 바로 다시 연다.
// 쓰던 글·보낼 쪽지는 기기에 저장돼 있어 다시 열어도 남는다. 고치기 창이 열려 있으면 닫힐 때까지 기다린다(0.5초마다 봄).
let swReg = null;
let oldPage = false;
function registerSW() {
  if (!('serviceWorker' in navigator) || (isLocal && !params.has('sw'))) return; // 내 PC에선 ?sw=1일 때만(새 판 넘겨받기 시험용)
  const had = !!navigator.serviceWorker.controller; // 처음 설치될 때의 넘겨받기는 새 판이 아니다
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) { oldPage = true; freshen(); } });
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
  const look = () => { if (document.visibilityState !== 'visible') return; if (oldPage) return freshen(); swReg?.update().catch(() => {}); };
  document.addEventListener('visibilitychange', look);
  window.addEventListener('pageshow', look);
  setInterval(look, 10 * 60e3);
}
let freshWait;
function freshen() {
  if (document.querySelector('dialog[open]')) {
    if (!freshWait) { toast('새 판이 나왔어요. 이 창을 닫으면 다시 열게요.'); freshWait = setInterval(() => { if (!document.querySelector('dialog[open]')) location.reload(); }, 500); }
    return;
  }
  location.reload();
}

start();
