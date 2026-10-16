# 웹·백엔드 코드베이스 품질 감사

## 기준과 방법

- 원격 main f318b8e9a6a847d3fe9981676d63168449f7009c (2026-10-16). 조사 중 다시 fetch하여 같은 커밋임을 확인했다.
- 읽기 전용 사본: D:/ChatGPT/ERD-code-audit. 웹 렌더·편집, 클라이언트 저장, 서버 API/DB/실시간, 모델/계약, 미사용 코드·의존성을 병렬 조사했다.
- 추적 파일 2,483개 중 TS/TSX/JS 계열 648개, test/spec 파일 295개. 파일 수나 파일 크기만으로 불필요하다고 판단하지 않았다.
- AST import/export 그래프는 type-only·barrel·literal dynamic import·Worker URL을 포함하는 보수적 분석이다. 그래프 후보는 검색과 실제 진입점으로 재확인했다. dist 경로로 호출되는 DDL fixture 등은 미사용 판정에서 제외했다.
- 반복 호출·복잡도·쿼리 형태는 코드로 확인했다. 실제 지연/FPS/DB 부하와 개선율은 측정하지 않았다. 이번 감사에서는 테스트·빌드·DB 호출을 실행하지 않았다.
- 아래 경로/줄은 고정 사본 기준이다. 제품 구현·원본 문서·실행 서버는 변경하지 않았으며 문서만 작성했다.

## 정리 가능한 요소

| 구분 | 근거 | 권고 |
| --- | --- | --- |
| 미사용 컴포넌트 확정 | apps/web/src/components/ui/RenameDialog.tsx:9. 정의 외 제품·테스트·스크립트·barrel·dynamic import 참조 없음 | 컴포넌트와 confirm.css:61,66의 전용 .rename-dialog 선택자 정리. 공용 ConfirmProvider 스타일은 유지 |
| 미사용 직접 의존성 확정 | apps/web/package.json:18 tailwind-merge. import/twMerge 사용 없음. 실제 cx는 components/ui/untitled.tsx:30의 join | dependency·lock·UI license notices 함께 정리. Tailwind 자체는 사용 중 |
| 종료된 v1 장면 준비 경로 | features/relations/prepare-table-relations.ts:19와 table-relation-label.ts:2는 테스트/reference 외 실행 호출 없음. 실제 장면은 NativeERDCanvas.tsx:185,333 | 유효한 규모·가시성 단언을 native 장면 테스트로 옮긴 후 준비기·전용 reference/tests 정리. diagram-fixture.ts는 obstacle-queries.test.ts의 사용부터 대체 |
| 오래된 실행 QA 도구 | scripts/browser-home-smoke.mjs:91은 PIN 누락, :19 helper는 인증 헤더 없음. browser-user-pin-profile-smoke.mjs:72의 직접 프로젝트 생성도 인증 없음. browser-pin-editing-smoke.mjs:59와 browser-rename-context-pin-smoke.mjs:30은 PIN 입력 없이 가입 제출 | 현행 인증/native 흐름으로 갱신하거나 사용 종료 표시. 단순 무참조 파일과 구분 |
| 정책 재검토 후보 | features/projects/native-upgrade.ts는 native-upgrade.test.ts에서만 사용. project-entry.ts:21은 v1 열기 거부 | 2026-10-07-Legacy-NativeOnlyEditorResult.md:7에서 의도적으로 보존한 로직이므로 자동 삭제하지 않는다. 서버 upgrade API와 durable upgrade 레코드 복구는 유지 |

미사용 파일은 대체로 유지보수·빌드·검증 비용 문제다. 번들에 포함되지 않는 파일을 삭제해도 앱 FPS가 직접 좋아진다고 주장하지 않는다.

## 웹 성능 후보

| ID | 확인된 작업과 근거 | 최소 개선 방향 / 검증 |
| --- | --- | --- |
| W1 | NativeERDCanvas.tsx:1112–1134 그룹 draft에 nodesJSON과 첫 객체 좌표가 모두 있음. :891 singleDrawn → :389 전체 scene 계산 후 :918–932 그룹 분기가 다시 전체 scene 계산 | 단일/그룹 분기를 계산 전에 선택. 장면 생성 1회, 좌표·경로 동일, 최종 pointer 저장과 손상 draft fallback 검증 |
| W2 | :198 tableMetrics 캐시가 scene 호출 안에서만 유효. native-table-canvas.ts:54,61,76은 테이블마다 전체 관계/컬럼, 행마다 전체 키 검색. NativeCanvasTableRows.tsx:71도 별도 치수 계산 | 구조/표시 치수를 좌표와 분리하고 컬렉션 인덱스 공유. 이동은 재측정 없이 처리하고 타입·설명·키·모드 변경만 무효화. PNG/포트 치수 일치 유지 |
| W3 | NativeERDCanvas.tsx:333 동기 relationGeometry는 budget 없음. relation-routing.ts:234,242 격자, :326 이웃별 장애물 검색, :533 fallback이 일반 이동 중 무제한 탐색 가능 | 밀집 문서 실측 후 제한된 preview·공유 장애물 준비·마지막 유효 경로 사용 검토. Worker 자동 정렬 상한은 이 경로를 보호하지 않음 |
| W4 | NativeCanvasInlineCell.tsx:57,62,94와 native-inline-edit.ts:20에서 동일 table/column find 반복. 여러 셀로 확대됨 | 한 번 해석한 입력 또는 기존 table/row.column 전달. focus/draft/최신 권한·저장 기준 유지 |
| W5 | NativeProjectView.tsx:1069–1157,1695의 outline·컬럼 표시명·도메인별 테이블·검색 자료가 무관한 렌더와 숨긴 패널에서도 재생성 | 문서/모드 인덱스와 검색 필터 분리 memo. 토글·선택 시 재생성 없이 문서/검색 갱신 정상 여부 검사 |
| W6 | NativeCanvasScene.tsx:152,172 hover 상태가 memo되지 않은 NativeTableLines를 재실행. NativeTableLines.tsx:59–79 모든 관계 tooltip마다 전역 table/column find | 선 레이어 memo와 lookup 공유. 선택·언어·문서 갱신 및 컬럼 강조 유지 |

팬의 카메라 변경은 scene memo 입력이 아니므로 W1/W2를 모든 화면 이동에 확대 적용하지 않는다. 세 패널 리사이즈는 이미 DOM preview 후 종료 시 React commit하며, 포인터마다 React가 갱신되는 것으로 보고하지 않는다.

## 백엔드 API·DB·실시간 후보

| ID | 확인된 작업과 근거 | 최소 개선 방향 / 안전 경계 |
| --- | --- | --- |
| B1 | workspace/workspace.service.ts:158–175 REST 프로젝트 목록은 페이지 제한 없이 전체 projects row/document를 읽고 preview 생성. App.tsx:590 실제 갤러리가 사용. MCP 페이지 목록(:188)도 각 document 읽음 | REST 페이지화 및 version 기반 preview 저장/캐시, metadata만 조회. 문서 최대 1.5MB이므로 응답 크기보다 DB 읽기량이 클 수 있음. 권한·검색·변환 후 preview 일치 검증 |
| B2 | review/review.service.ts:139–144 모든 thread ID 후 loadThread(:45–52)로 thread/전체 replies 재조회: 2N+1 쿼리. 같은 transaction의 Promise.all도 쿼리 수는 동일. CommentsPanel.tsx:286,391에서 사용 | 우선 bulk query, 이후 summary 페이지+필요한 replies만 조회. 답글/변경 뒤 thread 전체 재전송(:300,310,324,330)도 검토. 순서·실시간·충돌 복구 유지 |
| B3 | space.service.ts:453–477 초대 전체 이력별 invitation(:363–370)에서 workspace/user를 직렬 조회. owner(:120–128)의 FOR UPDATE를 목록 처리 동안 유지 | join·페이지화와 짧은 expiry/권한 잠금. 만료 audit(:394), owner 검사·동시성·마지막 owner 규칙 유지 |
| B4 | identity/session.ts:100–103 성공한 매 API/WS 인증마다 lastSeenAt UPDATE. schema/write 외 application reader 없음 | 관측 목적 확인 후 조건부 주기 갱신. mcp-auth.service.ts:53–64의 1분 갱신 참고. 토큰·만료·로그아웃 확인 자체는 매번 유지 |
| B5 | sync.gateway.ts:211–224 소켓마다 직렬 requireProject(project/workspace/membership 조회). 같은 사용자의 여러 탭도 반복. :226–263의 15초 heartbeat와 :103 timer는 이전 sweep 완료 여부를 확인하지 않음 | delivery 단위의 distinct user 최신 권한 bulk 검사, 중첩 sweep 차단. unsubscribe·권한 회수 안전성 유지 |
| B6 | review.service.ts:343–349 REST 알림 전체 조회. CommentsPanel.tsx:608–624는 닫힌 알림 UI에서도 갱신. read 표시(:402) 등이 lockActiveProject(:98–103) SELECT *로 불필요한 document까지 읽음 | unread count/페이지 목록 분리, metadata lock helper. 문서가 필요한 thread 생성은 구분하고 archive/멤버십 검사 유지 |

MCP용 페이지 API가 있어도 실제 REST UI가 그것을 쓰는 것은 아니다. 페이지 서비스 메서드를 미사용 중복으로 제거하지 않는다.

## 저장·검증·히스토리 후보

| ID | 근거와 비용 | 권고 / 보존할 조건 |
| --- | --- | --- |
| S1 | model/database/validation.ts:401의 컬럼 루프 안 :418 전체 doc.columns.filter: O(C²). :241 tableKeys도 반복 filter. :78,80 candidate/previous 모두 collect, 서버 native-sync-candidate.ts:200에서 호출 | collect당 table별 visible columns/name frequencies/keys 인덱스. DB profile별 진단과 기존/새 오류 비교·fingerprint 보존 |
| S2 | native-sync.service.ts:259–274 및 native-history.service.ts:550–578은 영구 field versions 전체 조회. model/sync.ts:499–525,701은 guarded path마다 entries 배열 복사/검색: O(G×P) | path/sequence만 조회, entries 한 번 생성, prefix index 검토. 삭제 ID 재등장 방지용 영구 증거는 TTL 삭제 금지 |
| S3 | native-sync.service.ts:363–391, native-history.service.ts:842–869은 snapshot마다 직렬 tombstone upsert. history :588–609은 개별 provenance read | 중복 키 정규화 후 bounded bulk read/upsert. 객체별 snapshot/operation/sequence/expiry와 rollback 보존 |
| S4 | mcp-native-document.service.ts:347–379 → native-sync.service.ts:233–245 → issueBaseline(:141–150)은 메모리로 사용하는 중간 baseline도 저장. 승인 뒤 :392–400에서 다음 baseline 추가 저장 | 공개 durable baseline과 내부 transaction-local 준비 분리 검토. 다음 baseline은 history provenance에서 사용하므로 유지 |
| S5 | native-sync.service.ts:430–475 events(since)는 limit 없이 full result.document/changes/deletionSnapshot 조회·파싱. retention gap reset도 이후 판단 | backlog 상한·필요한 projection·초과 snapshot reset. 현재 웹 일상 구독은 notification이므로 주 입력 경로 병목으로 단정하지 않음 |
| S6 | use-native-local-entries.ts:22–38,54 draft 알림마다 native-local-projection.ts:107–139 origin storage 키 열거/intent JSON·schema 파싱. startTransition도 내부 동기 읽기는 지연하지 않음 | draft와 intent 알림 분리, actor/project 캐시를 실제 storage·ACK bridge·교차 탭 변경에만 무효화. 저장 실패/권한/복구 표시 유지 |
| S7 | NativeHistoryDialog.tsx:119–127 항목마다 describeChanges. native-history-labels.ts:124–144는 매번 전체 loaded history+document 이름 context 구축: O(H×(C+D)) | 공통 context 한 번 생성하고 항목별 historical/deleted 이름 우선순위 적용 |
| S8 | model/database/validation.ts:1440 generated-column cycle 검사 정점마다 DFS: 긴 chain에서 O(G²) | 단일 SCC/메모화 순회. 동일 cycle 진단 대상 및 fingerprint 보존 |
| S9 | model/layout.ts:126 같은 layer에 singleton 추가마다 누적 배열 복사: O(V²) | layer 배열 생성 후 append. SCC는 이미 반복형이므로 재귀 문제로 오인하지 않음 |

## 개발·검증 비용

- root package.json:18–26 check는 typecheck의 build:shared, test의 build:shared, 마지막 recursive build로 shared 패키지 build를 세 번 호출한다. 웹 타입 검사도 apps/web/package.json:8–9에서 반복된다.
- 독립 명령의 준비 과정은 유지하고 통합 check 내부만 공유하는 방향이 안전하다. 시간 절감량은 미측정이다.
- 최근 새 워크트리의 font-cache 시간 초과는 별도 계측 대상이지 테스트 제거 근거가 아니다. 자산 해시 무결성 검증은 유지한다.
- UI 훅 모킹은 이미 공용화된 부분이 있다. 테스트 수만 줄이는 것보다 종료된 기능 전용 검사와 실제 회귀 안전성을 구분해야 한다.

## 유지할 요소와 이미 개선된 부분

- ea596b3의 compact history/newest keyset pagination, SQL의 document/delta 제외와 웹 compact=true는 현재 main에 반영되어 있다. 과거 full-history payload 문제와 남은 S7 라벨 CPU 비용은 다르다.
- committed-event, memoized scene/table rows, frame-coalesced marquee, DOM resize preview, selected-only detail, 접힌 advanced editor 검증 억제는 유지한다.
- relation-routing.reference.ts는 현재 알고리즘의 차등 검증 oracle이다. 종료된 v1 준비기의 reference와 구분한다.
- 600 WOFF는 600 @font-face와 연결되어 unicode-range로 선택 로드된다. 모두 미사용 자산이라는 결론은 잘못이다.
- Tailwind sr-only, Nest rxjs/platform-express, new URL Worker 진입점, 도구가 dist 경로로 쓰는 ddl-fixtures는 사용 중이다.
- v1 import/read/upgrade·DB profile 계약·actor-bound ACK·immutable request identity·cancellation fence·durable lease·ACK 후 정리·retired ID 증거·history provenance는 제거 대상이 아니다.

## 권장 순서

1. 미사용 RenameDialog/직접 의존성과 오래된 QA 도구를 작은 독립 변경으로 정리.
2. 편집 체감: W1 중복 scene 제거 → W2/S1 인덱스·치수 재사용 → W4/W5/W6/S6 갱신 범위 축소.
3. 백엔드: B4 세션 touch → B1 갤러리 projection/페이지 → B2/B6 댓글·알림 → B3/B5 초대·WebSocket 배치화.
4. 쓰기: S3 bulk tombstone → S2 버전 인덱스 → S4 중간 baseline. 복구·충돌 검사와 DB query/lock 시간 측정을 함께 수행.
5. W3 일반 이동 routing budget과 S5 catch-up 상한은 제한 시 UX/프로토콜까지 정한 뒤 적용.

검증 지표는 장면/치수 계산 횟수, 입력·드래그 프레임 지연, DB query/row/byte 수, 세션 UPDATE 빈도, transaction lock 시간, backlog 크기별 복구 비용이다. 기능과 안전성 동등성을 먼저 확보하고 효과를 실측한다.

원시 모듈 그래프/스크립트: artifacts/performance/2026-10-16-codebase-audit (Git 제외). 이번 작업은 조사·문서화만 수행했다.
