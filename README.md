# 교실 테트리스 대전 (TETR.IO 규칙 · PC/모바일)

설치할 패키지 없이 **Node.js 하나만 있으면** 실행되는 교실용 실시간 테트리스 대전 게임입니다.
최대 16명/방, 방 여러 개 가능. 휴대폰·태블릿에서는 **터치 키패드**가 자동으로 나타납니다.

---

## 1. GitHub에 올리기 (처음 한 번)

1. [github.com](https://github.com) 로그인 → 오른쪽 위 **+** → **New repository**
2. 이름 예: `classroom-tetris` → **Create repository**
3. 생성된 페이지에서 **uploading an existing file** 클릭
4. 압축을 푼 `tetris-school` 폴더 **안의 내용 전부**(server.js, public 폴더, .devcontainer 폴더 등)를 끌어다 놓기 → **Commit changes**
   > `.devcontainer`, `.github` 처럼 점(.)으로 시작하는 폴더는 숨김 폴더라 탐색기에서 안 보일 수 있습니다.
   > Windows: 탐색기 [보기] → [숨긴 항목] 체크 / Mac: Finder 에서 `Cmd + Shift + .`

이제 아래 **A** 또는 **B** 중 하나로 서버를 엽니다.

---

## 2-A. GitHub Codespaces 로 서버 열기 (수업 시간에 켜서 쓰기 · 추천)

GitHub 안에서 바로 서버가 실행됩니다. 별도 가입·설치가 필요 없습니다.

1. 저장소 페이지 → 초록색 **Code** 버튼 → **Codespaces** 탭 → **Create codespace on main**
2. 1~2분 기다리면 화면 아래 터미널에 서버가 **자동으로 실행**되고 주소가 표시됩니다.
   ```
   학생 접속 주소 (GitHub Codespaces): https://xxxx-3000.app.github.dev
   ✅ 3000번 포트를 Public 으로 설정했습니다.
   ```
3. 이 주소를 학생들에게 알려 주면 됩니다. (QR 코드로 만들어 칠판에 띄우면 편해요)

**⚠ 꼭 확인할 것**
- 학생이 접속했는데 GitHub 로그인 화면이 나오면 포트가 비공개 상태입니다.
  화면 아래 **[포트(PORTS)]** 탭 → `3000` 줄 오른쪽 클릭 → **포트 표시 유형(Port Visibility) → Public**
- 서버가 안 켜졌다면 터미널에 `node server.js 3000` 입력
- Codespaces 는 **아무것도 안 하고 한동안 두면 자동으로 꺼집니다**(기본 30분). 수업 중에는 브라우저 탭을 열어 두세요.
- 무료 사용 시간이 매달 정해져 있습니다. 수업이 끝나면 **github.com/codespaces** 에서 해당 codespace 를 **Stop** 하세요.
  (무료 한도·정책은 GitHub 공식 문서에서 최신 내용을 확인하세요. 교사는 GitHub Education 혜택을 받을 수 있습니다.)

---

## 2-B. Render 로 상시 서버 열기 (GitHub 저장소 연결 · 24시간 주소)

언제든 같은 주소로 접속할 수 있게 하려면 GitHub 저장소를 무료 호스팅 서비스에 연결합니다.

1. [render.com](https://render.com) 에서 **GitHub 계정으로 가입**
2. **New + → Blueprint** → 방금 만든 저장소 선택 → **Apply**
   (저장소에 들어 있는 `render.yaml` 이 설정을 자동으로 채웁니다)
3. 몇 분 뒤 `https://classroom-tetris-xxxx.onrender.com` 같은 주소가 생깁니다 → 학생들에게 공유
4. 이후 GitHub 에 파일을 수정해 올리면 **자동으로 다시 배포**됩니다.

> 무료 플랜은 한동안 접속이 없으면 잠들었다가, 첫 접속 때 깨어나는 데 1분 정도 걸릴 수 있습니다.
> 수업 시작 몇 분 전에 선생님이 먼저 한 번 접속해 두세요.

---

## 2-C. (선택) GitHub Pages 에 화면만 올리기

GitHub Pages 는 **서버 프로그램을 실행할 수 없어서** 혼자 연습만 됩니다.
대전까지 하려면 `public/config.js` 에 2-A 또는 2-B 의 서버 주소를 적으세요.
```js
window.TETRIS_SERVER = "https://classroom-tetris-xxxx.onrender.com";
```
배포: 저장소 **Settings → Pages → Source: GitHub Actions** → **Actions** 탭 → "GitHub Pages 배포" → **Run workflow**

---

## 2-D. 학교 PC 에서 직접 열기 (인터넷 없이 교내망)

1. 선생님 PC에 [Node.js](https://nodejs.org) LTS 설치
2. Windows: `서버실행(Windows).bat` 더블클릭 / Mac·Linux: `node server.js`
3. 표시되는 `http://192.168.x.x:3000` 주소를 학생에게 공유 (같은 Wi-Fi 필요)
   > Windows 방화벽 경고가 뜨면 **개인 네트워크 허용**을 눌러야 합니다.

---

## 3. 게임 방법
한 명이 **방 만들기** → 4자리 방 코드 공유 → 나머지는 코드 입력 후 **참가** → 방장이 **게임 시작**

### PC 키보드 (⚙ 조작 설정에서 변경 가능)
← → 이동 · ↓ 소프트 드롭 · Space 하드 드롭 · ↑/X 시계 회전 · Z/Ctrl 반시계 회전 · A 180° 회전 · C/Shift 홀드 · R 다시 시작(연습) · 1~4 공격 대상

### 모바일 터치 키패드
```
 세로 화면                          가로 화면
 ┌─────── 상대 보드 ───────┐        ┌──────┬────────┬──────┬──────┐
 │                         │        │      │        │ 상대 │      │
 │        내 보드          │        │ ⤓    │ 내 보드 │ 보드 │HOLD 180│
 │                         │        │◀ ▼ ▶│        │      │ ↺  ↻ │
 │  [ ⤓ ]       [HOLD][180]│        └──────┴────────┴──────┴──────┘
 │[◀][▼][▶]    [ ↺ ][ ↻ ]  │
 └─────────────────────────┘
```
- ◀ ▶ 를 **누르고 있으면** 계속 이동(DAS/ARR 적용), ▼ 를 누르고 있으면 빠르게 내려감
- ⤓ 하드 드롭 · ↺ 반시계 · ↻ 시계 · 180° 회전 · HOLD
- 여러 손가락 동시 입력 가능(예: ◀ 누른 채로 ↻)
- 화면 위 **공격 대상** 버튼을 누르면 대상 방식이 바뀝니다
- ⛶ 버튼으로 전체 화면(안드로이드). 아이폰은 Safari 공유 → **홈 화면에 추가** 후 실행하면 넓게 보입니다
- ⚙ 설정에서 키패드 켜기/끄기(태블릿+키보드), **크기 70~130%**, 진동 설정

---

## 4. 적용된 TETR.IO 규칙
| 항목 | 내용 |
|---|---|
| 보드 | 10×20 (위쪽 버퍼 20줄) |
| 블록 순서 | 7-bag, 한 판의 모든 플레이어가 **같은 순서** |
| 회전 | SRS+ (I 미노 대칭 킥 + 180° 회전) |
| 미리보기/홀드 | NEXT 5개, 홀드 |
| 락 딜레이 | 500ms, 이동·회전으로 최대 15회 리셋 |
| T-스핀 | 3코너 판정, 미니/풀 구분 |
| 공격 | 더블1 · 트리플2 · 쿼드4 · TSS2 · TSD4 · TST6 · 미니(싱글0, 더블1) · 올 클리어 +10 |
| B2B / 콤보 | TETR.IO 계산식 |
| 방해줄 | 상쇄, 약 0.33초 도착 지연(주황→빨강), 한 번에 최대 8줄 |
| 패배 | 블록 아웃 · 락 아웃 · 탑 아웃 |
| 속도 | 2분 이후 점점 빨라짐 (대기실에서 끄기 가능) |

## 5. 파일 구성
```
server.js               웹 서버 + WebSocket 서버 (방, 공격 전달, KO·순위)
public/index.html       화면 구성
public/style.css        디자인 (PC/모바일 반응형, 키패드)
public/main.js          화면, 키보드·터치 입력, 그리기, 네트워크
public/engine.js        게임 규칙 엔진
public/config.js        (선택) 외부 서버 주소
.devcontainer/          GitHub Codespaces 자동 실행 설정
render.yaml             Render 자동 배포 설정
.github/workflows/      (선택) GitHub Pages 배포
```

## 6. 참고
- 치팅 방지 기능은 없습니다(교실용 친선 경기 기준).
- "Tetris"는 The Tetris Company 의 상표입니다. 교내 비상업적 용도로 사용하세요.
