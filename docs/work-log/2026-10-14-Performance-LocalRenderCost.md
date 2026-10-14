# 로컬 편집 중 PK 미리보기 검증 재사용

## 확인된 병목과 수정

43테이블·436컬럼 실제 원본의 격리 복제본에서 비용을 분해했다. 이름/NULL 변경 중 NativeFormatEditor의 포함 비용이 컸지만, 자식 NativePrimaryKeyControl의 nativePrimaryKeyPlan이 같은 확인 문서에 대해 반복 실행되는 것이 주된 병목이었다. 이 함수는 기존 문서와 PK 변경 후보를 모두 검사한다.

- PK 진단 실행: 이름 단계 3회/약 113ms, NULL 단계 4회/약 133ms.
- 최종 변경: NativePrimaryKeyControl의 표시용 preview만 `useMemo`로 재사용한다. 의존성은 document, column.id, checked, newId다.
- 확인 문서 또는 대상이 바뀌면 다시 계산한다. 클릭 핸들러는 항상 최신 props로 계획을 다시 만들고 최신 snapshot의 expected 값을 사용한다. 권한/busy 차단도 유지한다.
- 접힌 옵션 UI를 분리하는 실험은 최종 변경에 포함하지 않았다. 실제 병목으로 확인된 PK preview에 범위를 좁혔으며 화면 구성·애니메이션·자동저장 타이머는 유지한다.

## 실측

동일 실제 데이터와 profiling 설정으로 원본 1회, 최종 후보 3회를 측정했다. 아래는 DOM polling 기준이며 paint/INP 보장이 아니다. 기준 실행의 변동성 때문에 백분율 개선을 일반화하지 않는다.

| 단계 | 원본 관찰 ms | 후보 3회 ms | 후보 중앙값 ms |
| --- | ---: | --- | ---: |
| 이름 | 253.6 | 188.5 / 150.4 / 185.7 | 185.7 |
| NULL | 181.6 | 131.2 / 132.9 / 105.1 | 131.2 |
| 삭제 | 89.7 | 103.7 / 132.1 / 102.9 | 103.7 |

삭제 지연 개선은 확인하지 못했다. 이름과 NULL의 로컬 표시 중 PK plan은 최종 후보에서 0회였고, 해당 컨트롤 React 비용은 0~0.2ms였다. 초기 선택/ACK로 확인 문서가 변경된 경우의 재검사는 남아 있다. 모든 후보 실행에서 지연 ACK 이전 표시, 최신 입력 유지, 추가 중복 없음, 삭제 유지, 최종 큐 비움이 통과했다.

## 검증 범위

- 회귀 테스트는 동일 문서에서 로컬 이름/콜백/sequence 변경 시 preview 재사용, 새로운 문서에서 재계산, 실제 클릭에서 재검증과 최신 onSave/sequence 사용, busy 차단을 확인한다.
- 기존 PK/FK·DB별 제약 규칙 자체는 변경하지 않았다.
- 원본/진단/후보 원시 기록: lab `artifacts/performance/2026-10-14-local-render/{before,before-pk,after-1,after-2,after-3}.json`. before-pk는 병목 분해용 중간 실험으로 최종 성능 비교 기준은 before.json이다.
- 실제 사용자 문서는 수정하지 않았다. 계측 탭과 서버는 종료했다.

lab 전체 검사: 2,937 passed / 499 skipped, format/type/build 통과.
