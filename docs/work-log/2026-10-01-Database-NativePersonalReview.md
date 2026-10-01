# C3 native personal/review 공통 캔버스 소비 결과

- [계획](../planning/2026-10-01-Database-NativePersonalReview.md). personal extract/merge/reconcile와 shared canvas selector를 SQL 필드와 무관한 구조로 일반화했다. v1/native 문서의 DB/AST/index/check를 유지한다.
- merge는 이전 공유 문서에 남은 combined-view 메모/노드/route도 걸러, 삭제된 개인 화면의 옛 메모가 다시 공유 문서처럼 나타나지 않게 했다. 원본은 변경하지 않으며 shared diff는 그대로다.
- version-aware current reader로 native DB 문맥과 canonical canvas를 읽는다. personal GET/PUT는 사용자별 행만 사용하며 native merged 후보의 구조/예산·참조/legacy 정책을 검사한다. 공유 변경은 거부하고 callback에는 복사본을 넘겨 trusted current를 변조하지 못하게 한다.
- review 핀은 shared canvas와 인증된 사용자 자신의 personal 행을 합친 배치를 사용한다. 다른 사용자의 private 객체를 조회하지 않는다. 권한/객체/배치/본문 author 검증과 commit 이후 알림을 유지한다.
- MCP get_personal_state는 native에서도 읽으며 기존 MCP personal 명령은 아직 v1 helper이므로 native에서 명시 차단한다. native 개인 상태 JSON PUT가 동작한다고 native shared 설계 쓰기를 활성화하지 않는다.
- 새 모델 테스트 2개(물리 데이터 보존과 legacy private 제거)와 trusted current mutation 방어 1개 통과. 기존 write-auth fixture는 새 own-personal 조회 순서에 맞춰 보완했으며 author spoof 검증을 유지했다.
- 최종 빌드 후 격리 PostgreSQL HTTP/MCP/autosync 18개 통과: 세 DB native private camera/view/note 저장, native index와 private ID 충돌 차단, domain table·자기 private note에 review 생성, 다른 사용자의 private pin 차단, viewer 개인 상태 분리·비멤버 거부, 원본/document/version/sequence/updatedAt 유지, 기존 sync 회귀.
- 전체 `pnpm check`: 803개 통과/54개 건너뜀, 포맷·타입·빌드 통과. 격리 임시 DB·MCP 로그를 runner가 정리했다. 기존 큰 Vite 번들·runner child-process 경고 유지.

native 데이터는 격리 seed로 검증했으며 제품의 shared native 저장은 여전히 비활성이다. 다음은 web versioned snapshot 소비·native 편집 생성/갱신 및 실제 DB별 UI, upgrade/import/history/native sync ACK, 세 DB DDL/C6/C7/C8 검증이다. 전체 API/MCP의 기존 실패 5건은 아직 전체 QA 단계에서 해소해야 한다.
