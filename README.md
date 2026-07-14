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
