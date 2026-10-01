# Native 삭제 역연산 순서 보존 결과

- 기준: [계획](../planning/2026-10-01-Database-NativeDeletionUndoOrder.md). 삭제 planner와 분리한 동기화 수정이다.
- native v2 diff는 삭제 엔티티의 원래 글로벌 배열 위치를 move 변경으로 기록한다. forward는 모든 위치 변경 후 삭제, inverse는 모든 엔티티 복원 후 원래 순서대로 위치를 복원해 삭제된 앵커도 사용할 수 있다.
- v1 변경 목록과 fingerprint를 바꾸지 않았다. 이전 durable 요청에 native 순서 메타데이터를 추가하지 않는다.
- 부분/전체 삭제, ID escaping, 다른 테이블 컬럼, 삭제+생존 객체 재정렬+새 객체를 함께 역연산해 정확한 원본을 확인했다. 기존 v1 삭제 claim의 배열도 확인했다.
- native/v1 sync 테스트 **34개 통과**. 작업 트리 전체 `pnpm check` **735개 통과/44개 건너뜀**, 포맷/타입/빌드 통과(진행 중인 미커밋 native 삭제 planner 테스트 10개 포함). 이번 커밋에는 planner 코드/테스트를 포함하지 않는다.
- native 서버 undo/restore의 fresh ID remap과 순서 변경 소비는 이후 서버 연결 단위에서 구현해야 한다. live v2는 아직 비활성이다.
