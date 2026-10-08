# 도메인 자동저장 통합 계획

- NativeDomainEditor와 NativeDomainRelationEditor의 폼 identity에서 ACK 버전·시퀀스를 제외해 입력과 포커스를 유지한다.
- 생성 폼은 안정적인 생성 ID와 복구 draft key를 유지하면서 생성된 객체가 확인되면 수정 명령으로 전환한다.
- ACK 후 문서 반영 전의 중복 생성도 차단한다.
- 생성 중 추가 입력, 복구 초안, 실패와 재시도, 반복 ACK를 전용 테스트로 검증한다.
- 공용 native-editor-form 및 다른 워커 파일은 수정하지 않는다.
