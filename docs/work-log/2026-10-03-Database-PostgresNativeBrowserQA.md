# PostgreSQL native 대표 브라우저 QA 결과

계획: [PostgreSQL native 대표 브라우저 QA](../planning/2026-10-03-Database-PostgresNativeBrowserQA.md). 작성일: 2026-10-03.

## 결과

실제 UI 대표 경로와 다운로드 원본의 PostgreSQL 18.6 실행·롤백 검증을 통과했다. 생산 소스 수정, git add/commit, 전체 check/build는 수행하지 않았다. 부모 MySQL/SQLite QA와 별도로 loopback 3138, 작업 소유 UUID DB 및 테스트 계정을 사용했다. 부모 3139/qaFinalTab와 Aristotle 3143/3144는 건드리지 않았다.

| 경로 | 확인한 실제 결과 |
| --- | --- |
| 정상 로그인 → PostgreSQL native 프로젝트 생성 | 테스트 계정의 워크스페이스에서 UI로 생성. 목표 profile `postgresql-18-v1`. |
| 물리 테이블/컬럼 → INTEGER 변경 | `public.pg_records.record_id INTEGER NOT NULL`. 기존 타입 옵션 초기화 확인을 명시한 뒤 저장 ACK 확인. |
| 프로젝트 ENUM exact labels | `qa_labels.label_state`에 빈 문자열, `line\nbreak`의 실제 LF, `한글😀`를 각각 별도 값 컨트롤로 입력·저장. 저장 객체 다시 열기 및 DB 문서에서 순서/내용 완전 일치. UTF-8 길이 0/10/10바이트. |
| PK 지연 검사 | `pk_pg_records`를 기본 지연 검사로 생성. 저장 문서와 accepted ledger sequence 5에 `{ initially: "deferred" }` 확인. |
| 기존 PK NONE clear | UI의 `지연 불가` 선택 후 저장. sequence 6에서 `/keys/.../deferrable`의 `before` 보존, `after: null`, `afterExists: false` 확인. 최종 문서에 optional 필드 없음. 다시 연 컨트롤도 지연 불가 선택. |
| whole SQL 실제 다운로드 | 내보내기 화면의 설계 버전 6 확인 후 `SQL 다운로드` 클릭. 브라우저가 생성한 실제 다운로드 파일을 바이트 그대로 복사. |
| DB 상태 | version 6, sync sequence 6, DB revision 0. accepted online ledger 1~6 연속, base sequence 0~5. |

## 다운로드 SQL 실제 실행

[다운로드 원본 SQL](assets/2026-10-03-Database-SolPgExport.sql): 369바이트, SHA-256 `26da11c4bc70a3790497422c2b6af46a153be8f42e788cbacb7ecedd8fb7af42`.

실행 엔진은 PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)이다. 원본 SQL에 임의 치환을 적용하지 않고 소유 QA DB의 `BEGIN`/`ROLLBACK` 안에서 실행했다.

- `pg_enum`에서 1/2/3 순서로 빈 문자열, 실제 LF 포함 문자열, Unicode 문자열이 정확히 일치했다. 각각 parameterized ENUM cast 후 text roundtrip도 일치했다.
- `pg_attribute`에서 `record_id`의 `integer` 및 NOT NULL 확인. 정수 7 INSERT/SELECT 성공.
- PK 카탈로그는 `condeferrable=false`, `condeferred=false`로 NONE clear 반영. PostgreSQL 18의 별도 NOT NULL constraint와 PK를 구분해 조회했다.
- 롤백 후 테이블, ENUM type, 새 `qa_labels` namespace 모두 없어졌다. 앱 프로젝트 문서·버전·sequence·revision은 실행 전후 deep equality로 동일했다.

[비밀 없는 검증 결과 JSON](assets/2026-10-03-Database-SolPgVerification.json)에 실제 엔진, 파일 hash, metadata 및 rollback 결과를 보존했다.

## 화면 증거

테스트 계정/테스트 설계만 포함하며 PIN, 토큰, DB 접속 문자열을 포함하지 않는다.

- [저장 ENUM 다시 열기](assets/2026-10-03-Database-SolPgEnumSaved.jpg)
- [PK 지연 검사 선택](assets/2026-10-03-Database-SolPgDeferredKey.jpg)
- [PK NONE clear 후 UI](assets/2026-10-03-Database-SolPgNoneClear.jpg)

## 한계 및 정리

이 QA는 요청된 대표 positive/raw labels/clear/download 경로다. ENUM 배열 컬럼, 모든 FK/UQ 조합, label 이동·삭제 전체 조합은 추가하지 않았다. 미지원 조합의 활성화나 coverage 변경은 없다. 저장/export를 막는 제품 장애는 발견하지 않았다.

브라우저 다운로드 이벤트 대기는 도구 시간 초과가 발생했으나 실제 Chrome 다운로드 파일은 생성됐다. 파일 직접 읽기·바이트/hash·DB 실행으로 완료를 확인했다. 시간 초과 후 브라우저 연결의 소유 탭 목록은 비어 있었다. 소유 harness에 `stop`을 전달한 결과 exit 0 및 `OWN_QA_CLEANUP_COMPLETE`를 확인했고, `pg_database`에서 정확한 소유 UUID DB 부재와 3138 listener 부재도 확인했다. 타 작업 DB/리스너 및 사용자 다운로드 원본은 삭제하지 않았다.

확인 중 `record_id` 키 후보 조건에 내부 코드 `key.btree-entry-size-limit`가 그대로 보였다. 저장은 성공했으며 조건 문구 정리는 부모의 별도 판단 사항이다. 이 단위에서는 생산 UI를 수정하지 않았다.

실행 보조 스크립트와 fixture state는 ignored `.data/sol-pg-*`에만 두었다. 결과 파일 범위는 본 계획/기록, 세 화면, 다운로드 SQL 및 검증 JSON이다.
