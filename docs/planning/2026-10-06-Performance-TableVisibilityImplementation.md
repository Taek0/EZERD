# 테이블 카드 표시 최적화 제품 적용 계획

- 검증된 content-visibility 후보를 NativeERDCanvas의 제품 CSS로 옮긴다. 테이블 카드만 대상으로 하고 도메인/메모/관계선은 변경하지 않는다.
- 선택/preview/focus/active/입력/dirty 카드는 visible을 유지한다. content-visibility와 :has를 함께 지원할 때만 적용하여 예외 선택자를 지원하지 않는 브라우저는 기존 표시 경로를 유지한다.
- NodeLayout의 명시적 치수, 원본 UI와 모션, Native 저장/권한/복구 로직을 유지한다.
- lab 대조군은 명시적인 opt-out으로 바꿔 제품 CSS와 이전 표시 경로를 비교한다. 새 제품 경로에서 기본 auto 및 선택 예외를 확인하고 50/100×10, 조건별 warmup+3회 이동을 재측정한다.
- pnpm format/format:check, 관련 회귀 테스트 및 빌드를 확인한다. 작업은 lab에 커밋하며 main/원격 반영은 별도다.
