# Native 렌더 분리 후 프레임 비교 결과

2026-10-04. [계획](../planning/2026-10-04-Performance-NativeFrameComparison.md)에 따라 제품 코드 455d6d6과 계획 기록이 포함된 clean edacd3f 빌드에서 측정했다.

## 방법

동일 50테이블·500컬럼·50관계 fixture, viewport1440×900/DPR1, surface1440×520, 초기 translate(24,24)/scale1. Native는 같은 v1 fixture를 메모리에서 v2로 변환했다. 실제 UI/카드 크기와 주변 보조 UI는 구현별 차이가 있다. production React profiling+함수 span 계측 빌드이며 API·DB·저장은 사용하지 않는다.

폰트/진입 애니메이션 종료 뒤 8회 warm-up, 유휴20프레임, rAF당 wheel1개로 +4px60회/-4px60회를 재생한다. 조건별 준비1회와 본측정3회, 두 번째 반복은 역순이다. 표의 시간은 각 실행 중앙값/p95의 3회 중앙값이고 25ms 초과는 본측정360프레임 합계다. 유휴 rAF 중앙값은 모든 조건 약10ms로 관측됐다.

## 결과

| 조건 | React 중앙값 / p95(ms) | 프레임 중앙값 / p95(ms) | 25ms 초과 / 360 | scene DOM 요소 |
| --- | --- | --- | --- | --- |
| 기존 baseline | 11.5 / 15.3 | 30 / 40 | 319 | 8,102 |
| 개선된 Native baseline | 5.5 / 6.0 | 10 / 10.1 | 0 | 3,504 |
| 기존 memo-leaves | 1.2 / 1.4 | 10 / 20 | 1 | 8,102 |
| 기존 simple-cards | 1.3 / 1.6 | 10 / 10.1 | 0 | 902 |

Native는 본측정3회 모두 frame p95 약10.1ms였으며 scene/geometry/nativeColumnTypeDisplay 호출은 준비 실행까지 4회 모두 0회였다. 같은 환경의 simple-cards와 프레임 간격 수준이 같았다. 기존 memo-leaves의 p95 약20ms 차이도 재현됐다.

## 해석과 제한

- Native에 적용한 장면 재사용과 카드·관계선 렌더 경계가 연속 카메라 입력에서도 유지됐다. 이번 fixture에서는 simple-cards 수준의 프레임 간격에 도달했다.
- 기존 v1 UI 전체를 Native로 이식한 결과는 아니다. Native DOM3,504개와 기존8,102개의 차이가 남으며 완전한 기능/시각 동등성을 보증하지 않는다.
- Native React 전체 Profiler에는 부모·툴바·보조 컴포넌트가 포함된다. 5.5ms를 카드 재렌더 비용으로 해석하면 안 된다. 카드 타입 표시 함수는0회이며 부모 갱신은 남는다.
- Native의 React 시간은 memo-leaves보다 길지만 frame p95는 짧다. React actualDuration만으로 frame 시간을 설명할 수 없고 DOM commit, layout/paint/composite, rAF 예약 차이를 분리 측정하지 않았다.
- 본측정에서는 longtask/Long Animation Frame 관측 항목이 없었다. 기존 baseline rAF 간격50ms 초과가3개였어도 이를50ms JS 작업3개로 해석할 수 없다.
- synthetic paced wheel/profiling 빌드이며 일반 production FPS, 실제 마우스 입력 지연, 다른 기기·배율·대규모 문서의 보장이 아니다. 10ms는 현재 관측된 유휴 주기 수준이며 더 빠른 처리량의 한계는 이 실험으로 알 수 없다.
- 10월2일 결과 이후 원격 main의 Native UI 기능이 확장되었으므로 옛 수치와 개선율을 직접 계산하지 않았다. 같은 최신 빌드의 네 조건만 비교했다.

## 다음 단계

이번 조건에서 Native의 frame 목표는 충족했다. 기존 카드/관계선 UI를 표현 단위로 이식하며 현재 렌더 경계를 유지하고, 단계별 같은 측정을 반복하는 것이 우선이다. 화면 밖 요소 제외는 큰 문서에서 회귀가 확인되거나 풍부한 UI를 복원한 후 필요성이 확인될 때 별도 실험한다. 기존 v1 memo-leaves 자체의 브라우저 비용 문제를 이번 Native 변경이 해결했다고 주장하지 않는다.

## 검증·보존

16개 원시 파일(준비4+본측정12), summary.json 및 화면 증거를 artifacts/performance/2026-10-04-native-frame-comparison에 보존했다(Git 제외). 모든 실행은 dirty=false, 문서 불변, 카메라 중간 변화와 최종 원복, surface1440×520, frame120개, 유효 React 표본을 확인했다. perf:build의 공유 빌드·웹 타입·profiling 빌드가 통과했다. 이번 작업은 제품 코드 변경이 없어 기존 단위 테스트를 재실행하지 않았다. 측정 중 별도 빌드/테스트는 실행하지 않았다. main·DB·원격은 변경하지 않았다.
