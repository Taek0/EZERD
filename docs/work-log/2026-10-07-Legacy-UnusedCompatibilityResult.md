# 미사용 호환 reader·함수 정리 완료

- [계획](../planning/2026-10-07-Legacy-UnusedCompatibilityPlan.md)에 따라 운영 참조가 없는 선언 6개를 제거했다: tableClipboardReadSchema, parseTableClipboardRead, translateSelectedNodes, isEffectiveChange, canApplyInverse, retainPendingOperations.
- v1 clipboard reader에만 필요한 rawStoredDesignDocumentSchema import와 이전 이동 함수에만 필요한 모델 import도 제거했다. 앱·패키지·스크립트에서 제거 이름의 잔여 참조가 없음을 확인했다.
- Native clipboard의 깨진 참조·private payload 거부는 현재 nativeTableClipboardSchema를 직접 검사한다. v1 clipboard 거부와 원문 불변 검증도 유지했다. 잘못된 JSON/UTF-8 크기 검증은 현재 readNativeClipboard 테스트가 계속 수행한다.
- undo 충돌 검증은 Native 이력에서 실제 사용하는 findInverseConflicts로 옮겼다. 속성의 부재와 null 구분은 diffSharedDocument/applyChanges로 검사하고 overlay 순서·원본 불변 검증을 유지했다.
- 이전 v1 그룹 이동 테스트만 제거했다. Native 그룹 이동·경계 clamp·개인 배치 및 durable queue의 ACK 검증은 그대로 유지했다.
- 코드·테스트 6개 파일에서 38줄 추가/115줄 삭제로 77줄 순감소다. 기록 문서 증가는 제외했다.

## 검증

- 집중 검증 87개 테스트 통과.
- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 최종 전체 테스트: 203개 파일/2,583개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 웹 빌드: JS 1,753.57kB(gzip 497.31kB), CSS 130.32kB(gzip 25.50kB), 1,631모듈. 기존 청크 크기 경고는 남는다.
- DB 통합 테스트·브라우저 수동 QA는 이번 미사용 선언 제거에서 추가 실행하지 않았다. 서버·DB·docs/EZERD.txt를 변경하거나 재시작·배포하지 않았다.

## 전체 진행률 추정

- 이번 작업까지 **레포의 v1 운영 의존성 정리는 약 85%**로 본다. 초기부터 고정된 전체 작업량이 있었던 것은 아니므로, 코드 줄 수나 v1 문자열 수로 계산한 수치가 아닌 현재 합의한 작업 단계에 대한 대략적인 추정이다.
- 완료한 큰 묶음: v1 편집 UI/클라이언트 동기화·전용 QA 제거, v1 REST/MCP 폐기, 가져오기의 Native 통합, 미사용 선언/clipboard 정리, 공통 문서 기반 분리, 공통 동기화 계약 분리.
- 남은 주요 묶음: 실제 v1/v2 저장값을 반영하는 DB 문서 TypeScript 타입 정리, 잔여 QA·fixture·호환 참조의 최종 분류와 필요한 추가 제거, 최종 회귀 점검.
- 파일 변환·원문 증거·과거 이력 읽기는 유지해야 하는 호환 기능이므로 남았다는 이유만으로 미완료로 계산하지 않는다. 실제 배포/서버 재시작은 이 코드 정리 완료율과 별도다.
