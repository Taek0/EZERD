# 테이블 카드 제품 구현 검증

## 구현과 코드 범위

제품 변경 커밋은 `8355d35`다. NativeERDCanvas.css에 18줄을 추가하여 테이블 카드에 content-visibility:auto를 적용하고 선택/preview/focus/active/입력/dirty 카드는 visible로 유지한다. content-visibility 및 :has를 함께 지원하지 않으면 기존 표시 경로를 유지한다.

제품 source(features/components/app/server/packages)의 origin/main 대비 차이는 해당 CSS 파일뿐이다. 도메인/메모/관계선 및 원본 모션·컴포넌트·저장 로직은 변경하지 않았다. 성능 lab의 opt-out 스타일은 대조군에만 사용한다. inline-product는 실험용 auto 선언을 추가하지 않고 제품 CSS를 그대로 사용한다.

## 검증 결과

- pnpm format, format:check 통과.
- NativeCanvasInlineCell/Scene/TableRows/InputForm/route-edit **5개 파일·79개 테스트 통과**.
- pnpm build: 공유 패키지·서버·웹 제품 빌드 통과. 기존 bundle 크기 경고는 유지된다.
- clean production profiling build `edf44a8`, Chrome 154, DPR 1, viewport 1280×720, surface 1280×520, 테이블당 10컬럼.
- 조건별 warmup 1회+3회, 120 rAF-paced wheel 왕복, 순서 교차. 50개 초기 측정의 편차 때문에 새 탭에서 별도 1+3회 재확인했다. 초기 표본을 제외하거나 대체하지 않았다.

| 조건 | 이전 경로 p95 | 제품 적용 p95 | >25ms 이전→적용 / 360프레임 |
|---|---:|---:|---:|
| 50개 최초 | 40.1ms | 20.1ms | 267→5 |
| 50개 새 탭 재확인 | 30.0ms | 10.1ms | 39→0 |
| 100개 | 40.0ms | 10.1ms | 137→0 |

p95는 각 본 측정 3회의 지표 중앙값이다. 50개 최초/재확인의 React median도 이전 경로 1.8→1.2ms, 적용 경로 1.8→1.0ms로 달랐다. 탭/실행 시점 편차가 관찰되지만 그 원인을 확정하지 않는다. 새 표본만 제시하여 항상 10.1ms라고 주장하지 않는다.

24개 원시 표본 모두 dirty=false, 문서 불변, 120프레임, 동일 surface, 중간 X -240px 이동과 시작 위치 복귀를 확인했다. 이동 중 행/인라인 셀/장면/타입/관계 재계산은 0회였다.

## 제품 경로 UI 확인

- 같은 문서·카메라의 전후 캔버스 `(0,242,1265,620)`에서 **784,300픽셀 차이 0**.
- 첫 카드 위치와 치수 `(25,267,480,494)` 및 PNG SVG 지문 `c253e01a`가 동일했다.
- 카드 DOM 100개를 유지하고 실제 내부 콘텐츠 표시가 100→15개로 감소했다. computed contentVisibility는 visible→auto로 바뀌었다.
- 제품 규칙이 적용된 상태에서 Native 인라인 이름을 수정하고 메모리 ACK를 확인했다. 선택된 카드는 contentVisibility:visible, 위치/치수 유지, 오류 0개였다.
- 더 넓은 후보 검증(실패 복구/취소/포커스/타입 팝오버/이동/resize/관계 경로/PNG 인코딩/원본 모션)은 [이전 검증](2026-10-06-Performance-ContentVisibilityValidation.md)을 참조한다. 이번 제품 이식은 같은 규칙에 지원 여부 feature query를 강화한 것이다.

## 한계와 상태

synthetic pan과 메모리 저장 예제의 결과이며 실제 협업/API 지연을 포함하지 않는다. 이전 검증에서 미확인인 실제 IME·다른 브라우저·reduced-motion=true·인라인 Tooltip 자동 표시·다운로드 파일 저장 완료를 이번에 확인했다고 주장하지 않는다.

구현과 기록은 codex/performance-lab에 커밋했다. D:/ChatGPT/ERD main과 원격 브랜치에는 반영하지 않았다. 제품 반영 시 제품 커밋/문서만 선별하며 lab 측정 도구와 artifacts는 제외한다.

원시 JSON·UI 상태·스크린샷·집계·pixel 비교: `artifacts/performance/2026-10-06-table-visibility-product/` (Git 제외).
계획: [TableVisibilityImplementation](../planning/2026-10-06-Performance-TableVisibilityImplementation.md).
