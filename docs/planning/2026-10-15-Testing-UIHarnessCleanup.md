# UI 테스트 보조 코드 정리 계획

- 범위는 codex/performance-lab으로 한정한다. main과 실행 서버는 변경하지 않는다.
- 저장 유실·ACK 순서·재전송·권한·DB 제약·삭제 의존성의 기존 테스트와 단언을 유지한다.
- 같은 slots/cursor/effects 구조를 반복하는 Node 테스트의 훅 모킹을 하나의 test-only helper로 통합한다. 의도적인 렌더 중단/별도 layout effect 모델은 무리하게 합치지 않는다.
- 공통 helper의 상태·의존성·effect cleanup·memo/callback·실제 React fallback 계약을 검증한다. DOM/동시 렌더링 검증으로 과장하지 않는다.
- 대표 PK 컨트롤 테스트는 실제 React DOM 렌더러로 전환해 직접 구현한 훅 모형을 제거한다. 필요한 DOM 환경은 개발 테스트 의존성으로만 추가한다.
- 중복 React element 순회도 동일한 의미인 경우 공유한다. 작은 단위로 집중 테스트/커밋하고 최종 전체 검사와 성능 빌드를 확인한다.
- 삭제한 중복 코드량, 유지한 테스트/특수 실행기, 한계를 work-log에 기록한다. 원격 push는 하지 않는다.
