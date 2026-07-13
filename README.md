# 옵문철 게시판

오버워치 2 유저를 위한 커뮤니티 게시판. 배틀태그(BattleTag) 기반 인증으로
로그인/회원가입을 처리하고, 공개 프로필의 경쟁전 티어를 가져와 인증 배지를
부여합니다.

## 기술 스택

- React 18 + TypeScript + Vite 5
- 전적 데이터: [OverFast API](https://overfast-api.tekrop.fr/) (비공식 오버워치 API)
- 계정 저장소: `localStorage` (백엔드 연동 전 임시 구현)

## 실행 방법

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # 프로덕션 빌드
```

개발 서버는 CORS 회피를 위해 `/overfast` 경로를 OverFast API로 프록시합니다
(`vite.config.ts` 참고).

## 인증 플로우 (상태머신)

`src/auth/AuthFlow.tsx`가 `useState` 기반 상태머신으로 구현되어 있습니다.

1. **Step 1 — BattleTag 입력**: 배틀태그(`Tracer#1234` 형식 검증) 입력 후 Next. 배틀태그는 전 세계에서 유일하므로 지역 선택은 필요 없습니다.
2. **Step 2 — 검색**: 최소 1.5초 스피너와 함께 "Searching BattleTag in Blizzard Database..." 표시. 이 시간 동안 실제 OverFast API를 호출합니다.
3. **Step 3 — 분기**:
   - **Branch A (로그인)**: 이미 사이트에 등록된 배틀태그면 비밀번호 입력 필드가 슬라이드 인 → "Log In".
   - **Branch B (비공개 프로필)**: Blizzard 계정은 있으나 프로필이 비공개면 앰버 경고 화면 + 공개 전환 안내 → "Retry Check"로 Step 2 재시도.
   - **Branch C (회원가입)**: 신규 + 공개 프로필이면 "Profile Verified!" 화면에 최고 티어(예: `[Master II]`) 표시 → 비밀번호 설정 후 가입.
   - 추가로 배틀태그가 Blizzard에 없으면 Not Found 화면을 표시합니다.

## OverFast API 연동 메모

- 플레이어 요약: `GET /players/{BattleTag의 #을 -로 치환}/summary`
- 현재 API 응답에는 `privacy` 필드가 없어, `competitive`가 null인 경우
  `GET /players?name={이름}` 검색 결과의 `is_public` 값과 교차 확인하여
  비공개/언랭크를 구분합니다 (`src/api/overfast.ts`).
- 티어는 PC/콘솔 · 탱커/딜러/서포터 중 최고 랭크를 골라 `Master II` 형식으로 표기.

## 남은 작업

- 실제 게시판 CRUD (글쓰기/댓글) — 현재는 로그인 후 프리뷰 화면만 존재
- 백엔드/DB 연동 (현재 계정은 localStorage에 SHA-256 해시로 저장)
