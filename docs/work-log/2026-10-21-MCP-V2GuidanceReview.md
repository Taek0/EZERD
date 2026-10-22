# MCP v2 요청 안내 검토 결과

- 현재 세션의 apply_native_project_changes 선언에서 commands가 Array<unknown | ...>로 노출됐다. 서버는 런타임 계약에서 JSON Schema를 생성하지만 이 클라이언트가 표시하는 명령 선언에는 필드 정보가 없다. JSON Schema 변환 또는 클라이언트 전달 단계의 정확한 원인은 별도 확인이 필요하다.
- 도구 설명의 add_table 예시는 value:NativeTable이라는 타입명만 제시한다. SQLite/generic namespace 예시는 있지만 PostgreSQL의 postgresSchema 및 완전한 필수 객체 예시가 없다.
- list_tables/get_project_view 요약 응답은 logicalName/physicalName을 사용한다. 쓰기 객체의 logical.name/physical.name과 달라 그대로 재사용할 수 없지만 해당 경고가 없다.
- docs/work-log/2026-10-07-MCP-NativeCommandValidationResult.md의 SQLite 생성 예시는 logical/customProperties/physical.comment를 포함한 올바른 형태다. 그러나 일반 MCP 호출에 이 문서 본문이 자동 전달되지는 않는다.
- 권장: 도구 설명에 DB별 namespace/options 및 필수 필드를 포함한 최소 생성 예시, patch_table 부분수정 예시, 조회 요약을 쓰기 value에 복사하지 말라는 안내를 추가한다.
- 권장: 필요 명령의 상세 계약·검증된 예시를 조회하는 읽기 전용 수단을 제공해 거대한 union 선언이 unknown으로 축약되는 클라이언트에서도 입력 구조를 확인할 수 있게 한다.
- 권장: 예시를 실제 nativeEditorCommandSchema로 검사하는 테스트를 두고 native.command-invalid에서 필드별 수정 안내를 보완한다. 런타임 엄격 검증을 완화하거나 구형 필드를 묵시 변환할 필요는 없다.
- 코드 변경 및 실제 프로젝트 쓰기 요청은 수행하지 않았다.
