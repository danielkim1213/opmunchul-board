# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. **Blizzard OAuth 연동**으로 배틀태그를
안전하게 인증하고, 원하는 아이디로 가입 + 티어/모스트 배지.

## 가입 흐름

1. 원하는 **아이디** 입력 → `중복확인` 으로 사용 가능 여부 확인
2. **비밀번호**(최소 8자) 입력 및 확인
3. `Blizzard 계정 연동` → Blizzard 로그인 팝업에서 인증
4. 연동으로 받아온 **배틀태그**로 OverFast 전적/티어를 조회해 배지 부여

로그인은 아이디 + 비밀번호로만 진행합니다.

## 로컬 실행

```bash
npm install
npm --prefix server install
cp .env.example server/.env   # Blizzard OAuth 값 채우기
npm run dev     # 프론트 5173 + API 3001
```

## Blizzard OAuth 설정

1. https://develop.battle.net 에서 클라이언트 생성 → `Client ID` / `Client Secret`
2. Redirect URL 등록 (앱 설정과 서버 `BLIZZARD_REDIRECT_URI` 가 정확히 일치해야 함)
   - 개발: `http://localhost:3001/api/auth/blizzard/callback`
   - 배포: `https://<도메인>/api/auth/blizzard/callback`
3. 환경변수: `BLIZZARD_REGION`(kr/us/eu/tw/cn), `BLIZZARD_CLIENT_ID`,
   `BLIZZARD_CLIENT_SECRET`, `BLIZZARD_REDIRECT_URI`

> 배틀태그 조회에는 `openid` 스코프가 필요하며, 서버가 자동으로 요청합니다.

## VOD 피드백 (타임스탬프 싱크 댓글)

로그인 후 상단 `🎬 VOD 피드백` 탭에서 확인할 수 있습니다.

- 실제 YouTube IFrame Player API로 영상을 재생하고, 재생 위치를 실시간으로 추적합니다.
- `📍 [MM:SS] 시점에 댓글 추가` 버튼을 누르면 현재 재생 시간이 댓글 입력폼의 타임스탬프에 자동으로
  채워지고 내용 입력창에 포커스가 갑니다. 타임스탬프는 직접 수정할 수도 있습니다.
- 댓글 카드의 주황색 `[MM:SS]` 배지를 클릭하면 해당 시점으로 영상이 자동으로 이동(seek)합니다.
- 댓글은 시간순 / 추천순으로 정렬할 수 있고, `🔄 싱크 모드`를 켜면 타임라인 피드백 중 재생 위치와
  가까운(±5초) 것만 남기고 나머지는 숨긴 뒤, 가장 가까운 댓글을 자동으로 강조 + 스크롤합니다.
- 시간대를 특정하기 애매한 종합 피드백은 입력폼의 "특정 시간대 없이 전체적인 피드백 남기기" 체크박스로
  타임스탬프 없이 남길 수 있습니다. 이런 `🗒 전체 피드백`은 싱크 모드가 켜져 있어도 항상 보입니다.
- 추천(따봉)·답글은 로그인한 계정 기준으로 서버(SQLite)에 저장되며, 댓글 작성자의 배틀태그와 인증된
  티어 배지가 함께 표시됩니다.
- 아직 VOD 제출(업로드) 플로우는 없어서 데모용 VOD 1개가 자동으로 시드됩니다. 플레이어 아래
  "테스트용" 입력창에 다른 YouTube 링크를 붙여넣으면 그 자리에서 영상을 바꿔볼 수 있습니다(로컬에서만
  바뀌고 서버에는 저장되지 않음).

## Railway 배포 (프론트 + API 한 방)

Root Directory를 `server`만 잡으면 **화면이 안 나옵니다.**  
레포 **루트**에서 Docker로 프론트를 빌드한 뒤 API가 같이 서빙합니다.

1. GitHub에 푸시
2. Railway → 이 레포 연결
3. **Root Directory: 비움 (repo root)**  ← `server` 아님
4. Builder: Dockerfile (`Dockerfile` 사용)
5. Generate Domain → 그 주소가 곧 사이트+API

같은 도메인에서 `/` = 화면, `/api/*` = API, `/health` = 헬스체크.

## OverFast 정책

- 유저당 UTC 기준 **하루 1회** 전적 갱신
- 전역 큐 **초당 25회**, 초과 시 1초 대기
