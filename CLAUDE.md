# idea-box — 클로드 쪽지함

## 무엇인지
효니 개인용 웹앱(2026-11-14). Claude가 사용량 한도에 걸렸거나 다른 일을 하는 동안 떠오른 생각을 폰에서 «쪽지»로 넣어 두고, 다음 세션의 Claude가 읽어 처리한다. 배포 https://hyonnie-t.github.io/idea-box/ (공개 레포, 쪽지 자료는 레포에 없음).
출처: 효니 말 «작업하다가 네가 토큰 다 차면 나는 할 말을 못하잖아 그럴 때 아이디어들 넣어둘 수 있는 웹앱»(2026-11-14).

## 구조
- 저장: 책장·시간표·글감 서랍과 같은 Firebase `timetable-af612` RTDB `users/{주인uid}/ideas/{id}`. 주인 로그인 뒤에만 읽고 쓴다(로그인 코드는 글감 서랍 `js/fb.js`와 같은 방식, 앱 이름 `idea-box`로 같은 주소의 다른 앱 로그인과 섞이지 않음).
- 쪽지 칸: `t` 글, `at` 쓴 때(ms), `tag` 주제(일반·책장·시간표·수업·학교 일·글·블로그·대학원·도구), `hot` 급해요, `st` new|seen|done, `re` Claude 답장, `rat` 답장 때, `ed` 고친 때.
- `js/app.js` 화면 전부. 보낼 쪽지는 먼저 기기 우편함(localStorage `ideabox-outbox`)에 넣고 올라가면 뺀다 — 쪽지 id를 기기에서 만들어 다시 올려도 겹치지 않는다. 쓰던 글은 `ideabox-draft`. 확인·고치기는 앱 안 `<dialog>`.
- `manifest.webmanifest`의 `share_target`(GET title·text·url): 안드로이드 «공유하기»로 링크·글을 바로 쪽지 칸에 넣는다. 아이폰은 지원 안 됨.
- `sw.js` 앱 파일만 캐시(쪽지는 캐시 안 함). 앱 파일을 바꾸면 `VERSION`을 올린다.
- `tools/inbox.js` Claude 쪽 도구(firebase-tools CLI, 이 PC가 효니 계정으로 로그인돼 있어야 함, 한 번에 10초쯤):
  - `node tools/inbox.js` 안 끝난 쪽지 보기(새 쪽지·급한 것 먼저) / `--count` 숫자만 / `--all`
  - `node tools/inbox.js seen <id…>` 읽음, `reply <id> "답장"` 답장+읽음, `done <id> "답장"` 끝남+답장. 효니가 쓴 글 `t`는 건드리지 않는다.
- `tools/serve.js` 내 PC 확인용(127.0.0.1:8802, 교사업무 launch 이름 `idea-box`). `?demo=1`은 가짜 쪽지·메모리 저장.
- `icons/` 아이콘(편지 봉투+귤색 우표, SVG를 헤드리스 크롬으로 PNG로 구움). `js/vendor/lucian-icons` 새로고침 아이콘(MIT).

## 규칙
- Claude가 쪽지를 처리하는 순서: 읽기 → 바로 할 일은 하거나 결정 기록·작업 현황에 옮김 → `reply`/`done`으로 무엇을 했는지 한 줄 답장. 답장은 효니가 폰에서 읽으니 쉬운 말로 짧게.
- 쪽지는 효니의 생각이므로 다른 곳(공개 레포·공개 페이지)에 옮기지 않는다.
- 화면 확인: 폰 375·태블릿 768/1180·PC, 다크 모드. 간격은 8pt 토큰만(`--space-1~7`).
- 홈 화면 앱(아이폰) 로그인은 구글 클라우드 콘솔 «승인된 리디렉션 주소»에 `https://hyonnie-t.github.io/idea-box/`가 있어야 된다(효니가 콘솔에서).
