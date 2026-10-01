# 전체 API/MCP 호환 QA 결과

- 계획: [IntegrationCompatibilityQA](../planning/2026-10-02-Database-IntegrationCompatibilityQA.md). 시작 `fa5b5b7`.
- API의 v1 공유 note/route는 domain 화면이 아니라 canonical `__tables__`에 저장되는 현재 동작을 명시 fixture로 검증한다. 배치 없는 테이블의 deterministic global node도 명시했다. normalize 함수를 expected 생성에 사용하지 않았다. 타입/ENUM/ID/FK/독립 import·재생·좌표·카메라 비공유 검증은 유지했다.
- export metadata는 현재 databaseKind를 포함하는 계약으로 검사한다. MCP 46개 도구를 검사하고 새 capabilities/versioned read 도구를 실제 호출해 DB/profile/revision·v1 원본/native preview 및 read-only annotations를 확인한다.
- 앞 단위에서 추가한 내부 `personalViewIds`가 strict get_project 응답 파싱에 섞여 legacy get_project도 실패할 수 있었다. 공개 snapshot에서 내부 선택 문맥을 제외해 수정했다. private combined route 읽기에는 내부 문맥을 유지한다. 실제 legacy 프로젝트 생성·개인 상태·export/import 뒤 get_project와 내부 필드 비노출을 검증한다.

## 검증

- 전체 `pnpm check`: 포맷·전체 타입·테스트·빌드 통과, **839개 통과/57개 건너뜀**. 기존 큰 Vite 번들 경고가 있다.
- 최종 빌드 뒤 격리 PostgreSQL API 14개 + MCP 5개 + versioned HTTP/MCP 13개 + autosync 8개, **40개 전부 통과**. 로컬 전용 임시 DB를 생성·마이그레이션·테스트·삭제했다. 웹 빌드와 통합 실행을 겹치지 않았다.
- 기존에 기록한 전체 API/MCP 5건과 확대 중 확인한 도구 수 기대값 및 내부 문맥 응답 오류를 해소했다. 이전 결과 문서의 실패 집계는 당시 상태이며 현재 통합 통과의 근거는 이 문서다.

native 개인 상태 명령·읽기, v1 API/MCP 호환 및 replay/역할/사용자 격리 QA에 대한 결과다. native shared 쓰기/ACK, document upgrade/import/history, DB별 물리 편집 UI, native DDL·실제 SQL 실행 및 DB 변환은 아직 남아 있다. 전체 명세 완료나 native 타입 verified/usable 활성화로 계산하지 않는다.
