# PostgreSQL bounded typed default 실제 소비 결과

- [계획](../planning/2026-10-03-Database-PostgresBoundedTypedLiterals.md), [XML/jsonpath 계획](../planning/2026-10-03-Database-PostgresXMLJSONPathSubset.md). 타입 전용 checked subset을 공통 literalDecision/default UI sample에 연결했다. 새 raw SQL/AST 함수를 허용하지 않으며 기존 default/type/array readiness와 enum 참조/원문·권한·출처 검증을 유지한다.
- 배열과 search/multirange/snapshot은 기존 blanket blocker 전에 독립 helper의 결과만 소비한다. 잘못된 profile/type/파라미터·전용 literalKind·deprecated·환경 의존 원소는 계속 거부한다. ARRAY는 정확한 빈 배열{}, multirange는{}, 검색은 단일 ASCII lexeme, snapshot은 exact64bit/sorted xip 제한으로 실제 검증한 subset이다. 모든 parser 문법을 지원한다고 주장하지 않는다.
- XML/jsonpath는 전용 bounded helper와 typedText만 소비한다. DOCTYPE/external/custom entities 및 XML/JSONPATH 전체 문법은 제외한다. 원문 문자열을 normalize하지 않고 기존 compiler가 CAST를 출력한다. 상세 byte/depth/문법 및 환경 한계는 연결된 XML 결과를 따른다.
- actual native API/MCP62개가 각 type default 저장·원문·accepted/rejected ACK 재생·잘못된 입력 거부·각 채널 whole DDL 생성 및 PostgreSQL18 실행 값에 통과했다. 준비 cast proof62종/141관찰과 실제 product62개 테스트를 구분한다.
- XML/jsonpath actual AppModule23개를 부모 최신 shared/server build에서 재검증했고 실제 REST/MCP SQL22개·11개 cast/value probe도 통과했다. 기존77/154 feature manifest는 변경하지 않았다.
- DB model/관련 UI26파일1024개 통과. web/server/source 및 required tools 타입 검사도 통과했다. 처음 tools 검사에서 QA script의 model source 직접 import가 rootDir 범위를 벗어나는 오류를 발견하여, 공개 database export와 @ezerd/model import로 수정했다. 이전 blanket ‘anything 거부’는 검색의 valid single lexeme와 복잡 문법 거부/손상 snapshot 입력을 구분하여 갱신했다.
- 대표 UI sample은 mutable default가 아니며 모델에서 검사한 선택 hint다. project ENUM/builtin empty array{}, search alpha, snapshot1:2:, multirange{}와 XML/jsonpath hint를 지원한다. 사용자 입력/현재 원문을 sample로 바꾸지 않는다.
