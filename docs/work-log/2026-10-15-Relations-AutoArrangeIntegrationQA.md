# 관계선 자동 정렬 통합 검증

2026-10-15. [구현 계획](../planning/2026-10-15-Relations-AutoArrangeImplementationPlan.md)의 로컬 표시, ACK, 실행 취소 경계를 별도로 검증했다.

- `native-relation-arrange-integration.test.ts`는 일괄 관계선 명령이 대기 중 로컬 문서에 표시되고, ACK와 화면 갱신 사이에는 동일 결과가 브리지되며, 확정 문서가 도착하면 임시 항목이 제거되는 흐름을 검사한다. 같은 ACK를 다시 적용해도 문서 참조가 교체되지 않는지도 확인한다.
- 관계선 변경 후 테이블을 이동한 경우, 관계선 변경의 역변경만 적용하면 테이블의 최신 위치와 관계 정의가 보존되는지 검사한다.
- `performance/relation-arrange.html`은 실제 `NativeProjectView`와 Worker를 띄우는 격리된 브라우저 픽스처다. API 쓰기, 작업 조회, 히스토리, 취소 응답은 브라우저 메모리에서 처리하며 실제 DB에는 쓰지 않는다. 저장 지연(2초/10초)과 응답 보류·해제 컨트롤로 로컬 저장 대기, 전송 중 취소, ACK 및 히스토리 undo를 관찰할 수 있다.
- `?actual`은 기존 `actualFixturePlugin`의 `/__diagnostic/snapshot.json`을 사용한다. `EZERD_ACTUAL_FIXTURE=1`, `EZERD_ACTUAL_FIXTURE_PATH`에는 `artifacts/performance/2026-10-14-actual-document/snapshot.json`의 절대 경로를 지정하고 `127.0.0.1:4180/performance/relation-arrange.html?actual`에서 연다. 이 파일을 제공하지 않으면 기본 50개 테이블 픽스처를 사용할 수 있다.

검증: 새 Vitest 파일 2개 테스트 통과, `pnpm --filter @ezerd/web typecheck` 통과. 실제 DB에 대한 HTTP 저장·재전송·히스토리 undo 검증은 별도의 격리 DB 테스트에서 다룬다.
