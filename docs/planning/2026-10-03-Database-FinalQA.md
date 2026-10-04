# DB native 구현 최종 통합 QA 계획

- 2026-10-03. 사용자가 중단한 뒤 자동 이어가기로 같은 승인 범위를 재개한다. Worker 1 선행 완료를 다시 기다리지 않는다. [명세](2026-10-01-Database-CapabilitySpecification.md)와 [기존 QA 계획](2026-10-02-Database-NativeReadinessActivation.md)을 유지한다.
- 2026-10-02의 advanced 후보는 기본124 타입/33개 기능·제한 default 정책을 연결하고 실제77 REST/MCP 저장 경로와154 SQL의3엔진 실행에 성공했다. 미커밋 registry/회귀/UI 결과는 현재 소스를 다시 검증하고 독립 커밋한다. 중단된 실행 ID나 과거 성공을 새 실행 성공으로 오인하지 않는다.
- structured ENUM/value-list labels와 deferrable 명시 제거, v1 프로젝트 DB UI 경계를 통합한다. 타입·기능·literal 환경의 음성 보호 및 기존 데이터/원문/재생/retired IDs를 유지한다.
- 전체 format/type/runtime/tools/unit/build와 실제 API/MCP/WS/legacy/import/history/변환 QA를 실행한다. workspace 전용 fixture는 지정 runner로 분리한다. DB 실행은 실제 API 산출 SQL의 manifest/해시를 검사하고 QA owned namespace/DB/컨테이너만 사용한다.
- 실제 브라우저에서 세 DB의 native 물리 편집·타입/default/key/advanced 조건·전체 SQL/JSON 다운로드/명시 upgrade·변환을 검증한다. private CAS response loss/동시 writer/보관·명시 해제와 two-tab 입력 원문 보존은 자체 QA 계정/DB에서 확인한다.
- 생성한 QA 탭/프로세스/UUID DB/임시 파일/자체 MySQL 컨테이너를 정확히 식별하여 정리한다. 사용자 DB/Downloads와 docs/EZERD.txt는 수정하지 않는다. 전체 완료 전 자동 이어가기를 비활성화하지 않는다.
