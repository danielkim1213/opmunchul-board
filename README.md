# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. 배틀태그 기반 인증 + 티어/모스트 배지.

## 실행 (로컬)

```bash
npm install
npm --prefix server install
npm run dev     # 프론트 5173 + API 3001
```

## 배포 (Vercel + Railway)

Express + SQLite는 **Vercel에 올리면 안 됩니다** (서버리스 + 네이티브 모듈).  
프론트만 Vercel, API는 Railway에 올립니다.

```
브라우저 → Vercel (React) → Railway (Express + SQLite)
```

### A. API (Railway)

1. [railway.app](https://railway.app) → New Project → GitHub 레포 연결  
2. **Root Directory** 를 `server` 로 설정  
3. Start Command: `npm start`  
4. Variables: `FRONTEND_ORIGIN` = Vercel 주소 (예: `https://opmunchul.vercel.app`)  
5. Public Domain 발급 → API URL 복사  

### B. 프론트 (Vercel)

1. [vercel.com](https://vercel.com) → Import GitHub 레포 (루트)  
2. Framework: Vite  
3. Env: `VITE_API_URL` = Railway API URL (슬래시/`/api` 없이)  
   - 예: `https://xxx.up.railway.app`  
4. Deploy  

5. Railway `FRONTEND_ORIGIN`을 실제 Vercel URL로 맞추고 재배포  

환경 변수 예시는 `.env.example` 참고.

## 저장소

| 항목 | 위치 |
|------|------|
| 계정·티어·모스트 | `server/data.sqlite` |
| 브라우저 | 세션 토큰만 |

Railway 등에서는 디스크가 ephemeral일 수 있어, 재배포 시 DB가 날아갈 수 있습니다. 장기적으로는 **Volume**을 붙이거나 Turso/Postgres로 옮기는 걸 권장합니다.
