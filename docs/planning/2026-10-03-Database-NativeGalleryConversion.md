# Native 갤러리 DB 변경 실제 소비 계획

- 범위: App.tsx와 신규 검토 UI/helper/tests. 서버 정책·큐 구현·기존 갤러리 입력 UI는 부모 담당 범위를 유지한다.
- 최신 document-state를 엄격히 읽고 원문 schemaVersion으로 v1/v2 경로를 분리한다. Native는 project/source/native DB 문맥과 version/sequence/revision을 확인한 뒤 서버 preview를 소비한다.
- 검토에는 영향받는 객체 이름과 진단, 검증된 변환 범위만 표시한다. 사용자의 명시 확인 이후 change endpoint에 operationId 및 세 가지 기대 카운터를 보낸다.
- 배우·workspace·현재 편집 권한과 서버의 최신 workspace 권한을 재검사한다. 기존 미확인 큐·미저장 입력은 변경을 막는다.
- 응답 유실에 대비해 원문 snapshot/preview/요청/이름 입력을 공통 durable 큐의 databaseChange 항목으로 보관한다. 부모에 새 kind 허용 연결을 요청했다. 동일 작업 재확인만 허용하고 일반 native cancel과 혼용하지 않는다.
- DB 변경 ACK를 엄격히 검증하고 최신 상태를 다시 읽은 다음 이름만 별도 metadata PATCH한다. Native metadata PATCH에 databaseKind를 넣지 않는다. 이름 저장 실패/응답 유실도 원문 입력을 보존한다.
- 의미 있는 helper 테스트와 실제 App 연결 정적 검사, 변경 파일 포맷과 웹 타입 검증을 수행한다. 부모가 3139 실제 브라우저 empty change와 최종 통합 check를 수행한다. 독립 단위만 선택 커밋한다.
