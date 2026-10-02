# C4 native 웹 편집 소비와 미확인 저장 복구

- 시작 `34152a1`, 작업 트리 깨끗함. native 조회 화면에 권한에 따른 실제 속성 편집을 연결하고 native command REST 경계를 기존 MCP executor와 공유한다.
- 편집은 native 모델의 table/column partial patch를 사용한다. 기본 이름/설명·논리 속성부터 실제로 저장하며 타입/옵션 UI는 프로젝트 DB의 capabilities/verified gate에 따른다. 기존 legacy 값과 raw default/generation은 자동 제거하거나 v1로 투영하지 않는다.
- command는 현재 snapshot의 version/sequence/databaseRevision과 operation/group/client ID를 포함한다. POST 전에 사용자·프로젝트별 pending 요청을 저장한다. 미확인 응답은 같은 ID로 조회/재생하고 다른 DB revision으로 조용히 재전송하지 않는다. 실패/거부의 미적용 입력을 지우지 않으며 pending이 있을 때 새 작업과 충돌하지 않게 한다.
- viewer/archived/unavailable는 조회 전용이고 갤러리/프로젝트 이동·로그아웃에서 미적용 변경을 보존한다. 저장 완료 후 최신 versioned snapshot을 읽으며 source v1의 upgrade 진입은 queue flush/보존과 explicit upgrade를 거친다.
- native 상태·strict command 계약 및 사용자별 persistence/ACK/거부·미확인 재생/구문맥 보호를 테스트하고 실제 브라우저에서 저장·reload·권한·원본 type/default 유지 및 같은 요청의 서버 적용을 확인한다. 전체 check·기록·독립 커밋 뒤 다음 단위를 같은 턴에서 이어간다.
