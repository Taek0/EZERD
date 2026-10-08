# 미사용 v1 선언 제거

- [계획](../planning/2026-10-07-Legacy-UnusedV1RemovalPlan.md)의 단위 2 완료. 단위 1은 [모듈 제거 기록](2026-10-07-Legacy-UnusedV1ModulesRemoval.md)에 기록했다.
- referencedDomainTables, relationTargets, applyRouteBend, physicalTypes, parseMetadata, saveDocumentSchema를 제거했다.
- 해당 선언만 검사하던 테스트와 불필요 import를 정리했다. 혼합 테스트 파일의 나머지 검증은 유지했으며 document.test.ts의 미지원 문서 형식 거부 검증도 보존했다.
- 앱·패키지·스크립트에서 제거된 선언의 참조가 남지 않았음을 확인했다. Native 공유 코드와 기존 v1 실행 경로는 변경하지 않았다.
- pnpm format 적용 후 pnpm format:check, pnpm typecheck, pnpm build, git diff --check 통과. 변경된 테스트 파일 5개의 테스트 49개가 통과했다.
- 관련 테스트: Canvas.test.ts, canvas-state.test.ts, table-relations-sync.test.ts, TableEditor.test.ts, packages/contracts/src/document.test.ts.
- Vite의 500kB 초과 청크 경고는 남지만 빌드는 성공했다. 전체 테스트 스위트·DB 통합 테스트·브라우저 QA는 이번 미사용 선언 제거에서 실행하지 않았다.
- 단위 2 코드·테스트 변경은 10개 파일, 150줄 삭제/6줄 추가로 순감소 144줄이다. 단위 1을 합하면 코드·테스트 총 488줄 순감소이며 작업 문서 증가는 제외했다.
