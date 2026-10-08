# Native MCP 명령 입력·오류 진단 수정 결과

- [계획](../planning/2026-10-07-MCP-NativeCommandValidationPlan.md)에 따라 전달받은 SQLite v2 테이블 생성 실패를 재현했다.
- 실제 사용자 프로젝트 `10a60a2a-391b-4b2e-89e8-41dcd4900f06`에 명령을 보내거나 데이터를 수정하지 않았다. 테스트는 메모리 fixture와 실행기가 생성·정리하는 격리 QA DB를 사용했다.

## 원인

1. `add_table`은 `type`과 `value`만 받는다. `placement`는 허용되지 않는 필드다. 배치는 별도의 `add_table_reference` 명령으로 지정해야 한다.
2. SQLite namespace는 `{ "kind": "sqliteMain" }`이다. `{ "kind": "none" }`과 namespace 생략은 계약에 맞지 않는다. 전달받은 나머지 테이블 필수 필드와 SQLite options는 올바르다.
3. MCP 선언은 command type과 passthrough payload만 노출해 호출자가 실제 필수 필드를 알기 어려웠다.
4. 명령 파싱 실패는 `native.command-invalid`만 생성했고, MCP 공통 오류 처리는 `HttpException.message`만 반환해 응답 본문의 code·검증 상세까지 잃었다. 이 조합이 `Bad Request Exception`만 반환하는 현상을 만들었다.
5. operationId/groupId/clientId는 UUID가 필수다. 객체 ID는 별도의 문자열 계약이므로 모든 객체 ID를 UUID로 바꾸는 것만으로 위 오류를 해결할 수 없다.

## 변경

- 런타임 명령 계약에서 input JSON Schema를 생성해 MCP metadata에 반영했다. 실제 tools/list에서 모든 명령 분기와 table/column 값, DB namespace/options, 별도 배치 명령의 구조가 노출된다.
- SDK의 사전 파서는 command 원문을 유지한다. 완전한 검증은 기존과 같이 권한·프로젝트 잠금·operation replay 확인 이후 수행해 역사적 ACK 재생 순서를 보존한다.
- AST 전처리·깊이 제한 등 JSON Schema로 표현되지 않는 검증과 DB/profile 정책은 런타임이 계속 검증한다. 이 변경이 모든 정책을 JSON Schema로 표현했다는 의미는 아니다.
- Zod 입력·후보 문서 검증 실패에 issues를 포함했다. 필드 path, 검증 code/message, union 상세 및 알 수 없는 keys를 반환한다.
- MCP의 예상된 HTTP 오류는 JSON text에 HTTP status·requestId와 서버 응답의 code/issues/blockers 등을 포함한다. 동기화 정책 거부 ACK의 reasonCode 형식은 그대로 유지한다. 예상하지 못한 내부 오류는 기존의 요청 ID 안내만 반환하고 스택·내부 오류 메시지를 노출하지 않는다.
- 도구 설명에 SQLite 테이블 생성과 별도 배치 예제를 추가했다.

## 정상 명령 예제

다음 commands를 apply_native_project_changes에 전달한다. projectId와 요청 UUID는 호출 문맥에 맞게 사용하고 expectedVersion/expectedSequence/expectedDatabaseRevision은 get_project_document_state에서 다시 조회한 값으로 지정한다. 아래 ID는 예시이며 기존 객체와 중복되면 안 된다. 컬럼은 add_column, PK는 add_key, FK는 add_foreign_key 명령으로 같은 batch에 추가할 수 있다.

```json
[
  {
    "type": "add_table",
    "value": {
      "id": "c5821ee7-d16e-4e6d-988e-0f9340715400",
      "domainId": null,
      "scope": "both",
      "logical": { "name": "상품 분류", "definition": "테스트용 상품 분류" },
      "physical": {
        "name": "categories",
        "namespace": { "kind": "sqliteMain" },
        "comment": "",
        "options": { "database": "sqlite", "strict": false, "withoutRowid": false }
      },
      "customProperties": { "common": {}, "logical": {}, "physical": {} }
    }
  },
  {
    "type": "add_table_reference",
    "tableId": "c5821ee7-d16e-4e6d-988e-0f9340715400",
    "viewId": "__tables__",
    "placement": { "x": 1500, "y": 180, "width": 400, "height": 260 }
  }
]
```

## 검증

- 새 메모리 MCP 테스트 4개: 실제 tools/list의 명령 구조, 전달받은 형식의 namespace/placement 오류와 baseline 미발급, 기존 네 종류 legacy 진단이 있는 SQLite 문서의 5개 테이블 추가, 정책 오류 상세 및 내부 오류 비노출.
- 실제 AppModule·HTTP MCP·격리 DB 통합 스위트 **11개 모두 통과**. PostgreSQL/MySQL/SQLite의 기존 캔버스 명령 검증에 SQLite 재현을 추가했다.
- 재현에서는 기존 네 진단(`legacy.namespace-unresolved`, `legacy.type-unresolved`, `legacy.default-unresolved`, `legacy.enum-context-mismatch`)이 있는 문서에 categories/products/customers/orders/order_items를 추가했다. 컬럼 5개·PK 5개·FK 1개·공유 배치 5개가 저장되고 재조회됐다. 기존 객체의 legacy 원문·ENUM과 진단이 유지됐으며 동일 operation 재호출은 같은 ACK를 반환하고 중복 저장하지 않았다.
- 원래 형식의 실패 요청은 HTTP 400, native.command-invalid와 commands/0/value/physical/namespace 경로 및 commands/0의 placement 키 오류를 반환했다. 실패 전후 저장 문서와 version/sequence가 동일했다.
- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 전체 기본 테스트: **204개 파일 / 2,587개 테스트 통과**, 25개 파일 / 492개 테스트 건너뜀. DB 스위트는 위 별도 격리 실행으로 확인했다.
- 첫 통합 실행의 새 검증은 컬럼 저장 순서를 삽입 순서로 가정해 실패했다. ID와 내용·개수를 확인하도록 수정한 뒤 전체 스위트가 통과했다. 저장 알고리즘은 변경하지 않았다.
- 로컬 PATH의 Node shim이 실행을 거부해 기존 v24.18.1 실제 런타임과 캐시된 pnpm 11.24.0/Corepack 경로를 해당 명령 환경에서 사용했다. PC 전역 설정이나 의존성 버전을 변경하지 않았다.
- 기존 Vite 500kB 청크 경고와 격리 실행기의 shell:true deprecation 경고는 남는다. 브라우저 수동 QA는 수행하지 않았다.

## 적용 범위

- 현재 로컬 MCP에는 get_project_view를 포함한 v1 전용 도구가 이미 등록되지 않는다. 전달된 과거 도구 목록과는 차이가 있으므로 서버 실행 코드와 MCP 클라이언트의 도구 목록을 갱신해야 한다.
- 서버 재시작·배포·MCP 클라이언트 재연결은 수행하지 않았다. 이번 결과는 로컬 코드와 격리 테스트 기준이다.
- 동시 진행된 v1 미사용 호환 정리는 별도 커밋으로 반영됐으며 이 변경에 포함하지 않는다. DB 스키마·실제 사용자 데이터·docs/EZERD.txt는 변경하지 않았다.
