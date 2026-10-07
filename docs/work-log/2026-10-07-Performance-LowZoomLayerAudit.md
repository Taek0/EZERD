# 저배율 레이어·캡처 감사 및 숨은 스크롤 수정

## 검토 의견 반영 및 기존 결론 정정

첨부 답변은 로컬 증거가 아닌 가설 목록이며, 히트 테스트만으로 덮개나 캡처 문제를 배제할 수 없다는 지적이 맞다. 조사 순서를 캡처 보정 → 조상/형제/가상 요소 → 실제 치수·이동량 비교로 바꿨다.

IAB screenshot에 clip (2226,150,320,500)을 요청한 결과와 clip (0,0,320,500)을 요청한 결과가 33,482바이트로 완전히 동일했다. 둘 다 좌상단을 반환했다. 또한 DOM viewport는 2546×1283/DPR1인데 전체 JPEG 헤더는 2382×1283이었다. 따라서 기존 '패널 위치에 캔버스 배경이 그려짐' 관찰은 해당 위치를 캡처한 증거가 아니며 철회한다. 사용자 Chrome 제보 자체를 부정하는 것은 아니다. 이전 비교 후보의 부정적 결과도 제품 원인 배제에 사용하지 않는다.

lab의 결과 textarea 때문에 body scroll이 발생하는 교란 요인도 확인해 진단 화면을 고정 viewport로 구성했다. 이번 전후 모두 documentSize=viewport=2546×1283, scrollX/Y=0이다. 현재 도구 목록에는 실제 Chrome 연결이 없어 OS/실제 Chrome 픽셀 교차 검증은 미완료다.

## 레이어·상태 감사

- 조상·형제 요소의 rect, overflow, contain, content-visibility, transform, opacity, visibility, z-index, pointer-events, 배경 및 ::before/::after를 같은 DOM 감사 기록에 수집했다.
- 관측한 world 조상 경로의 생성된 가상 요소는 없었다. 패널과 겹치는 큰 pointer-events:none 요소는 도구가 주입한 codex-browser-sidebar-comments-root였고 배경은 투명했다. 제품의 불투명한 덮개가 원인이라는 증거는 찾지 못했다. 모든 가능한 덮개를 배제했다고 주장하지 않는다.
- 50개 카드의 inline/computed style과 헤더 포함 11행, 본문/첫 행의 크기가 유지됐다. world 아래 SVG path 1,106개(icon/marker 등 포함)의 d 속성도 동일했다. 패널의 전체 감사 기록은 전후 동일했다.
- scene/singleDrawn/drawn 메모 의존성에 camera가 없으며, NativeCanvasWorkspace에 카메라 기반 IntersectionObserver나 카드 크기 재측정 observer는 없다. parent ResizeObserver는 workspace를 관측한다. 실제 observer 호출 횟수를 측정한 것은 아니다.
- limit은 ±1e7, zoomLimit은 0.1~4이며 이번 카메라는 범위 내 정상 유한 값이다. wheel은 활성 pan 중 반환한다. 별도의 view/user/DB context 변경 effect는 카메라를 초기화하므로 임의 동시 갱신 가능성을 일반적으로 배제하지는 않는다.

## 확인한 제품 문제

초기 상태에서 zoom 버튼으로 11.2157%까지 축소하면 surface는 overflow:hidden 상태지만 scrollTop=138이 됐다(scrollHeight=1219, clientHeight=1081). 이후 패닝으로 장면의 세로 overflow가 줄면 scrollTop=0으로 바뀌었다. 카메라 외에 native scroll offset이 좌표 변환에 중첩됐다.

| 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 카메라 y 전→후 | 483.459 → 183.459 | 동일 |
| 첫 카드 화면 y 전→후 | 496.459 → 334.459 | 634.459 → 334.459 |
| 실제 카드 이동 y | -162px | -300px |
| surface scrollTop 전→후 | 138 → 0 | 0 → 0 |
| 카메라 이동과 실제 이동의 최대 오차 | 약 138px | 약 0.000061px |

카메라 기반 viewport에 native scrolling이 끼어들지 않도록 `.native-editor-workspace .native-erd-surface`만 `overflow: clip`으로 변경했다. 카드 내부 및 inspector body의 스크롤은 변경하지 않았다. 패닝 delta를 zoom으로 나누거나 카메라 계산을 변경하지 않았다. scrollTop 발생의 세부 트리거가 focus/scroll anchoring 중 무엇인지는 추가 분리가 필요하지만 native scroll offset 중첩 자체와 제거 효과는 검증했다.

## 검증과 범위

- 같은 50카드에서 모든 카드의 이동 delta (-450,-300px) 일치, 최대 오차 <0.001px. 카드 치수·행 수·SVG path 및 panel 상태 유지.
- 10%/12% 배율 전환에서도 scrollTop=0. 12% 커서 영역 선택으로 25개 카드 선택, release 후 사각형 숨김 확인.
- pnpm format / pnpm check 통과: 232개 파일 / 2,818개 테스트, 27개 파일 / 506개 환경 조건부 skip. 타입·제품 빌드 및 성능 빌드 통과. 기존 bundle 크기 경고 유지.
- 캡처 API가 검증되지 않았으므로 사용자 제보의 모든 시각적 깨짐이 해결됐다고 주장하지 않는다. 해결한 범위는 재현된 native scroll에 의한 좌표 점프다.
- 실제 localhost:3001·기본 main·사용자 문서는 변경하지 않았다. 수정은 성능 lab에만 보존한다.

원시 DOM JSON 전후 4개, comparison/fixed-comparison 및 capture-calibration은 `artifacts/performance/2026-10-07-lowzoom-layer-audit/`에 보존한다(Git 제외). capture-calibration은 REPL에서 비교한 이미지 크기/바이트 동일성 기록이며 JPEG 원본 파일 자체는 포함하지 않는다.

[계획](../planning/2026-10-07-Performance-LowZoomLayerAudit.md) · [정정 대상 기존 조사](2026-10-07-Performance-DragVisualRegression.md)

## 제품 PR 브랜치 독립 검증

원격 main b617496을 반영한 codex/canvas-native-scroll-fix에서 제품 변경은 native surface의 overflow:clip과 주석으로 제한했다. main의 88px 버튼 크기·카메라 유지·백그라운드 동기화·측정 재사용 변경을 보존했다. pnpm format / pnpm check 통과: 230개 파일·2,826개 테스트, 27개 파일·506개 환경 조건부 skip, 타입·서버/웹 빌드 통과. 기존 bundle 경고 유지. 이 독립 검사는 lab 브라우저 계측을 최신 main에서 반복했다는 의미는 아니다.
