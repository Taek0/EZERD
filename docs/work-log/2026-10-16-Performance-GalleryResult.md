# 갤러리 목록의 현재 head 기반 미리보기 캐시

계획: [성능 우선 개선](../planning/2026-10-16-Performance-PriorityImprovements.md). 감사 B1에 대한 제품 변경이며 스키마·마이그레이션·공개 API 변경은 없다.

## 최종 변경

- `listProjects`와 `listProjectsPage`는 document를 제외한 프로젝트 메타데이터를 먼저 조회한다. 기존 membership join, workspace/status/search 조건, 정렬, cursor와 limit+1을 유지했다. REST 목록 전체를 반환하며 임의의 프로젝트 개수 제한을 추가하지 않았다.
- 매 요청 최신 membership과 head를 조회한 뒤 미리보기 캐시를 확인한다. 키는 id/workspaceId/createdAt/updatedAt/version/syncSequence/databaseKind/databaseProfileId/databaseRevision을 포함한다. 저장·히스토리·변환·가져오기 이후 바뀐 head는 다시 읽는다.
- 메타데이터와 miss document 읽기는 같은 repeatable-read/read-only transaction 안에서 수행한다. 다른 사용자의 캐시를 재사용하더라도 조회 권한 검사는 매번 현재 DB snapshot에서 수행한다.
- miss document는 승인된 프로젝트 ID로 16개씩 조회한다. MCP 페이지의 확인용 추가 1개 row는 document 조회 대상에서 제외한다. 원본 `projectPreview`를 그대로 사용하므로 Native/legacy 타입·ENUM·물리 표시 범위·테이블/관계 수·키 표시는 기존과 같다.
- 서비스 인스턴스별 LRU는 미리보기만 최대 256개, 직렬화한 키+미리보기 기준 1MiB까지 보관한다. document는 저장하지 않는다. 넣고 꺼낼 때 clone하여 API 응답 변경으로 캐시가 손상되지 않는다. 단독으로 예산을 초과하는 미리보기는 반환하되 캐시하지 않으며 유효한 다른 항목을 모두 퇴출하지 않는다.

## 검증

- `pnpm.cmd --filter @ezerd/server typecheck` 통과.
- `pnpm.cmd exec vitest run apps/server/test/workspace-gallery.test.ts apps/server/test/project-preview-cache.test.ts apps/server/test/project-preview.test.ts`: 3개 파일/10개 테스트 통과.
- 실제 Drizzle 쿼리 조립을 통한 서비스 테스트: 첫 요청의 metadata+document 조회, 재요청의 metadata-only 조회, warm hit 이후 membership 재검사, search escape/status/workspace/order/cursor/limit 보존, 페이지 여분 row의 document 제외, 33개 프로젝트 전체 반환과 miss 16/16/1 batch, sequence 변경 시 해당 문서만 재조회.
- 캐시 테스트: 모든 head 키 필드의 무효화, 입력/반환 clone, LRU 개수·바이트 퇴출, 버전 교체, oversized bypass. 기존 미리보기 테스트의 Native/legacy/ENUM/배열·관계·키·표시 범위 검사를 그대로 통과했다.

## SQL 투영 실험과 선택 이유

문서 대신 SQL에서 2개 테이블/각 3개 컬럼·전체 물리 모델 개수를 계산하는 방안도 시험했다. PostgreSQL 18의 별도 임시 cluster(127.0.0.1:55473)에서 compatibility fixture의 실제 SQL 결과가 기존 formatter와 같음을 확인했다. 앱 DB·환경 파일·운영 서버는 사용하지 않았고 cluster는 종료했다.

20개 프로젝트, 각 40/200개 테이블·12개 컬럼의 합성 fixture에서 full document 전송은 각각 약 6.87MB/26.86MB, SQL 투영은 약 13.18KB/13.22KB였다. 그러나 마지막 SQLPath 투영 실험은 DB 조회+Node formatter 중앙값이 40개 테이블에서 81.1→30.2ms, 200개 테이블에서 105.8→144.1ms였다(워밍업 후 교대 실행 7회). 대형 문서의 JSONB 탐색 비용이 서버 DB에 집중되어 후퇴했다. 따라서 SQL 구현은 제품에 반영하지 않고, 원본 formatter와 현재 head 기반 미리보기 캐시를 선택했다. 이 숫자는 최종 캐시 구현의 속도 측정 결과가 아니다.

원시 실험 스크립트/결과는 Git 제외 `artifacts/performance/2026-10-16-gallery-benchmark.ts`, `2026-10-16-gallery-rejected-query.ts`, `gallery-benchmark.json`에 남겼다. 합성 fixture 실험이며 운영 지연이나 DB I/O 개선율로 해석하지 않는다.

## 한계

- warm 목록은 document를 선택·전송·파싱하지 않지만 매번 metadata SELECT 및 BEGIN/COMMIT를 수행한다. cold 목록은 BEGIN/COMMIT + metadata SELECT + `ceil(misses/16)` document SELECT가 필요하다. 초기 요청·프로젝트 변경 후 요청에는 원본 document를 읽으며, 작은 목록에서는 transaction 왕복 비용이 추가된다.
- 256개를 넘는 반복 전체 목록은 캐시 퇴출과 재조회가 발생할 수 있다. miss가 많은 목록의 전체 처리량은 이 변경만으로 해결되지 않는다.
- 페이지가 없는 REST 계약은 그대로다. REST 페이지화와 UI 로딩 정책은 별도 계약·UX 작업으로 남겼다.
- 캐시는 인스턴스 간 공유되지 않으며 재시작 시 비워진다. 최종 변경의 실측 지연 개선율이나 DB TOAST 읽기 감소는 주장하지 않는다. 검증된 효과는 warm hit에서 full document 조회를 없애고 cold 조회의 batch 크기를 제한한 쿼리 형태다.
