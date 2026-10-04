# DB별 Native 타입·기능 및 전체 물리 DDL 최종 검증

2026-10-04. 승인한 구현 범위를 완료했다. [구현 명세](../planning/2026-10-01-Database-CapabilitySpecification.md)와 [타입·기능표](../planning/2026-10-01-Database-TypeFeatureMatrix.md)의 검증된 지원 범위를 UI/서버/sync/MCP/import/기존 데이터/DB 변경/DDL에 연결했다.

## 결과

- PostgreSQL18, MySQL8.4 InnoDB, SQLite3.45 프로필을 프로젝트에 저장하고 DB별 타입·파라미터·기능·기본값·생성·키·FK·인덱스·CHECK/제한 AST의 같은 정책을 공유한다. 카탈로그는 PG65/MySQL37/SQLite23 선언이며 deprecated txid_snapshot은 신규 사용에서 제외된다. 새로 사용할 수 있는 기본 선언은124개다. 검증된33개 기능과 세부 조건을 활성화했다.
- 공유 메뉴의 DDL 내보내기는 현재 선택 화면과 별도로 프로젝트 전체 물리 설계를 해당 DB SQL/UTF-8 파일로 만든다. 불완전/미지원/환경 미확인 필드, 미저장 입력 및 미확인 요청은 진단과 함께 차단한다.
- Native 생성·편집·원문 보존·trusted upgrade/import/history/삭제 및 remap·clipboard·개인/공유 캔버스·REST/MCP·실제 sync ACK와 재생·구문맥 보호를 연결했다. 기존 v1은 명시 업그레이드 이전까지 별도 경로를 유지한다.
- 갤러리 DB 변경은 최신 문맥 preview와 영향 객체/전후 값 검토 후 검증된 변환만 원자 적용한다. 이름은 DB ACK 이후 최신 version으로 별도 저장한다. 원문 durable 요청, actor/lease/권한 및 stale precondition proof/archive/release를 연결했다.

## 최종 검증

| 검증 | 결과 |
| --- | --- |
| 최신 pnpm check | 포맷·모든 타입·모든 빌드 PASS; 단위2562 PASS/497 조건부 SKIP (196 passed/26 skipped files) |
| 실제 전체 API/MCP | 27파일498 PASS/0 FAIL/0 SKIP. [실행 결과](2026-10-03-Database-NativeFinalActualQA.md) |
| 최종 빌드 이후 HTTP/DB-change/WS | 3파일43 PASS/0 SKIP |
| 77 feature REST/MCP export | 77 accepted/0 blocked, 실제 SQL154개 PG/MySQL/SQLite PASS |
| PG typed/XML/jsonpath | 실제 product 경로62+23 및 별도 cast/default141 관찰, XML/jsonpath SQL22 실행 근거는 [결과](2026-10-03-Database-PostgresTypedDefaultConsumers.md) |
| 실제 브라우저 | 세 DB 물리 편집/SQL, exact ENUM·PK timing/NONE clear, private CAS 응답 유실·두 탭 archive/release, saved PNG, 명시 v1 upgrade, 빈/물리 DB변경·재로드 후 같은 요청 ACK복구·viewer 조회·미지원 변환 차단 |

[갤러리 실제 브라우저/원장 결과](2026-10-04-Database-NativeGalleryBrowserQA.md), [MySQL/SQLite 원문 SQL 실행](2026-10-03-Database-NativeBrowserDownloadsQA.md), [PG 브라우저](2026-10-03-Database-PostgresNativeBrowserQA.md), [private CAS 브라우저](2026-10-03-Database-NativePrivateCASBrowserQA.md). 최신 로그는 .data/2026-10-04-native-final-check-2.log 및 .data/2026-10-04-native-final-http-ws.log다.

## 범위와 한계

- 지원된 선언/기능은 임의 SQL·전체 literal/parser 문법을 뜻하지 않는다. XML/jsonpath/search/snapshot/array/multirange 등의 검증된 subset, 알려진 charset/collation/SRID0·4326와 프로필 가정을 유지한다. 사용자 정의 PG 타입·확장/설치 의존 및 미검증 조합은 예약/차단하고 기존 원문을 보존한다.
- 자동 물리 DB 변환은 검증된 PG↔MySQL signed16/32/64 정수 및 허용된 옵션·제약 조합만 적용한다. SQLite 및 다른 의미 변환은 진단으로 차단한다. 실제 DB에 저장된 사용자 행 데이터 이관 기능을 구현한 것으로 주장하지 않는다.
- JSON 파일 업로드가 사용자 브라우저 권한에서 거부되어 실제 브라우저 import 한 경로는 미검증이다. 재시도·우회하지 않았다. 실제 REST/MCP import/export 및 소비 helper 검증과 구분한다.
- active/expired lease 및 독립 unsaved draft의 모든 browser 조합을 실제 검증한 것으로 주장하지 않는다. 의미 있는 두 IDB 연결/fault/actor/권한 테스트와 기록한 실제 HTTP/browser 사례를 함께 근거로 삼는다. 저장 quota/손상/접근 실패나 동일 counter의 미확인 요청은 원문을 유지하고 임의 해제하지 않는다.
- Vite의 기존 단일 bundle 크기 경고는 남아 있다. 성능 재구조화는 이 범위에 포함하지 않았다.

## 자원·데이터 보존

- QA loopback3138/3139/3143/3144/3150 listener, 작업 소유 MySQL container/anonymous volume, .data/native-sqlite-345 CLI, 임시 harness를 정리했다. 개발 PostgreSQL ezerd-dev-postgres-1과 Downloads 원본은 보존했다.
- 사용하지 않은 ezerd_browser_dac0620ce347464eb788e2ca61f26054는 정확한 seed·프로젝트0을 확인하고 삭제했다.
- ezerd_browser_dc312ce2c33d42fc8870c908ee5fa0f2에는 작업 도중 다른 사용자의 test workspace와 프로젝트2개가 추가돼 삭제 guard에서 멈췄다. 해당 DB 전체를 유지했다. 비공개 로컬 백업 .data/2026-10-04-preserved-browser-db.sql (131102바이트, SHA256 490e2484e7f029443d39d5b0a78a3b6b4bada9c8fd1cede9b5ecdd898825d85b)을 보존했다. 백업에는 인증 관련 DB rows가 포함될 수 있어 Git에 포함하지 않는다.
- docs/EZERD.txt와 다른 작업 변경은 수정하지 않았다. 다른 작업의 Git push 관련 문서는 그대로 보존했다. 이 구현은 push/배포를 수행하지 않는다.

![프로젝트 전체 물리 DDL 내보내기](assets/2026-10-04-Database-NativeDBChangeDDL.jpg)