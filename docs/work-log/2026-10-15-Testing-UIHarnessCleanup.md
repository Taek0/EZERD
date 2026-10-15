# UI 테스트 보조 코드 정리 기록

## 공통 계약

- shared/testing에 수동 Node 훅 driver와 React element 순회를 추가했다. 제품 런타임에서 import하지 않는다.
- 상태/함수형 업데이트/ref, memo/callback 의존성, 명시적 effect commit/cleanup, 실제 React fallback과 element 순회 계약 6개 테스트 및 웹 타입 검사 통과.
- 이 helper는 실제 React renderer나 동시 렌더링/DOM/레이아웃 모델이 아니다. 해당 의미를 검증하는 특수 실행기는 유지한다.
- 기존 안전성 테스트 단언은 제거하지 않고 같은 구조의 반복 보조 코드부터 이 helper로 통합한다.
