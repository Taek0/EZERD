# C3/C4 native MCP 개인 캔버스 연결 결과

- 계획: [NativeMcpPersonal](../planning/2026-10-02-Database-NativeMcpPersonal.md). 시작 `5166d59`.
- 공통 CanvasDocument/generic 함수로 메모·viewport·노드·테이블 참조·함께 보기·관계 route 명령을 v1/native 양쪽에서 사용한다. DB별 physical payload를 검사하거나 v1로 투영하지 않는다. native의 긴 생성 node ID는 한도를 지키며 prefix 충돌을 해소한다. 신규 객체 ID 검사는 native index/check도 포함한다.
- 함께 보기는 기존 도메인 배치를 우선 사용하고, 없으면 canonical 공유 테이블 배치에서 개인 참조를 생성한다. 인증된 personal snapshot의 view ID를 MCP 읽기/배치 진단에 전달해 자신의 node/note/route/viewport를 선택한다. 명시 personal 문맥 없는 shared/domain alias 읽기는 기존 canonical 좌표를 유지한다.
- 실제 MCP apply_personal_changes에서 v1 전용 guard를 제거했다. 기존 PersonalStateService의 row lock·expectedVersion·idempotency·권한·사용자 격리·전체 후보/예산·shared diff·native write policy 검증을 그대로 사용하며 개인 행만 저장한다. 모델 공통화와 안내 문구를 현재 동작에 맞췄다.

## 검증

- 최종 전체 `pnpm check`: 포맷·타입·빌드 통과, **839개 통과/57개 건너뜀**. 기존 대형 웹 번들 경고가 있다.
- 최종 빌드 후 격리 PostgreSQL versioned HTTP/MCP/autosync **21개 통과**. 세 DB native source에 실제 SDK MCP 요청으로 함께 보기 생성/patch/삭제, viewport, 테이블 참조 추가/삭제/배치, note 생성/patch/삭제, relation route 생성/삭제를 실행했다. 원본 legacy/type/default/index가 있는 native fixture도 정상 처리했다.
- 동일 작업 재생, 동일 ID 다른 요청 거부, stale 개인 버전 거부, 명령 묶음 실패 시 rollback, index ID 충돌, 비회원 차단 및 viewer의 독립 개인 상태를 확인했다. 공유 문서 fingerprint·project version/sequence/updatedAt를 보존했고 sync baseline/operation은 생성하지 않았다.
- 모델/읽기 단위 테스트는 native payload 보존, v1 ID·도메인 배치 우선과 global fallback, 긴 Unicode ID 충돌, 명시 personal/shared 읽기 선택을 검증한다. 기존 v1/model/personal 회귀도 통과했다.
- 확대 실행한 API/MCP/versioned/autosync 40개에서는 **34개 통과/6개 실패**. API 3개는 기존 domain-note/route 및 누락 global table placement 기대값, MCP 1개는 databaseKind 누락 export metadata 기대값, 1개는 새 조회 도구 이후에도 44개를 요구하는 기대값이다. 기존 개인 route 누락은 수정되어 그 지점을 통과했고, 같은 테스트 뒤쪽 import 후 get_project 응답의 미확인 실패가 드러났다. 다음 독립 QA 단위에서 조사·해소한다. 이 전체 통합을 통과한 것으로 계산하지 않는다.
- 확대 테스트를 웹 빌드와 겹쳐 실행한 한 차례 SPA 404는 최종 빌드 뒤 순차 실행에서 재현되지 않았다. 위 최종 6건 집계에는 포함하지 않는다. 모든 격리 runner는 QA DB를 생성·마이그레이션·삭제했다.

## 다음 작업

native shared 저장/ACK·upgrade/import/history·물리 타입 편집 UI/MCP·DDL 및 실제 DB SQL 검증은 여전히 미완료다. 이번 개인 상태 저장을 shared v2 쓰기 완료로 계산하지 않으며 usable gate도 활성화하지 않았다. native 웹은 여전히 조회 전용이다.

다음 작은 단위는 전체 통합 QA의 남은 기대값·import 읽기 오류를 해소하고 native 실제 편집 소비와 versioned sync 저장 연결로 이어간다.

후속 [호환 QA 결과](2026-10-02-Database-IntegrationCompatibilityQA.md): 위 확대 실행 6건을 해소해 최종 빌드 뒤 40개 전부 통과했다. import 후 get_project 실패는 추가한 내부 personalViewIds가 strict 공개 응답에 섞인 오류였으며 공개 snapshot에서 제외했다.
