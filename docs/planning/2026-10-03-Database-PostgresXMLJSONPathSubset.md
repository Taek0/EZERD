# PostgreSQL XML/jsonpath typed literal 제한 subset 계획

## 명세와 소유 범위

[TypeFeatureMatrix](2026-10-01-Database-TypeFeatureMatrix.md)의 JSON 경로/XML은 타입 전용 리터럴/캐스트이며 외부 표현을 text 기본값으로 묵시 처리하지 않는다. 현재 declaration만 검증되었고 literal은 전체 unsupported다. 이 단위는 `model/database/literals.ts`의 XML/jsonpath 두 분기, 새 bounded helper/tests, web `native-editor-option-policy.ts`의 해당 typedText sample 두 hunk와 새 selector 테스트, 전용 actual integration fixture/검증 script를 소유한다. format/widgets 생산 파일, 다른 literal family/registry/barrel 및 기존 77 feature fixture는 변경하지 않는다. Banach의 typed subset과 별도 파일명/경로를 사용한다. git add/commit하지 않는다.

## 승인할 subset

- XML: UTF-8 8192 bytes, 깊이 16, 요소 128, 요소당 속성 32, 이름 64 ASCII chars 이내의 단일 root 요소. leading/trailing XML whitespace와 중첩 요소/quoted 속성/Unicode text/5개 predefined entity 및 유효 XML 1.0 numeric character reference만 허용한다. 원문을 반환하거나 normalize하지 않고 validity만 판정한다.
- XML 제외: DOCTYPE/외부·custom entity, XML declaration/PI/comment/CDATA, namespace/colon 이름/xmlns, 여러 root나 text-only fragment, XML 1.0 금지 codepoint, malformed/중복 attribute/잘못된 nesting. 이 subset은 전체 XML grammar/DTD/schema validator가 아니다.
- jsonpath: UTF-8 2048 bytes, 최대 accessor 32개, ASCII member 이름 64 chars, canonical 비음수 index 0..1024. `$` root 및 `.member`/`[index]`만 허용한다. whitespace/mode prefix/quoted member/filter/wildcard/recursive descent/method/variable/SQL token은 허용하지 않는다. PostgreSQL의 전체 SQL/JSON grammar 또는 RFC JSONPath 구현을 주장하지 않는다.
- native default `literalType:typedText` + explicit builtin PG type ID만 해당 parser로 전달한다. string/json literal의 묵시 cast나 arbitrary expression typedText 우회는 계속 차단한다. 미검증 입력은 usable=false며 생산 coverage registry를 변경하지 않는다.

## 실제 검증과 환경 경계

PG18, UTF8 client/server, libxml/XML 기능 사용 가능 환경에서 parameterized explicit cast와 값 보존을 확인한다. XML은 xmloption DOCUMENT/CONTENT 모두, jsonpath는 cast의 canonical output과 실제 JSON 값 선택을 확인한다. engine 자체가 받아들이는 parser 제외 문법도 모델에서 false임을 분리한다. DB build의 libxml 부재/encoding 차이는 이 단위가 runtime capability discovery로 해결했다고 주장하지 않는다.

전용 actual AppModule integration에서 실제 REST native-sync commands와 MCP apply/read → 원문/ACK replay → whole physical DDL → PostgreSQL execute/default value를 검증한다. 경로별 실패 입력과 요청 변경 후 동일 ID fingerprint conflict, 원문/version 불변, string/typedText AST 우회 차단도 확인한다. 준비 모델을 trusted previous로 seed하지 않는다. 부모 shared model/contracts/server build 준비와 동기화하여 실제 public package 동작을 검증하고 web build는 중첩하지 않는다.

[PG18 XML 공식 문서](https://www.postgresql.org/docs/18/datatype-xml.html)는 XML 지원의 libxml 조건, session XML option과 cast-to-text 원문 출력을 설명한다. [PG18 jsonpath 공식 문서](https://www.postgresql.org/docs/18/datatype-json.html#DATATYPE-JSONPATH)는 PostgreSQL accessor grammar의 기준이다. 실제 환경에서 정의한 subset만 probe한다.

결과는 `docs/work-log/2026-10-03-Database-PostgresXMLJSONPathSubset.md`에 parser 제한/현재 gate/actual 증거와 미완료를 구분해 기록한다.
