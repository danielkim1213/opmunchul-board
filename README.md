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
cp .env.example .env   # Blizzard OAuth 값 채우기 (없어도 게시판 기능은 동작)
npm run dev            # 프론트 5173 + API 3001
```

로컬에서는 DB로 `server/data.sqlite` 파일을 그대로 사용합니다
(`TURSO_DATABASE_URL`이 비어 있으면 자동 fallback).

## Blizzard OAuth 설정

1. https://develop.battle.net 에서 클라이언트 생성 → `Client ID` / `Client Secret`
2. Redirect URL 등록 (앱 설정과 서버 `BLIZZARD_REDIRECT_URI` 가 정확히 일치해야 함)
   - 개발: `http://localhost:3001/api/auth/blizzard/callback`
   - 배포: `https://<도메인>/api/auth/blizzard/callback`
3. 환경변수: `BLIZZARD_REGION`(kr/us/eu/tw/cn), `BLIZZARD_CLIENT_ID`,
   `BLIZZARD_CLIENT_SECRET`, `BLIZZARD_REDIRECT_URI`

> 배틀태그 조회에는 `openid` 스코프가 필요하며, 서버가 자동으로 요청합니다.

## 게시판: 팁 / 피드백 / 투표

로그인 후 메인 화면이 곧 게시판입니다. 글쓰기 시 세 가지 타입 중 하나를 선택합니다.

- **💡 팁**: 제목 + 본문 + 일반 댓글(답글/추천). 누구나 볼 수 있고 티어 제한이 없습니다.
- **🎬 피드백**: 영웅 · 팀 사이드(레드팀/블루팀) · YouTube 링크가 필수인 VOD 리뷰 게시글.
  리플레이 코드는 선택 입력입니다(있으면 좋지만 없어도 작성 가능).
  - 실제 YouTube IFrame Player API로 영상을 재생하고, 재생 위치를 실시간으로 추적합니다.
  - `📍 [MM:SS] 시점에 댓글 추가` 버튼을 누르면 현재 재생 시간이 댓글 입력폼의 타임스탬프에 자동으로
    채워지고 내용 입력창에 포커스가 갑니다. 타임스탬프는 직접 수정할 수도 있습니다.
  - 댓글 카드의 주황색 `[MM:SS]` 배지를 클릭하면 해당 시점으로 영상이 자동으로 이동(seek)합니다.
  - 댓글은 시간순 / 추천순으로 정렬할 수 있고, `🔄 싱크 모드`를 켜면 타임라인 피드백 중 재생 위치와
    가까운(±5초) 것만 남기고 나머지는 숨긴 뒤, 가장 가까운 댓글을 자동으로 강조 + 스크롤합니다.
  - 시간대를 특정하기 애매한 종합 피드백은 입력폼의 "특정 시간대 없이 전체적인 피드백 남기기"
    체크박스로 타임스탬프 없이 남길 수 있습니다. 이런 `🗒 전체 피드백`은 싱크 모드가 켜져 있어도
    항상 보입니다.
- **🗳 투표**: 선택지 2~5개, 마감 없는 단일 선택 투표. 결과는 누구나 실시간(퍼센트/득표수)으로 볼 수
  있고, 투표는 언제든 다른 선택지로 변경할 수 있습니다(1인 1표, upsert).

글쓰기 시 피드백/투표 게시글은 참여 가능한 **랭크 티어**(브론즈~챔피언)를 임의로 선택할 수 있습니다.
빈 선택은 "제한 없음"을 의미하며, 선택하면 해당 티어의 인증된 유저만 댓글/투표에 참여할 수 있습니다.
자격이 없는 유저도 게시글과 결과는 볼 수 있지만, 댓글 작성·업보트·답글·투표는 서버에서 차단되고
"자격 티어가 아닙니다" 안내만 표시됩니다. 댓글의 추천(따봉)·답글은 로그인한 계정 기준으로
서버(SQLite)에 저장되며, 작성자의 **아이디(username)**와 인증된 티어 배지가 함께 표시됩니다.
익명성을 위해 배틀태그는 대외적으로 노출되지 않고 본인만 확인할 수 있습니다.

본인이 작성한 게시글/댓글은 상세 화면에서 ✏️ 수정, 🗑 삭제할 수 있습니다. 게시글을 삭제하면 댓글도
함께 삭제되고, 댓글을 삭제하면 그 답글도 함께 삭제됩니다(투표 게시글의 선택지는 기존 투표를
보존하기 위해 생성 이후 수정할 수 없습니다).

## Vercel 배포 (프론트 + API 한 방)

- **프론트**: Vite 빌드 결과(`dist/`)를 Vercel CDN이 정적 서빙
- **API**: Express 앱 전체가 `api/index.js` 서버리스 함수 하나로 실행
  (`vercel.json`이 `/api/*`, `/health`를 함수로 rewrite)
- **DB**: [Turso](https://turso.tech) 호스팅 libSQL — 서버리스에는 로컬
  SQLite 파일을 둘 수 없어서 외부 DB를 사용합니다. SQLite와 파일/SQL 호환이라
  기존 `data.sqlite`를 그대로 업로드해 이전할 수 있습니다.

같은 도메인에서 `/` = 화면, `/api/*` = API, `/health` = 헬스체크.

### 배포 절차

```bash
# 1) Turso DB 생성 (기존 데이터가 있으면 --from-file 로 그대로 이전)
turso db create opmunchul-board --from-file server/data.sqlite
turso db show opmunchul-board --url        # → TURSO_DATABASE_URL
turso db tokens create opmunchul-board     # → TURSO_AUTH_TOKEN

# 2) Vercel 프로젝트 연결 + 환경변수 등록 (아래 표 참고)
vercel link
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add BLIZZARD_REGION production
vercel env add BLIZZARD_CLIENT_ID production
vercel env add BLIZZARD_CLIENT_SECRET production
vercel env add BLIZZARD_REDIRECT_URI production

# 3) 배포 (빌드 중에 npm run db:migrate 가 스키마를 자동 반영)
vercel --prod
```

### 환경변수

| 이름 | 값 |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://...` (turso db show --url) |
| `TURSO_AUTH_TOKEN` | turso db tokens create 결과 |
| `BLIZZARD_REGION` | `kr` |
| `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` | Blizzard 개발자 포털 값 |
| `BLIZZARD_REDIRECT_URI` | `https://<vercel-domain>/api/auth/blizzard/callback` |

> Blizzard 개발자 포털(https://develop.battle.net/access/clients)의 클라이언트
> 설정에도 새 Redirect URI를 **반드시 등록**해야 OAuth 연동이 됩니다.

### Turso 주의사항

Turso(libSQL)는 `PRAGMA foreign_keys`가 기본 OFF라 스키마의
`ON DELETE CASCADE`가 실행되지 않습니다. 게시글/댓글 삭제는
`server/posts.js`의 명시적 연쇄 삭제(트랜잭션 batch)로 처리합니다.

## OverFast 정책

- 유저당 UTC 기준 **하루 1회** 전적 갱신
- 전역 큐 **초당 25회**, 초과 시 1초 대기
