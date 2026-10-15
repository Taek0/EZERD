# UI 테스트 보조 코드 정리 기록

## 공통 계약

- shared/testing에 수동 Node 훅 driver와 React element 순회를 추가했다. 제품 런타임에서 import하지 않는다.
- 상태/함수형 업데이트/ref, memo/callback 의존성, 명시적 effect commit/cleanup, 실제 React fallback과 element 순회 계약 6개 테스트 및 웹 타입 검사 통과.
- 이 helper는 실제 React renderer나 동시 렌더링/DOM/레이아웃 모델이 아니다. 해당 의미를 검증하는 특수 실행기는 유지한다.
- 기존 안전성 테스트 단언은 제거하지 않고 같은 구조의 반복 보조 코드부터 이 helper로 통합한다.

## 공통 실행기로 이관

- 15개 테스트 파일의 중복 훅 구현을 공통 helper로 이관했다. 기존 152개 시나리오와 463개 expect 호출의 AST가 유지됨을 확인했다.
- 공통 helper 계약까지 포함한 집중 검사 159개와 웹 타입 검사가 통과했다.
- 고급 편집/ENUM의 명시적 재렌더 신호는 onStateChange로 보존했다. i18n snapshot과 갤러리 imperative ref의 특수 모킹은 각 테스트에 명시적으로 남겼다.
- 같은 의미인 element 순회와 state 생성도 공유했다. 렌더 중단·layout/passive 분리·드래그 DOM 모델을 다루는 특수 실행기는 이번 이관에서 제외했다.
