# 패널 리사이즈 및 컬럼 토글 검증 결과

## 반영한 개선

- 탐색/핀 패널: pointermove마다 상위 NativeProjectView의 폭 state를 갱신하던 경로를 rAF CSS 미리보기로 분리했다. pointerup/cancel/lost capture에서 폭을 확정하고 키보드 접근성과 저장 동작을 유지했다.
- 컬럼 상세: 선택 컬럼 ID를 해당 테이블 카드에만 전달한다. 관련 없는 NativeCanvasTableRows의 memo props가 바뀌지 않도록 했다.
- 기존 상세 패널 애니메이션과 native world의 will-change:auto는 유지했다.

## 검증

- pnpm check 성공: 포맷 검사, 타입 검사, 2,887 tests passed / 499 skipped (242 files passed / 26 skipped), 제품 빌드.
- 전후 profiling 빌드 성공: f9853fa 제품 파일 4개를 사용하는 baseline과 현재 구현. 큰 번들 경고는 있으나 빌드 오류는 없다.
- Chrome 합성 fixture 50개 테이블: 탐색 패널 Home→ArrowRight로 210px 확인, 실제 포인터 60px 드래그 후 270px 확인. 핀 패널 ArrowLeft로 330px, 실제 포인터 40px 드래그 후 370px 확인.
- 같은 fixture의 첫 컬럼 상세 버튼 aria-expanded가 클릭 후 true, 다시 클릭 후 false임을 확인했다. 서버 쓰기는 fixture에서 차단된다.
- 회귀 테스트에서 핀 pointermove 100회 동안 onWidthChange 호출 0회, 종료 시 1회를 확인했다. 컬럼 선택 시 비대상 카드의 전체 props 동일성도 확인했다.

## 아직 확정하지 않은 항목

- 100개 테이블 자동 전후 계측에서 프레임 진행이 비정상적으로 느려 실행을 중단했다. 콘솔 오류는 없었으며 visibilityState는 visible이었으나, 창 가림에 따른 스케줄링 제한인지 제품 비용인지 구분하지 못했다. 따라서 FPS·시간 개선율은 보고하지 않는다.
- 사용자에게 Chrome 측정 창을 전면에 유지하도록 요청했다. 조건 확인 후 같은 fixture의 warmup 1회 + 측정 3회를 완료하고 JSON을 artifacts/performance에 보관해야 한다.
- 좁은 화면에서 inspector bounds ResizeObserver에 의한 별도 state 갱신은 남아 있을 수 있다. 실제 사용자 문서의 체감 개선과 함께 추가 확인한다.
- 원격 push/PR은 이번 작업에 포함하지 않았다.

[계획](../planning/2026-10-12-Performance-PanelResizeAndColumnToggle.md) · [폭 분리](2026-10-12-Performance-PanelResizePreview.md) · [컬럼 선택 범위](2026-10-12-Performance-ColumnSelectionScope.md) · [계측 방법](2026-10-12-Performance-PanelInteractionMeasurement.md)
