# MCP v2 명령 안내 보완 결과

- 공통 instructions 및 apply_native_project_changes 설명에 전체 생성 객체와 부분 수정의 차이를 명시했다. 조회용 logicalName/physicalName을 쓰기 value로 복사하지 않도록 안내한다.
- PostgreSQL/MySQL/SQLite/generic 각각 namespace 및 options 구조를 안내한다. logical.name, physical.comment, customProperties 필수 객체를 명시한다.
- 읽기 전용 get_native_command_guide(command,databaseKind) 도구를 추가했다. 모든 런타임 명령의 독립 JSON Schema를 반환하며, add_table/patch_table/add_column/patch_column/add_table_reference는 모델 팩토리로 만든 DB별 예시를 제공한다. 나머지는 예시 없음과 상세 스키마 확인을 명시한다.
- 예시는 commands 배열의 개별 명령이다. ID는 실제/새 객체 ID로 교체하고 요청의 동시성 기준과 UUID는 별도로 채워야 한다. 프로젝트 DB 기능 허용 여부는 capabilities로 확인한다.
- 기존 엄격한 입력 검증 및 저장 정책은 변경하지 않았다. 이 도구는 클라이언트의 큰 union 선언이 unknown으로 보이는 경우에도 응답 본문에서 명령 구조를 확인할 수 있게 한다. 클라이언트 자체의 스키마 변환을 수정한 것은 아니다.

## 호출 예시

```json
{"command":"add_table","databaseKind":"postgresql"}
```

수정 명령 예시:

```json
{
  "type": "patch_table",
  "id": "기존 테이블 ID",
  "patch": {
    "logical": {"name": "사용자"},
    "physical": {"comment": "사용자 정보"}
  }
}
```

## 검증 및 적용

- DB 4종 예시의 런타임 계약·JSON Schema 검증, 전체 명령 스키마 컴파일, 실제 in-memory MCP tools/list 및 안내 도구 호출 포함 21개 테스트 통과.
- 서버 및 tools TypeScript 빌드, 변경 코드 Prettier, git diff --check 통과.
- 실제 프로젝트 변경 없음. 호스팅 재빌드·재시작 및 MCP 재연결 후 신규 도구와 설명이 반영된다.
