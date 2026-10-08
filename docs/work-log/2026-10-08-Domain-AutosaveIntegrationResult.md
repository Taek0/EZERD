# 도메인 자동저장 통합 결과

- 두 도메인 편집기의 폼 key에서 version, sequence, databaseRevision을 제거했다. ACK마다 입력 폼을 다시 마운트하지 않으며 DB 컨텍스트 변경은 공용 폼의 보관·경고 처리로 전달한다.
- 생성 ID와 기존 복구 draft key를 유지한다. 생성된 객체가 문서에 확인되면 같은 폼에서 patch_domain 또는 patch_domain_relation으로 전환한다.
- 생성 ACK가 문서보다 먼저 도착하거나 저장 중 선택을 이탈해도 재생성하지 않는다. 최신 입력은 초안으로 보관한다.
- 이미 생성된 객체에 해당하는 복구 초안은 재생성하지 않고 명시적인 추가 입력 후 수정 명령으로 저장한다.
- 도메인 생성이 수정으로 전환된 뒤 생성 배치 좌표 입력은 숨긴다.
- 전용 통합 테스트 10건: 두 편집기의 폼 identity, 추가 입력 보존, 생성→수정 전환, 거절 후 같은 ID 재시도, ACK 중 이탈, 기존 객체 복구를 검증했다.
- 기존 NativeDomainEditor.test.ts에서 수동 submit 버튼을 전제한 검증을 자동저장 UI에 맞춰 갱신했다.
- 최종 관련 회귀 6개 파일 60건 통과. 담당 네 코드·테스트 파일만 Prettier 적용.
- 웹 TypeScript 검사에서 담당 파일 오류는 없었으나 다른 워커의 native-clipboard-interaction.test.ts:35 및 native-continuous-editing.test.ts:58의 optional deps 타입 오류 2건으로 전체 검사는 실패했다. 해당 파일은 수정하지 않았다.
- 공용 native-editor-form 및 다른 워커 담당 파일은 수정하지 않았다.

## 브라우저 QA 인계

- 임시 서버 http://127.0.0.1:5174 에서 UI를 통해 QA 사용자·워크스페이스·프로젝트·테이블·도메인을 생성했다.
- 워크스페이스: Domain dropdown QA / 프로젝트: Domain Select QA / 테이블: domain_qa_table / 도메인: 새 도메인.
- 소속 도메인 Select의 미소속·새 도메인 옵션을 확인하고 새 도메인을 선택했다. 직후 저장 확인 중 상태까지 확인했으며 ACK 완료 및 새로고침 검증은 후속 QA 담당자에게 인계했다.
- IAB browser 3, tab 1을 후속 작업용으로 유지하고 CUA 조작을 중단했다.

계획: [도메인 자동저장 통합 계획](../planning/2026-10-08-Domain-AutosaveIntegrationPlan.md)
