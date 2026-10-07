# 고급식 및 상세설계 UI 계획

- 항목 종류 → 대상 → 핵심 설정 → 선택 고급 옵션 순서로 고급 편집을 재배치한다.
- 단순 컬럼/값은 직접 편집하고 복합 식의 하위 트리와 묶기 도구는 필요할 때 펼친다.
- 원문, 정책 판단, 자동저장 및 복구 식별자는 유지한다.
- NativeDesignDetails를 읽기 전용 컴포넌트로 분리하고 document/table/mode 및 논리 provider API를 MAINworker Boyle에게 전달한다. NativeProjectView 연결은 Boyle 담당이다.
- 지정 컴포넌트와 전용 CSS/테스트만 수정한다. property/canvas/enum 및 NativeProjectView는 수정하지 않는다.
- 관련 회귀 테스트와 타입 검사, 변경 파일만 포맷 확인한다. Git add/commit과 전체 포맷은 실행하지 않는다.
