// 주인 로그인과 쪽지 읽기·쓰기. 책장·시간표 앱과 같은 Firebase 프로젝트의 users/{주인uid}/ideas 하나만 쓴다.
// 로그인 방식은 글감 서랍(js/fb.js)과 같다: 브라우저는 팝업, 홈 화면 앱은 구글 로그인 페이지로 이동했다가 #id_token으로 돌아온다.
const OWNER_UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const V = '10.12.0';
const config = {
  apiKey: 'AIzaSyBJnR447EvbToLxtRAHFNtSlhkg61QkdfA',
  authDomain: 'timetable-af612.firebaseapp.com',
  projectId: 'timetable-af612',
  appId: '1:797690266953:web:bfd4ba739900b625090698',
  databaseURL: 'https://timetable-af612-default-rtdb.firebaseio.com',
};
const ROOT = `users/${OWNER_UID}`;
const PATH = `${ROOT}/ideas`;
// 사진은 쪽지와 따로 둔다(목록을 열 때마다 큰 사진까지 받지 않게). ideaPics/{쪽지id}/{사진키} = { s 작은 그림, b 큰 그림 } (JPEG data URL)
const PICS = `${ROOT}/ideaPics`;
let sdk;
async function load() {
  if (sdk) return sdk;
  const [appM, authM, dbM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
  ]);
  const app = appM.initializeApp(config, 'idea-box'); // 같은 주소의 책장·시간표 로그인과 섞이지 않게 이름을 따로 준다
  const auth = authM.initializeAuth(app, {
    persistence: [authM.indexedDBLocalPersistence, authM.browserLocalPersistence],
    popupRedirectResolver: authM.browserPopupRedirectResolver,
  });
  sdk = { authM, dbM, auth, db: dbM.getDatabase(app) };
  return sdk;
}
export const isOwner = (user) => !!user && user.uid === OWNER_UID;

const FLAG = 'ideabox-owner';
const flag = {
  get() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } },
  set(v) { try { v ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch (e) {} },
};
export const wasOwner = () => flag.get();

export async function watchAuth(cb) {
  if (!flag.get()) return cb(null);
  const s = await load();
  s.authM.onAuthStateChanged(s.auth, cb);
}
export function warm() { load().catch(() => {}); }

const CLIENT = '797690266953-4eeq083i7vukr0hgi0kqteni30kbj8k8.apps.googleusercontent.com'; // 공개 값(파이어베이스 웹 클라이언트)
const REDIRECT = 'https://hyonnie-t.github.io/idea-box/'; // 구글 클라우드 콘솔의 승인된 리디렉션 주소에 더해야 홈 화면 앱 로그인이 된다
const NONCE = 'ideabox-nonce';
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function startRedirect() {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(NONCE, nonce); } catch (e) {}
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'id_token', scope: 'openid email profile', nonce, prompt: 'select_account' });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}
export function takeIdToken() {
  if (!/[#&]id_token=/.test(location.hash)) return '';
  const tok = new URLSearchParams(location.hash.slice(1)).get('id_token') || '';
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  return tok;
}
export async function finishRedirect(idToken) {
  let p = {};
  try { p = JSON.parse(decodeURIComponent(escape(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { throw new Error('bad token'); }
  let want = ''; try { want = localStorage.getItem(NONCE) || ''; localStorage.removeItem(NONCE); } catch (e) {}
  if (!want || p.nonce !== want || p.aud !== CLIENT) throw new Error('nonce mismatch');
  const s = await load();
  const r = await s.authM.signInWithCredential(s.auth, s.authM.GoogleAuthProvider.credential(idToken));
  if (!isOwner(r.user)) { await s.authM.signOut(s.auth); return null; }
  flag.set(true);
  return r.user;
}
export async function signIn() {
  if (isStandalone()) { startRedirect(); return 'redirect'; }
  const s = sdk || await load();
  const prov = new s.authM.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  const r = await s.authM.signInWithPopup(s.auth, prov);
  if (!isOwner(r.user)) { await s.authM.signOut(s.auth); return null; }
  flag.set(true);
  return r.user;
}
export async function signOut() {
  flag.set(false);
  if (!sdk) return;
  await sdk.authM.signOut(sdk.auth);
}

// ---------- 쪽지 저장소 ----------
// 쪽지 하나: { ph [사진키…] 사진, t 글, at 쓴 때(ms), tag 주제, hot 급해요, st new|seen|done, re Claude 답장, rat 답장 때, ed 고친 때 }
export function firebaseStore() {
  return {
    async watch(cb, onErr) {
      const s = await load();
      return s.dbM.onValue(s.dbM.ref(s.db, PATH), (snap) => cb(snap.val() || {}), onErr);
    },
    // 쪽지 id는 기기에서 미리 만든다(인터넷이 끊겼다 다시 보내도 같은 쪽지가 두 번 생기지 않게)
    // 없을 때만 만든다(트랜잭션). 이미 올라간 쪽지를 기기 우편함의 옛 내용으로 덮어 고침·답장이 사라지지 않게.
    async create(id, item) { const s = await load(); await s.dbM.runTransaction(s.dbM.ref(s.db, `${PATH}/${id}`), (cur) => (cur === null ? item : undefined), { applyLocally: false }); },
    async patch(id, part) { const s = await load(); await s.dbM.update(s.dbM.ref(s.db, `${PATH}/${id}`), part); },
    // 쪽지와 그 사진을 한 번에 지운다
    async remove(id) { const s = await load(); await s.dbM.update(s.dbM.ref(s.db, ROOT), { [`ideas/${id}`]: null, [`ideaPics/${id}`]: null }); },
    // 사진: pics = { 사진키: { s, b } }. 쪽지보다 먼저 올린다(쪽지에 사진키가 보일 때 사진이 이미 있게).
    async putPics(id, pics) { if (!Object.keys(pics).length) return; const s = await load(); await s.dbM.update(s.dbM.ref(s.db, `${PICS}/${id}`), pics); },
    async dropPics(id, keys) { if (!keys.length) return; const s = await load(); await s.dbM.update(s.dbM.ref(s.db, `${PICS}/${id}`), Object.fromEntries(keys.map((k) => [k, null]))); },
    async getPic(id, k, size) { const s = await load(); const v = await s.dbM.get(s.dbM.ref(s.db, `${PICS}/${id}/${k}/${size}`)); return v.val() || ''; },
    // PC 실행기들의 켜짐 신호 { PC이름: { at, ok, why } } (tools/runner.js가 1분마다 씀). 체크할 때 한 번 읽는다.
    async runners() { const s = await load(); const v = await s.dbM.get(s.dbM.ref(s.db, `${ROOT}/ideaRunners`)); return v.val() || {}; },
    // 시킨 일 기록 { 키: { id, t, pc, at, re, end, how, code } } (tools/runner.js가 씀, 30일치). «📋 시킨 일» 창을 열 때 한 번 읽는다.
    async runLog() { const s = await load(); const v = await s.dbM.get(s.dbM.ref(s.db, `${ROOT}/ideaRunLog`)); return v.val() || {}; },
  };
}
