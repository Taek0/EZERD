# 공통 문서 타입·생성기 분리 완료

- [계획](../planning/2026-10-07-Model-DocumentBasePlan.md)에 따라 document-base.ts에 버전 중립 구조와 createEmptyDocumentBase를 추출했다.
- DocumentBase는 도메인·뷰·메모·ENUM·레이아웃을 공유하며 TableBase/ColumnBase는 비물리 필드를 공유한다. 키·관계·배치·범위 등 양쪽에서 사용하던 공통 타입도 같은 모듈로 이동했다.
- v1 DesignDocument와 NativeDesignDocument는 각각 DocumentBase를 확장한다. NativeTable/NativeColumn은 v1 Table/Column의 Omit 대신 공통 기반을 사용한다.
- createEmptyNativeDocument는 v1 createEmptyDocument 호출을 제거하고 공통 생성기를 직접 사용한다. getDatabaseProfile 검증과 DB 문맥 복사는 유지한다.
- Native legacy 원문의 타입은 legacy-physical-type.ts의 LegacyPhysicalType으로 명시적으로 분리했다. 원문 데이터 형식이나 migration 정책을 없앤 것이 아니다.
- 기존 document.ts는 이동된 타입·상수를 re-export하므로 기존 직접 import 및 패키지 public import 경로를 유지한다. v1 생성자의 반환 타입과 동작도 유지한다.
- 개인 상태·자동 배치·테이블 캔버스의 공통 Pick 기준을 DesignDocument에서 DocumentBase로 변경했다. 실제 편집·정규화 알고리즘은 변경하지 않았다.
- 기존 inline 객체 타입의 assignability를 유지하기 위해 LegacyPhysicalType과 DocumentLayout은 type alias로 정의했다. 기존 이력 표시 소비자에 추가 cast를 넣지 않고 전체 타입 검사를 통과했다.

## 검증

- 새 테스트에서 v1 및 PostgreSQL/MySQL/SQLite v2 빈 문서의 JSON 직렬화 형태·필드 순서·optional 필드 생략을 기존 값과 비교했다.
- 생성된 컬렉션·레이아웃·뷰포트의 인스턴스 독립성과 DB 문맥 복사, 잘못된 DB/profile 조합 거부를 확인했다.
- Native 문서 생성 모듈의 런타임 import 그래프가 v1 document.ts 구현을 로드하지 않는 회귀 검증을 추가했다.
- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 전체 테스트: 202개 파일/2,581개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 격리 DB에서 versioned-document, native-transfer, native-transfer-legacy, native-history 통합 테스트 **138개 모두 통과**했다. 파일 변환·원문 증거·Native 저장·개인 상태·이력/복구를 검증했다.
- 임시 DB 생성·마이그레이션·정리는 test-isolated.ts 실행기가 수행했다. 기존 사용자 문서는 변경하지 않았다.
- 웹 산출물은 직전과 동일한 index-B8eXxYp3.css와 index-zCwAMpzL.js이다. Vite의 기존 500kB 청크 경고는 남는다.
- 브라우저 수동 QA·서버 재시작·배포는 수행하지 않았다. apps 코드, contracts, DB 스키마·기본값과 docs/EZERD.txt도 변경하지 않았다.

## 후속 범위

- 이번 완료 범위는 모델의 공통 문서 기반 분리다. Native 동기화 계약이 v1 스키마를 extend하는 구조는 다음 단위에서 분리한다.
- v1 파일 reader/migration, Native legacy 증거 검증, 과거 이력 해석과 기존 저장 문서 export는 계속 유지한다.
