# 보수적 content-visibility 후보 검증 결과

## 판정과 적용 범위

검증한 Chrome 시나리오에서 후보의 시각·주요 조작·모션 회귀를 발견하지 않았고 이동 성능 개선을 유지했다. 후보는 **테이블 카드에만 auto**, 선택/preview/focus/active/입력/dirty 카드에는 visible을 유지한다. DOM·원본 컴포넌트·애니메이션·모델 좌표를 제거하지 않는다.

현재 후보는 `apps/web/performance/content-visibility-candidate.css`에만 있으며 제품 source/main/원격에는 적용하지 않았다. 실제 backend 통합과 아래 미검증 범위를 포함한 제품 반영 작업은 별도다.

## 브라우저 회귀 확인

- Chrome 154, UI viewport 요청 1280×900; 실제 캔버스 스크린샷 비교 영역 1265×620. 동일 문서·카메라에서 원본/후보를 같은 페이지의 체크박스로 전환했다.
- 비교 영역 `(0,242,1265,620)`의 **784,300픽셀 중 차이 0**. 첫 카드 480×494의 237,120픽셀도 차이 0이다. 모든 화면/배율에 대한 픽셀 동등성을 뜻하지 않는다.
- 첫 카드 위치/치수는 전후 `(25,267,480,494)`로 같았다. PNG SVG 원문 지문도 `c253e01a`로 같았다.
- DOM 카드 100개를 보존하고 초기 상태에서 표시 중인 내부 콘텐츠는 15개였다. card 자체의 checkVisibility는 box가 남아 100개를 반환하므로 firstElementChild의 contentVisibilityAuto 검사와 구분했다.
- table 90 위치로 이동하여 실제 카드/행 표시를 확인하고 시작 위치로 돌아왔다. 50% 줌에서 첫 카드 240×247, 모델 revision 불변을 확인했다.
- 실제 NativeCanvasInlineCell에서 테이블명 수정→메모리 ACK 성공(revision 1), 컬럼명 저장 실패→입력 보관 안내/원문 유지→재포커스 시 입력 복원→재시도 성공(revision 2)을 확인했다.
- 설명 입력 Escape 취소 후 revision 2 유지, 편집 span으로 포커스 복귀 및 input 제거를 확인했다. Tab 이동이 다음 컬럼 입력으로 연결됐다.
- 실제 SearchType 검색 popup에서 TEXT 항목 표시·Escape 닫기·재열기·선택 저장(revision 3)을 확인했다.
- 크기 핸들 방향키+Enter(revision 4), 카드 방향키+Enter(revision 5), 포인터 드래그 +40/+20(revision 6)를 메모리 저장 경로로 확인했다. 선택 카드는 computed contentVisibility가 visible이었다.
- Editable 해제 시 인라인 편집 셀/input 0개, 모든 resize handle disabled, revision 불변을 확인했다.
- NativeRelationEditor 오버레이에서 간격 12를 저장하고 `upsert_relation_layout` 메모리 ACK를 확인했다. 이 저장은 새로 로드한 별도 초기 예제에서 실행했다.

## PNG 및 모션

- 100개 fixture의 전체 PNG는 기존 export size limit에 걸려, 예제의 첫 10개 카드와 해당 관계로 export 범위를 한정했다. 제품 제한은 바꾸지 않았다.
- 실제 PNG 인코딩 함수가 bounds 3248×1296, scale 2, type image/png로 완료됨을 UI 결과에서 확인했다. PNG 원문 SVG 미리보기도 표시됐다.
- 브라우저 download 이벤트는 15초 내 보고되지 않아 **파일 저장 완료는 확인하지 못했다**. 인코딩/링크 click 경로 완료와 로컬 파일 존재 검증은 구분한다.
- 실제 NativeProjectView 예제에 후보를 적용하고 실행 중 Animation 목록을 수집했다: inspector grid 220ms/opacity 180ms, 컬럼 PanelListDetail WAAPI 180ms, domain-enter 240ms, comments width 220ms/opacity 180ms, domain Popover ui-overlay-in 150ms.
- 기본/후보 모두 인라인 셀 hover에서 DOM role=tooltip이 관측되지 않았다. 타입 검색·도메인 팝오버와 별개로 **인라인 Tooltip 자동 표시는 통과로 판정하지 않는다**. native title/기존 Tooltip 연결은 변경하지 않았다.

## 최종 후보 성능

- clean build `cd21acd`, 제품 기준 main `1ac4d6d`. production React profiling, 1280×720 viewport / 1280×520 surface, 테이블당 10컬럼.
- 조건별 warmup 1회+3회, rAF-paced wheel 120회, 순서 교차. 아래 p95/React는 본 측정 지표의 중앙값이다. 초과 프레임은 360개 합계다.

| 테이블 | 조건 | frame p95 | React median | >25ms | >50ms |
|---|---|---:|---:|---:|---:|
| 50 | 원본 편집 UI | 29.9ms | 1.2ms | 19 | 0 |
| 50 | 보수적 후보 | 10.1ms | 1.0ms | 0 | 0 |
| 100 | 원본 편집 UI | 40.0ms | 1.5ms | 190 | 4 |
| 100 | 보수적 후보 | 10.1ms | 1.3ms | 5 | 1 |

16개 원시 표본 모두 dirty=false, 문서 불변, 120프레임, 동일 surface, 중간 X 이동 -240px 및 시작 위치 복귀를 확인했다. 이동 중 행/인라인 셀/장면/타입/관계 재계산 0회. 전체 workspace의 API/협업 지연 또는 모든 입력 유형의 FPS 보장은 아니다.

## 테스트 및 한계

- NativeCanvasInlineCell/NativeCanvasScene/NativeCanvasTableRows/NativeCanvasInputForm/native-route-edit **5개 파일·79개 테스트 통과**. IME/229/지연 blur는 이 컴포넌트 테스트 범위이며 실제 운영체제 IME 입력은 이번 브라우저에서 실행하지 않았다.
- pnpm format 및 production profiling build(공유 패키지 build/web typecheck 포함) 통과.
- 실제 backend 쓰기 없이 메모리 ACK/실패 주입, 전체 UI에는 synthetic GET만 사용했다. 워크스페이스 실제 댓글·DB·사용자 데이터는 변경하지 않았다.
- reduced-motion=true 및 다른 브라우저는 실제 실행하지 않았다. 후보 CSS는 motion 선언을 변경하지 않으며 기존 공통 reduced-motion 코드를 그대로 둔다.
- 단일 정지 화면의 픽셀 검증을 전체 제품의 완전한 시각 동등성으로 확대하지 않는다. 도메인/메모 카드는 후보 적용 대상에서 제외했다.
- 제품 source(features/components/app/server/packages)는 origin/main과 차이가 없다. 결과는 성능 lab에만 커밋했다.

원시 결과·스크린샷·pixel 비교·PNG 인코딩·모션: `artifacts/performance/2026-10-06-content-visibility-validation/` (Git 제외).
계획: [ContentVisibilityValidation](../planning/2026-10-06-Performance-ContentVisibilityValidation.md).
