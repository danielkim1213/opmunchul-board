# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. 배틀태그 기반 인증 + 티어/모스트 배지.

## 실행 (로컬)

```bash
npm install
npm --prefix server install
npm run dev     # 프론트 5173 + API 3001
```

## OverFast 호출 정책

| 규칙 | 내용 |
|------|------|
| 하루 1회 | 그날 첫 `/me`·로그인 때만 전적 갱신, 같은 UTC 날짜는 DB 캐시 |
| 큐 | OverFast HTTP는 `server/rateQueue.js` FIFO |
| 초당 25 | 넘기면 1초 대기 후 재개 |

## 배포 (Railway 권장)

Express + SQLite는 **상시 Node 서버**가 필요해서 Railway / Render 같은 곳에 올립니다.

1. GitHub에 푸시
2. [railway.app](https://railway.app) → Deploy from GitHub
3. Root Directory: `server` / Start: `npm start`
4. Domain 발급
5. (선택) Volume으로 `data.sqlite` 보존
6. `FRONTEND_ORIGIN`에 프론트 도메인 설정

프론트를 API와 분리할 때는 빌드 시 `VITE_API_URL`에 Railway API 주소를 넣습니다.

## 저장소

| 항목 | 위치 |
|------|------|
| 계정·티어·모스트 | `server/data.sqlite` |
| 브라우저 | 세션 토큰만 |
