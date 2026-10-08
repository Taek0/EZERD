# ENUM 브라우저 QA 수정 계획

- 근거: WorkflowBrowserQAResult QA-01/P1 및 QA-02/P2, 연결된 enum-empty-autocreate.jpg를 view_image로 확인했다.
- 원인: NativeStructureEditor 내부 NativeCreateForm key에 snapshot version/sequence가 포함되어 ACK마다 생성 폼이 초기화된다. Dialog 자체는 snapshot key가 없다.
- 오너 조정: NativeStructureEditor 내부 key 수정은 MAIN이 소유한다. Dialog 연결은 기존대로 보존하고 이 작업에서는 전체 ENUM 폼 ACK 회귀로 통합 검증한다. 기존 생성 폼의 동일 ID add→patch 경로, durable draft와 validation, 빈 문자열 허용을 유지한다.
- CSS: 중첩 fieldset 전체에 적용된 max-height/overflow를 값 목록에만 적용하고 목록 최소 높이와 콘텐츠 기반 grid 행을 확보한다.
- scope: NativeEnumDialog.tsx, native-enum-dialog.css, 관련 ENUM 테스트와 이 계획/결과 문서. 완료된 autosave hook 및 공용 구조 편집기는 수정하지 않는다.
- CUA 조작 금지, 실제 화면 재검증은 QA 담당에게 인계한다. Git add/commit은 오너가 수행한다.
