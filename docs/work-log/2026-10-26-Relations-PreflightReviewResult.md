# 관계 경로 사전 검증·무변경 저장 검토

기준: main 42a6cb5 포함 performance-lab. 코드와 기존 테스트 내용을 읽었으며 테스트 실행·제품 코드 변경은 하지 않았다.

1. 재생성 안전성은 이미 서버에 적용됐다. shared/native-sync-candidate.ts canRegenerateRoute는 제출 후보가 아닌 current의 관계·양 끝 테이블을 확인하고, __tables__ 뷰 및 경로 key를 검증하며 upsertRelationLayout로 현재 배치 존재를 검사한다. entity/node의 retired identity 거부는 유지한다. native-sync-candidate.test.ts에 관계/테이블/배치 누락, 삭제 엔티티 재사용, 최신 관계 변경 충돌 검사가 있다. 새 구현보다 경계 회귀 검사 유지가 우선이다.
2. 계산 시작은 eligible, overview 제외를 확인하고 결과 수신/저장 직전에 구조·크기·scope·기존 경로 변경을 다시 확인한다. UI 상위 메뉴는 busy/미저장 배치를 차단하지만 eligible 자체에는 recoveryWaiting/placementDraftBlocked/stale/storageError 등이 모두 포함되지는 않는다. 시작 판단과 controller 내부 판단을 공통 preflight로 묶는 것이 보완 후보다. 로컬 scene의 대상 존재/표시 범위/개수/편집 권한을 먼저 확인하고 저장 직전 최신 상태 및 서버 권한/버전 검증은 유지한다. 사전 확인은 동시 변경을 완전히 방지하지 못하며 서버 왕복을 매번 추가할 필요는 없다.
3. nativeRelationArrangeBatch는 sameRoute로 변경 경로만 고른다. persist는 routes가 비면 save를 호출하지 않고 canUndo:false로 끝낸다. 서버 command 입구도 deriveOperationChanges가 비면 sync.no-changes로 거부한다. 다만 sameRoute는 JSON.stringify 비교라 필드 순서나 기본값 표현에 민감하다. 필드별 의미 비교 또는 명시적 정규화를 검토하되 단순 반올림이나 화면상 같은 모양만으로 저장된 연결점 의미를 지우면 안 된다. 충돌 감지용 sameStoredRoute와 무변경 판정은 목적을 구분한다.

표시용 생성 배치와 저장 배치를 혼동하지 않아야 한다. MCP/native command 처리에는 ensureNativeTableCanvasLayout 보정이 있으므로 원본 layout.nodes에 없다는 이유만으로 정상 화면을 일괄 거부하면 이전 저장 보정을 되돌릴 수 있다. 재생성 안전성 판단은 서버 current 기준으로 유지한다.

권장 범위: 서버 identity 검증 유지 → 공통 로컬 preflight와 시작/완료/저장 경계 테스트 → 기존 diff 필터의 의미 비교 강화 및 save 미호출 테스트. 연산량 자체보다 실패하는 계산과 불필요한 저장/히스토리를 줄이는 개선이다.
