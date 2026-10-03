# PostgreSQL XML/jsonpath bounded typed literal 결과

## Ready와 소유 범위

XML/jsonpath 제한 subset은 ready다. shared `literals.ts`/`literals.test.ts` XML 분기 및 `native-editor-option-policy.ts` sample 두 hunk는 부모 통합 전에 freeze를 알렸으며 이후 수정하지 않았다. 부모가 연결하는 bounded typed family adapter와 추가 array/search/multirange/snapshot sample은 부모 소유다. 본 단위는 registry/readiness/barrel/서비스/format/widgets 생산 파일과 기존 77 fixture를 수정하지 않는다. git add/commit하지 않았다.

담당 파일:

- `packages/model/src/database/postgres-structured-literals.ts`: 실행·normalize 없이 validity만 확인하는 bounded XML/jsonpath helper.
- `packages/model/src/database/postgres-structured-literals.test.ts`: 정상/제외/공격/byte/depth/entity/AST/cast 경계 64개.
- `packages/model/src/database/literals.ts`: 명시 PG XML/jsonpath + literalType typedText 분기만 연결. 기존 token/profile/type parameter 및 release coverage 검증을 유지한다.
- `packages/model/src/database/literals.test.ts`: 해당 두 family의 기존 whole-unsupported 기대값만 조정. 기타 family 기대값은 부모 adapter 소유다.
- `apps/web/src/features/projects/native-editor-option-policy.ts`: XML `<root/>`, jsonpath `$.items[0].value` 대표 typedText sample 두 hunk.
- `apps/web/src/features/projects/native-xml-jsonpath-defaults.test.ts`: 기존 format UI selector를 수정 없이 render하고 입력→strict patch, string 거부/원문 보존을 확인한다.
- `apps/server/scripts/postgres-xml-jsonpath-fixtures.ts`: 전용 정상 11개 및 제외 10개 입력. 기존 77 case와 별도 집합이다.
- `apps/server/scripts/verify-postgres-xml-jsonpath.ts`: parameterized actual cast/value와 strict actual manifest SQL 실행.
- `apps/server/test/native-xml-jsonpath.integration.test.ts`: actual compiled AppModule REST/MCP 23개 검증. Banach/부모 `native-postgres-bounded-literal.integration.test.ts`와 다른 파일·artifact 경로다.
- [계획](../planning/2026-10-03-Database-PostgresXMLJSONPathSubset.md)과 이 결과 기록.

## 지원 문법과 차단 경계

XML은 XML 1.0 문자 범위의 단일 root, ASCII 이름 64 chars, quoted 속성, 중첩 요소, Unicode text, amp/lt/gt/apos/quot 및 유효 numeric character reference만 확인한다. UTF-8 최대 8192 bytes, 깊이 16, 요소 128, 요소당 속성 32다. 원문 문자열/label/token을 normalize하지 않는다. 문서 선언·DOCTYPE/custom/external entity·PI/comment/CDATA·namespace/colon 이름/xmlns·여러 root·text-only fragment는 제외다. DTD 또는 schema validation을 구현한 것이 아니다.

jsonpath는 `$`와 ASCII unquoted `.member`, canonical `[index]`만 확인한다. UTF-8 최대 2048 bytes, accessor 32개, member 64 chars, index 0..1024다. whitespace/mode prefix/quoted member/filter/wildcard/recursive descent/method/variable/SQL text는 제외다. XML/jsonpath 외 family나 arbitrary CAST/SQL expression grammar를 확대하지 않았다.

서비스는 explicit builtin type ID + `literalType:typedText`로만 이 helper를 호출한다. string/json의 묵시 cast와 default expression AST의 typedText 우회는 차단된다. DDL은 기존 compiler의 `CAST(E'...' AS XML/JSONPATH)`를 사용하고 quote/backslash를 안전하게 escape한다. XML 안의 SQL처럼 보이는 text는 데이터이며 실행 코드가 되지 않는 것을 실제 default insert에서 확인했다. 미검증·제외 입력의 allowed/usable은 false다. 생산 coverage registry는 변경하지 않았다.

## 검증 결과

| 구분 | 결과 | 증거 범위 |
| --- | --- | --- |
| XML/jsonpath helper unit | 64 PASS | 담당 제한 parser/원문/cast 검사 |
| 기존 literal unit | 197 PASS | 부모 adapter 연결 전 담당 freeze 기준 |
| 전용 UI selector unit | 4 PASS | 실제 format selector render와 strict patch 생성 |
| 합계 model/UI targeted | 265 PASS | 담당 수행; 다른 family/부모 전체 suite와 구분 |
| public model package build | PASS, 1회 | 담당 parser를 public runtime에 반영; web/server build 없음 |
| targeted strict model/server/script TypeScript | PASS | 담당 파일 entry |
| targeted web sample/selector TypeScript | PASS | apps/web 작업 경로, 기존 format imports 포함 |
| actual AppModule isolated REST/MCP | 23 PASS / 0 FAIL / 0 SKIP | 정상 11 × 2채널 + 제외 10 × 2채널 + implicit/AST 우회 2 × 2채널 검증을 23개 test로 구성 |
| PG18 parameterized cast/value | positive 11 PASS | XML DOCUMENT/CONTENT 모두, jsonpath 실제 선택 값 |
| engine-valid/product-excluded grammar | 6 PASS | comment/CDATA/namespace, wildcard/strict/quoted member를 engine는 허용하지만 helper는 false |
| malformed actual cast | 2 PASS | XML data exception, jsonpath syntax error 42601을 구분 |
| actual REST/MCP export SQL execution | 22 PASS | 11 × REST/MCP 각각 저장 원문/hash/DDL/DEFAULT insert/선택 값 |

최종 actual reporter/log는 `.data/native-xml-jsonpath-qa/816499c7-15d8-4b92-89d3-4ca9df3dec96/actual.json` 및 `actual.log`다. 전용 manifest와 SQL/source JSON은 `.data/native-xml-jsonpath/c009f40d-52a1-4b4c-8dff-84fcf84b4c45/manifest.json`이다. 같은 폴더 `pg-result.json`은 source `actual-rest-mcp-xml-jsonpath`, castCases 11, actualSQL 22, result PASS를 기록한다. cast-only 초기 증거는 `.data/postgres-xml-jsonpath-casts/b3d36783-7811-4e01-85e3-10254c397d09/pg-result.json`으로 별도 보존했다.

fixture 초기 구현의 payload nesting/UI before-values 및 현재 fingerprint/MCP 오류 표현에 대한 기대값을 기존 계약에 맞게 고친 뒤 final 23개를 통과시켰다. 생산 권한·검증·replay를 약화하지 않았다. 동일 actor의 같은 요청은 원문 ACK로 replay되고 changed request는 REST 409 `sync.replay-mismatch`다. MCP의 기존 opaque tool error는 유지하며 같은 changed 요청의 REST 응답으로 fingerprint 거부 원인을 추가 입증했다. 거부 후 원문/version 불변을 확인한다. 실패한 준비 실행 artifact를 성공으로 계산하지 않는다.

## 환경과 한계

실제 엔진은 PostgreSQL server_version_num `180006`, client/server encoding `UTF8`다. libxml 기능은 XML cast와 xml_is_well_formed_document 실행 성공으로 입증했다. 다른 PG family/encoding 또는 libxml 없는 build를 runtime discovery하여 자동 활성화했다고 주장하지 않는다. profile 가정 밖 환경은 별도 실행 검증이 필요하다.

[PG18 XML 공식 문서](https://www.postgresql.org/docs/18/datatype-xml.html)의 XML option/원문 출력/libxml 조건을 참고하되 양 option에서 동작하는 단일 root subset만 검증했다. [PG18 jsonpath 공식 문서](https://www.postgresql.org/docs/18/datatype-json.html#DATATYPE-JSONPATH)의 전체 SQL/JSON 문법 지원을 주장하지 않는다. jsonpath engine cast는 member를 quoted canonical form으로 출력할 수 있으므로 engine output과 저장 JSON 원문을 구분한다. source JSON 원문은 REST/MCP/read/export에서 변경하지 않는다.

기존 77 feature fixture/154 SQL completed manifest는 변경하거나 재생성하지 않았다. XML/jsonpath 22 SQL 증거와 부모의 다른 C6 typed family 증거를 합산할 때 각 manifest를 별도로 확인해야 한다. 부모 전체 sharedbuild/62 actual 통합 결과는 이번 독립 ready 선언에 포함하지 않는다.

## 재현과 인계

```powershell
pnpm exec vitest run packages/model/src/database/postgres-structured-literals.test.ts packages/model/src/database/literals.test.ts apps/web/src/features/projects/native-xml-jsonpath-defaults.test.ts
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-xml-jsonpath.integration.test.ts
pnpm --filter @ezerd/server exec tsx scripts/verify-postgres-xml-jsonpath.ts --manifest D:/Code/EZERD/.data/native-xml-jsonpath/c009f40d-52a1-4b4c-8dff-84fcf84b4c45/manifest.json
```

부모 adapter가 다른 family의 literal 기대값을 갱신하는 중이므로 부모 전체 literal suite 숫자와 담당 freeze 시점 197개를 혼동하지 않는다. 기존 공개 literalDecision을 통하므로 새 index/AppModule/MCP 등록은 필요 없다. script/test 등록은 전용 파일로 준비 완료다. 담당 미완료 항목은 없다. repository 명령은 지속 승인된 require_escalated로 실행했으며 freeze 뒤 공유 source 추가 변경은 하지 않았다.
