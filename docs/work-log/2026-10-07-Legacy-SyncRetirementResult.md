# v1 클라이언트 동기화·히스토리 제거

- [계획](../planning/2026-10-07-Legacy-FrontendRetirementPlan.md)의 단위 2 완료. [편집기 제거](2026-10-07-Legacy-EditorRetirementResult.md)에 이어 진행했다.
- sync-client, sync-events, sync-history-labels, sync-history-panel와 전용 CSS, sync-queue, sync-storage 구현 7개 및 전용 테스트 6개를 제거했다.
- v1 operations/IndexedDB/히스토리 화면을 전제로 한 browser-autosync-smoke, browser-history-filters-smoke, v1 문서 PUT/수동 저장을 전제로 한 browser-undo-smoke 스크립트 3개를 제거했다. 서버 동기화 API나 DB를 실행·삭제한 것은 아니다.
- localization.test.ts의 프로젝트 가져오기·MCP·사용자 색상 검증은 보존했다. 히스토리 검증은 NativeHistoryChanges와 Native describeChanges 및 v2 문서로 전환해 다국어 전환과 사용자 메모 원문 보존을 검사한다.
- collaboration/translations.ts는 Native 이력과 파일 가져오기가 사용하므로 보존했다. Native durable queue, 개인 CAS, 히스토리·취소·복구 기능은 변경하지 않았다.
- 두 단위 합계: 구현 32개, 전용 테스트 23개, QA 스크립트 16개로 총 71개 파일 삭제. 혼합 테스트의 공유 동작 검증은 유지·직접 연결했다.

## 현재 사용 요소 보존 확인

- 삭제 전 main.tsx에서 도달한 로컬 소스·스타일 151개는 삭제 후에도 모두 존재하며 SHA-256이 동일했다. packages와 서버 소스는 변경하지 않았다.
- 삭제한 모듈에 대한 코드·스크립트 참조를 재확인했다. native-only-entry 테스트의 금지 목록 외에 제거된 클라이언트 동기화 모듈 참조는 남아 있지 않다.
- 삭제된 QA 스크립트의 실행 참조는 현재 README·package·스크립트에서 발견되지 않았다. 과거 docs 기록은 당시 사실로 보존했다.
- 최종 빌드에서 CSS가 소폭 달라져 삭제된 71개 파일을 b880d19 원문으로 임시 복원한 별도 비교 빌드를 만들었다. 비교 후 해당 파일은 다시 제거했다.
- 비교 JS 번들 내용은 **바이트 단위로 동일**하다. CSS에서 제거된 내용은 `.\!resize{resize:both!important}` 유틸리티 32바이트뿐이다. 현재 런타임의 클래스 사용은 없으며, NativeResizeHandle의 resize 동작과 스타일은 유지한다. JS 파일명 해시는 CSS 연관 산출물 변경으로 달라졌으나 JS 텍스트는 같다.
- 최종 산출물: JS 1,753.51kB(gzip 497.30kB), CSS 130.32kB(gzip 25.50kB), 1,627모듈. 이전 CSS는 130.35kB였다. 이 비교는 브라우저 성능 실측이 아니다.

## 검증과 남은 범위

- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 최종 전체 테스트: 204개 파일/2,626개 테스트 통과, 27개 파일/506개 테스트 건너뜀. 별도 브라우저·DB 통합 테스트는 실행하지 않았다.
- Vite의 500kB 청크 크기 경고는 남지만 빌드는 성공했다.
- relation-routing.reference, prepare-table-relations/reference, 카드 크기 모델 테스트 등 현재 회귀 검증이 사용하는 기준 구현은 보존했다. 서버 v1 API/MCP, 파일 import/export/upgrade와 Native legacy 원문 지원도 유지한다.
- 그 밖의 공통 UI·혼합 QA를 이름만 보고 일괄 삭제하지 않았다. 다음 단계는 서버 v1 소비자 및 남은 v1 데이터 기반 QA를 별도로 조사해 범위를 분리하는 것이다.
- 조사·비교 빌드 임시 산출물은 정리했다. docs/EZERD.txt는 수정하지 않았다.
