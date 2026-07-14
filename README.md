# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. 배틀태그 기반 인증 + 티어/모스트 배지.

## 로컬 실행

```bash
npm install
npm --prefix server install
npm run dev     # 프론트 5173 + API 3001
```

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
