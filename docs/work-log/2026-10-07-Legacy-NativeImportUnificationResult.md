# v1 파일 가져오기 Native 통합 완료

- [계획](../planning/2026-10-07-Legacy-NativeImportUnificationPlan.md)에 따라 모든 제품 가져오기 진입점을 기존 NativeTransferService로 통합했다.
- 웹은 파일 버전과 관계없이 /projects/native-transfer/import를 사용한다. v1 원본도 v2 프로젝트로 변환된다는 안내를 표시하고, 결과의 DB/profile/revision·사용자/워크스페이스 문맥 검사를 유지한다.
- 기존 POST /projects/import는 NativeTransferController의 호환 진입점으로 이동했다. Project 응답 형태는 유지하지만 저장되는 문서는 v2다. 진단을 포함한 Native endpoint 응답은 그대로 유지한다.
- MCP import_project는 v1·v2 파일을 동일한 서버 검증으로 처리한다. MCP 메타데이터 파싱이 v1 원문을 미리 trim/정규화하지 않도록 하고 전체 검증은 NativeTransferService가 수행한다.
- 새로 가져온 v2 프로젝트를 MCP에서 다시 내보낼 수 있도록 export_project도 versioned export로 연결했다. MCP 전송 결과는 formatVersion 2이며 sourceDocument와 별도 Native 미리보기/진단을 포함한다.
- WorkspaceService의 v1 신규 문서 저장용 importProject, 미사용 importProjectSchema, 웹의 v1 전용 가져오기 분기를 제거했다.

## 현재 기능과 데이터 보존

- NativeTransferService의 변환·검증 알고리즘은 변경하지 않았다. source schemaVersion 1은 서버가 migration을 수행하고, 원문 타입·기본값·스키마 및 감사 증거를 기존 정책으로 보존한다.
- PostgreSQL의 알려진 타입 별칭은 Native 타입으로 옮기고, 변환할 수 없는 값은 legacy 원문으로 보존한다. v1의 PG 표현을 MySQL/SQLite 타입으로 임의 해석하지 않는다.
- 신규 프로젝트 ID·객체 ID remap 정책을 유지한다. legacy ENUM 증거에 포함된 ID는 기존 정책대로 새 프로젝트 namespace 안에서 보존할 수 있다.
- 기존 Native 파일, 검증된 legacy-mask 재가져오기, 참조 그래프·크기·권한 검사, 감사 기록 실패 시 트랜잭션 롤백을 유지한다. 위조된 preview나 native 출처 주장은 기존 서버 정책으로 거부한다.
- 이미 저장된 v1 프로젝트의 HTTP export 및 upgrade, v1 파일 reader/migration은 보존했다. 기존 프로젝트를 일괄 변환하지 않았다.

## 검증

- 웹에서 v1/v2 파일 모두 Native endpoint를 사용하는지, v1 원본 안내가 두 종류의 파일 envelope에 표시되는지 검사했다.
- 서비스 테스트로 3개 DB 종류의 v2 생성·raw 타입/기본값·감사 증거 보존·독립된 두 번 가져오기·권한 실패·참조 오류·저장소 실패를 확인했다.
- MCP 메모리 전송 테스트로 v1의 공백과 원문이 바뀌지 않은 채 서버 서비스로 전달되는지와 compact v2 입력을 확인했다.
- 이전 WorkspaceService import 전용 테스트는 Native 서비스/통합 검증으로 교체했다. 기존 저장 v1 export의 snapshot·원본 불변 검증은 유지했다.
- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 기본 전체 테스트: 202개 파일/2,584개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 별도 격리 DB에서 api.integration, mcp.integration, native-transfer.integration, native-transfer-legacy.integration의 **71개 테스트 모두 통과**. 기존 REST 경로·MCP의 실제 가져오기와 v2 재가져오기, 3개 DB의 원문 증거, 권한·rollback을 포함한다.
- 임시 DB는 test-isolated.ts 실행기가 생성·마이그레이션·정리했다. 실제 사용자 문서와 docs/EZERD.txt는 변경하지 않았으며 서버 재시작·배포는 수행하지 않았다.
- Vite의 500kB 청크 경고는 기존과 같이 남는다. 브라우저 수동 QA는 실행하지 않았다.
