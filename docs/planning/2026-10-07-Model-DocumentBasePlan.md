# 공통 문서 타입·생성기 분리

- v1 DesignDocument와 NativeDesignDocument가 공유하는 도메인·뷰·메모·ENUM·레이아웃 구조 및 빈 값 생성을 버전 중립 모듈로 추출한다.
- 테이블·컬럼의 공통 비물리 필드도 분리해 Native가 v1 Table/Column을 Omit하지 않도록 한다. Native의 legacy 원문 타입은 명시적인 호환 타입으로 보존한다.
- Native 빈 문서 생성자는 v1 createEmptyDocument를 호출하지 않는다. v1/v2의 직렬화 결과, optional 필드 생략, DB 문맥 검증과 객체 독립성을 유지한다.
- 기존 document.ts의 public exports는 re-export로 유지한다. 공통 개인/캔버스 타입의 Pick 기준은 공통 문서로 바꾼다.
- 이번에는 동기화 계약 기반 분리나 DB 스키마·기본값 변경을 하지 않는다.
- 타입 검사·전체 테스트·빌드 및 격리 DB의 파일 변환/이력 회귀를 검증하고 결과를 기록한 뒤 커밋한다. docs/EZERD.txt는 수정하지 않는다.
