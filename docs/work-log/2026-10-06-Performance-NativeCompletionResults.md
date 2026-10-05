# Native 캔버스 잔여 작업 최종 성능 결과

2026-10-06. [잔여 계획](../planning/2026-10-05-Performance-NativeCompletion.md), [보조 UI 계획](../planning/2026-10-06-Performance-NativeAuxiliaryReuse.md).

## 병목과 보완

카드/관계선 memo 이후에도 PNG 버튼의 sharedDocument fingerprint와 클립보드 source 검사 등 보조 UI가 pan마다 갱신됐다. 50테이블 p95 약20ms, 100테이블40~50ms를 확인하고 이 보조 UI도 기본 React.memo/안정된 context로 분리했다. 시각 요소를 없애거나 콜백 비교를 생략하지 않았다.

## 최종 비교

clean 67d85a8 profiling 빌드, viewport1440×900/DPR1/surface1440×520, 테이블당10컬럼. 각 조건 준비1+본측정3회, rAF paced wheel120회 왕복, 두 번째 반복 역순. 함수 계측 포함. 시간은 각 실행 중앙값/p95의 3회 중앙값이다.

| 테이블 | 조건 | React 중앙값(ms) | frame p95(ms) | 25ms 초과 / 360 | scene DOM |
| --- | --- | --- | --- | --- | --- |
| 50 | Native 조회 | 0.4 | 10.1 | 0 | 5,818 |
| 50 | Native 편집 버튼 표시 | 0.4 | 10.1 | 0 | 6,318 |
| 50 | 기존 simple-cards | 1.9 | 10.1 | 0 | 902 |
| 100 | Native 조회 | 0.4 | 10.1 | 1 | 11,618 |
| 100 | Native 편집 버튼 표시 | 0.4 | 10.1 | 0 | 12,618 |
| 100 | 기존 simple-cards | 2.6 | 10.1 | 0 | 1,802 |

Native 조회/편집 표현 모두 본측정의 개별 p95도 약10.1ms였고 장면/관계선/타입 표시 호출0회를 유지했다. 보조 UI 분리 전 같은 fixture의 p9520~50ms와 달리 이번 측정에서는 유휴 rAF 주기(약10ms)에 근접했다. 100테이블 조회 조건의 한 frame25ms초과까지 숨기지 않고 기록했다. 이 범위에서는 화면 밖 요소를 제거하지 않고 목표에 도달해 가상화를 추가하지 않았다.

## 범위와 한계

editable-presentation은 실제 버튼 DOM을 표시하되 userId와 실제 API 없이 측정하는 조건이다. 저장/협업 비용이나 편집 중 모든 interaction의 frame 보장은 아니다. 실제 폼/route 상호작용은 메모리 어댑터에서 이름/타입/NULL/권한/충돌/실패·초안 보존/drag/키보드/PNG 다운로드를 별도 확인했다. 실제 HTTP/DB/NativeHistory browser E2E로 계산하지 않는다. 497개 조건부 DB 검사는 전체 단위검사에서 skip된다.

모든 raw24개에서 clean metadata, 문서 불변, camera 왕복, surface1440×520,120frame, 유효 React 표본을 확인했다. 임시 새 탭이1280×720으로 열린 초기1표본은 조건 불일치로 제외하고 파일/집계에 넣지 않았다. 이전 결과는 artifacts/performance/2026-10-05-native-completion, 최종 raw/summary/화면은 artifacts/performance/2026-10-06-native-completion-final에 보존한다.

제품 전용 PR checkout에서 도구 없이 전체 검사를 수행하고 결과를 별도 제품 문서에 기록한다. 일반 production FPS나 다른 기기/300테이블 이상의 성능을 보증하지 않는다.
