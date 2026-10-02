# C4 웹 native snapshot 조회 연결 결과

- 계획: [NativeWebRead](../planning/2026-10-01-Database-NativeWebRead.md). 시작 커밋 `5c815df`; 2026-10-01 구현·브라우저 QA 후 중단된 단위를 2026-10-02 검증·기록·커밋으로 마무리했다.
- 프로젝트 열기는 versioned REST snapshot과 사용자 자신의 personal JSON을 읽는다. source v1은 기존 canonicalization과 편집기를 유지하고, source v2는 native 조회 화면으로 분기한다. preview unavailable 역시 v1 편집기로 재해석하지 않는다.
- 공통 model 표시 함수로 DB별 선언·파라미터·배열·ENUM/SET·default AST·생성 옵션을 표시한다. 긴 수치는 문자열로 유지하고 legacy 원문을 보존한다. 서버 카드도 같은 타입 표시를 사용한다. 이 함수는 SQL serializer가 아니다.
- 조회 화면은 도메인/논리·물리 필터, 테이블 검색, 컬럼, 키/FK, index/CHECK/ENUM, DB 옵션·설명·추가 속성, 진단과 알림의 리뷰 내용을 표시한다. App 이동·권한 상실·로그아웃·stale navigation 보호에 native entry를 포함했다. native entry는 v1 autosave/runtime/baseline을 시작하지 않는다.

## 검증

- 2026-10-02 현재 소스의 `pnpm check`: 포맷·전체 타입·빌드 통과, 테스트 **813개 통과/54개 건너뜀**. 기존 대형 웹 번들 경고가 있다.
- 최종 빌드 후 격리 PostgreSQL `versioned-document.integration.test.ts` + `autosync.integration.test.ts`: **18개 통과**. runner가 별도 QA DB를 생성·마이그레이션·삭제했다. 전체 API/MCP 통합의 기존 실패 5건을 해결한 것으로 계산하지 않는다.
- 2026-10-01 격리 native seed를 실제 브라우저에서 PostgreSQL/MySQL/SQLite 각각 열었다. DB별 타입·생성/default/제약조건, 도메인/논리 필터·검색·갤러리 복귀를 확인했다. 세 프로젝트 원본 fingerprint 유지, version/sequence 0, baseline/operation 0, native 조회 요청은 GET만 발생했다. 이후 최종 표시 문구 빌드에서도 PostgreSQL 원본 보호와 기존 v1 WebSocket 동기화 표시를 확인했다.
- 초기 v1 offline은 QA harness의 SyncGateway 미연결 때문이었다. harness를 수정한 재검증에서는 동기화됨을 확인했다. 제품 수정으로 계산하지 않는다.
- UI 정적 검증은 HTML 문자열 escaping, 긴 numeric literal, 타입/인덱스/CHECK 표시, unavailable preview 분기를 포함한다. loader 테스트는 버전 분기·personal merge/충돌 보호·문맥/용량 검사를 확인한다.
- 브라우저 증거: [타입·생성 표시](assets/2026-10-01-Database-NativeWebReadQA.png), [키·FK·index·CHECK 표시](assets/2026-10-01-Database-NativeWebReadConstraintsQA.png).

## 범위와 다음 작업

native 화면은 구조화된 조회 전용 화면이다. native ERD 편집기, shared 저장/ACK, 업그레이드/import/history, native MCP 쓰기, DDL 다운로드 및 SQL 실행 검증은 아직 미구현이다. 신규 native 타입·기능의 usable gate는 활성화하지 않았다. 조회 연결을 전체 C4/C5 완료로 간주하지 않는다.

다음 단위는 DB 문맥을 전달받는 native 테이블·컬럼 생성/갱신과 FK 파생 컬럼 준비다. 이후 실제 편집 소비와 잠긴 서버 후보 검증·sync/MCP 저장 경로를 연결한다. 원본 문서와 기존 v1 클라이언트 보호를 유지한다.
