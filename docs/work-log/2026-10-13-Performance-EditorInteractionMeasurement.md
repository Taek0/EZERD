# 편집기 버튼 응답 지연 직접 계측 결과

## 기준과 방법

- 실제 Chrome localhost:3001의 klassboard-backend 화면: 테이블 41개, DOM 요소 11,565개. script 파일 index-SisAyOsU.js가 로컬 main의 dist/index.html과 일치했다. main 기준 1fa6b08.
- 사용자 문서에서는 메뉴 조회만 수행했다. 저장·삭제 요청은 보내지 않았다.
- main 고유 제품 커밋을 lab에 반영하고 별도 Chrome의 127.0.0.1:4180 합성 문서(50개 테이블, 각 10개 컬럼)로 비교했다. 서버 API 쓰기는 차단했다.
- 프로파일링 빌드, 동일 하위 profiler 구성, 각 동작 warmup 1회 + 측정 3회. 숫자는 동작 후 450ms 관찰 구간의 React actualDuration 합계 중앙값이다. 하위 profiler는 포함 관계가 있어 합산하지 않는다.

## 측정 결과 (ms)

| 동작 | 현재 제품 경로 | 행 shallow memo만 | 행 memo + 접힌 탐색 컬럼 미마운트 |
| --- | ---: | ---: | ---: |
| 핀 열기 | 45.0 | 48.6 | 13.7 |
| 컬럼 펼치기 | 112.9 | 54.4 | 24.1 |
| 속성 패널 닫기 | 31.1 | 36.1 | 13.4 |

- 모든 측정에서 목표 UI 상태 및 문서 fingerprint 불변을 확인했다.
- 컬럼 하나를 펼쳐도 현재 제품 경로는 NativeCanvasTableRows 50회, EditableNativeCanvasInlineCell 1,550회 실행됐다. 기본 shallow memo만 적용하면 각각 1회/80회가 됐다. 콜백을 무시하는 비교 함수는 사용하지 않았다. 남은 셀 실행에는 테이블 제목 등이 포함된다.
- 접힌 탐색 목록도 NativeNavigatorTable의 shown.map으로 모든 컬럼 Button을 마운트한다. 해당 subtree의 반복 렌더가 조건별 약 21~37ms였고, 닫힌 컬럼 목록을 실험적으로 생략하자 약 4~5ms로 감소했다.
- NativeProjectView 함수 본문과 표시 데이터 계산은 첫 계측에서 약 0.5~0.9ms였다. 이 조건에서는 상위 계산보다 하위 UI 렌더 비용이 컸다.
- **이전 설명 정정:** selectedColumnId를 소유 테이블에만 전달하면 다른 카드의 memo가 생략한다고 설명했으나, 현재 제품 NativeCanvasTableRows는 memo 없는 일반 함수였다. props 범위 축소만으로 렌더를 막지는 못했다. 실제 컴포넌트 경계 측정이 누락됐던 점을 바로잡는다.

## 저장 반영 경로

- 메모리 Storage로 격리한 빈 큐의 enqueueNativeSave(단일 테이블 이름 patch) 29회 측정은 p95 약 0.1ms였다. 실제 localStorage 영속화 비용, 누적 큐, 네트워크, 서버 검증, ACK 문서 적용은 포함하지 않는다.
- use-native-autosave.ts에는 quiet window 750ms, max wait 2000ms가 있다. 일반 입력 후 자동 저장에 의도된 대기가 포함되며 명시적 제출/선택 변경 flush는 다른 경로다.
- 실제 문서에 변경 요청을 보내지 않았으므로 서버/ACK 지연의 수치나 주원인 여부는 미확정이다. 저장 지연 전부를 React 탓으로 단정하지 않는다.

## 한계 및 후속 구현

- rAF callback이 450ms 안에 두 번 도착하지 않는 사례가 반복됐다. 따라서 위 숫자는 React 작업량 비교이며 FPS, INP, 실제 픽셀 표시 완료 시간, 사용자의 41개 테이블 문서 전체 지연 수치가 아니다.
- 실험 plugin은 원인 분리를 위한 것으로 main에 적용하지 않았다. 특히 닫힌 목록을 즉시 생략하는 실험은 기존 닫힘 애니메이션 유지 구현이 아니다.
- 제품 구현 순서: (1) 콜백까지 비교하는 안전한 행 memo 및 실제 렌더 횟수 회귀 (2) 탐색 목록의 닫힘 애니메이션 완료 후 unmount, 검색/포커스/접근성 보존 (3) 실제 저장 경로 단계별 계측과 ACK 반영 개선.
- lab 타입 검사와 각 실험 production profiling 빌드는 성공했다. 제품 동작 변경이 없으므로 전체 제품 테스트는 재실행하지 않았다.
- raw: artifacts/performance/2026-10-13-button-audit/{baseline-50,memo-50,memo-navigator-50,summary}.json (Git 제외). 초기 current-50.json은 탐색 profiler 추가 전 자료이므로 최종 표에는 사용하지 않았다.

[계획](../planning/2026-10-13-Performance-EditorInteractionMeasurement.md)
