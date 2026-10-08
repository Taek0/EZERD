# 공유 모델·계약 미참조 선언 제거 완료

- [계획](../planning/2026-10-07-Legacy-UnreferencedDeclarationsPlan.md)에 따라 조사에서 확정한 1차 후보만 제거했다.
- 제거: physicalTypePatchSchema, removeKey, removeTableRelation, canApplyOperation, effectiveCardSize, syncHistoryEntrySchema/SyncHistoryEntry, syncFieldVersionSchema/SyncFieldVersion, projectDocumentSchema/ProjectDocument.
- 11개 선언의 본문 46줄과 주변 빈 줄을 제거하고 table-geometry.ts의 미사용 NodeLayout import를 정리했다. 실제 코드 diff는 6개 파일에서 53줄 삭제/1줄 추가로 52줄 순감소다.
- 같은 파일의 기반 함수·스키마와 Native/파일 호환/과거 이력 코드는 유지했다. 테스트 파일도 제거하거나 변경하지 않았다.
- 삭제 전후 apps/packages/scripts에서 이름을 검색해 schema/type 쌍 이외의 기존 소비자가 없고, 제거 후 잔여 참조도 없음을 확인했다. dist와 의존성 산출물은 소스 참조 검색에서 제외하고 패키지 빌드로 갱신했다.

## 검증

- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 전체 테스트: 202개 파일/2,584개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 웹 빌드: 1,627모듈, JS 1,753.67kB(gzip 497.36kB), CSS 130.32kB(gzip 25.50kB). 기존 500kB 청크 경고는 남는다.
- 이번에는 DB 통합 테스트와 브라우저 수동 QA를 추가 실행하지 않았다. DB 데이터·스키마, 서버 실행 상태, docs/EZERD.txt는 변경하지 않았다.
- 다음 단위는 Native가 사용하는 클립보드 저장소를 먼저 분리한 뒤 v1 전용 함수와 관련 테스트를 정리하는 작업이다.
