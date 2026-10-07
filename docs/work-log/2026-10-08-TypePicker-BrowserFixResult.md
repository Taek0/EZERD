# 타입 검색·팝업 클릭 브라우저 수정 결과

- [계획](../planning/2026-10-08-TypePicker-BrowserFixPlan.md)에 따라 astra/low 워커가 구현과 실제 Chrome 검증을 수행했다.
- 입력 포커스가 복귀할 때마다 전체 선택하던 처리 때문에 첫 입력을 덮어쓸 수 있었다. 최초 포커스에서만 선택하고 사용자 입력 이후에는 재선택하지 않는다.
- React portal의 옵션 클릭이 캔버스의 pointer capture 처리에도 전달되었다. 캔버스 DOM 밖에서 시작한 이벤트를 제외하여 드래그·영역 선택이 옵션 클릭을 가로채지 않게 했다.
- SearchType의 초기 선택·재포커스 회귀와 캔버스 portal 경계 회귀를 추가했다. 일반 캔버스 선택·팬 동작은 기존 검증을 유지한다.
- 누락된 삭제 확인·컬럼 추가 옵션 번역을 등록하고 사용하지 않는 저장 요청 번역을 제거했다.

## 실제 Chrome 결과

| 항목 | 결과 |
| --- | --- |
| 첫 진입 후 var 연속 입력 | PASS |
| 마우스로 VARCHAR 선택 | PASS |
| 새로고침 후 VARCHAR 유지 | PASS |
| 소속 도메인 변경 및 새로고침 후 유지 | PASS |
| 고급 편집의 항목·식 선택 계층 표시 | PASS |

- 수정 전 실패는 [중간 QA 기록](2026-10-08-Editor-BrowserQAResult.md)에 보존했다. 후속 워커가 위 모든 항목의 PASS를 보고한 뒤 소스 변경을 종료했다.
- 최종 오너 검증: pnpm check 통과, 212개 테스트 파일/2,676개 테스트 통과, 타입 검사·빌드 통과. 격리 DB 26개 스위트/497개 통과 기록은 [통합 결과](2026-10-08-Editor-ImmediateEditingResult.md)를 참조한다.

## 증거

- [var 검색어 유지](assets/2026-10-08-TypePicker/query-var.png)
- [고급 식 계층](assets/2026-10-08-TypePicker/expression-hierarchy.png)
- [새로고침 후 타입·도메인 유지](assets/2026-10-08-TypePicker/reload-domain-expression.png)
