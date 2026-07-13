# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. 배틀태그(BattleTag) 기반 인증으로
로그인/회원가입을 처리하고, 공개 프로필의 경쟁전 티어를 가져와 인증 배지를
부여합니다.

## 기술 스택

- **프론트**: React 18 + TypeScript + Vite 5
- **백엔드**: Express 5 + SQLite (`better-sqlite3`) + bcrypt
- **전적 데이터**: [OverFast API](https://overfast-api.tekrop.fr/) (서버에서 호출)

## 실행 방법

```bash
npm install
npm run dev     # 프론트(5173) + API 서버(3001) 동시 실행
```

- 프론트: http://localhost:5173
- API: http://localhost:3001 (`/api/*`)
- Vite가 `/api` 요청을 3001 포트로 프록시합니다.

API 서버만 따로 띄우려면:

```bash
npm run server
```

프로덕션 빌드:

```bash
npm run build
npm run preview   # 정적 프론트만 (API는 별도 실행 필요)
```

## 유저 데이터 저장 위치

| 항목 | 위치 |
|------|------|
| 계정 (배틀태그, bcrypt 해시, 티어, 아바타) | `server/data.sqlite` → `users` 테이블 |
| 로그인 세션 (토큰, 만료 시각) | `server/data.sqlite` → `sessions` 테이블 |
| 브라우저에 남는 것 | JWT 대신 **세션 토큰** 하나만 `localStorage` (`opmunchul.token`) |

비밀번호는 bcrypt(10 rounds)로 해시되어 SQLite에 저장됩니다.

## 인증 플로우

`src/auth/AuthFlow.tsx` — `useState` 기반 상태머신

1. **Step 1** — BattleTag 입력 후 Next
2. **Step 2** — 최소 0.5초 스피너 + 서버 `POST /api/auth/check` (OverFast 조회)
3. **Step 3 — 분기**
   - **로그인**: 이미 가입된 배틀태그 → 비밀번호 입력
   - **가입**: 공개 프로필 확인됨 → 티어 표시 후 비밀번호 설정
   - **찾을 수 없음**: OverFast 404 (존재하지 않거나 비공개) → *"계정을 찾을 수 없습니다. 배틀태그를 확인해주세요. 프로필 비공개 시 검색이 되지 않습니다."*

공개/비공개를 별도로 조회하지 않습니다. API에 안 나오면 모두 "찾을 수 없음"으로 처리합니다.

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/check` | 배틀태그 조회 → `registered` / `new` / 404 |
| POST | `/api/auth/register` | 가입 (서버가 OverFast 재검증) |
| POST | `/api/auth/login` | 로그인 |
| GET | `/api/auth/me` | 세션 확인 (`Authorization: Bearer <token>`) |
| POST | `/api/auth/logout` | 로그아웃 |

## 배포 (선택)

로컬 PC에서 `npm run dev`로 쓰거나, 아래처럼 분리 배포할 수 있습니다.

- **프론트**: Vercel / Netlify (`npm run build` → `dist/` 업로드)
- **API**: Railway, Render, Fly.io 등 Node 호스팅 (`server/index.js`, `PORT` 환경변수)
- SQLite 파일은 호스팅마다 ephemeral일 수 있으므로, 프로덕션에서는 Turso·PostgreSQL 등으로 교체 권장

## 남은 작업

- 게시판 CRUD (글쓰기/댓글)
- 프로덕션 DB 마이그레이션 (Turso/Postgres)
