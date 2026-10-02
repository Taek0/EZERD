# Native 공간 SRID 정책 계획

- MySQL 공간 타입의 명시 SRID를 공통 feature 판정에 연결한다. 기본 타입 coverage만으로 SRID feature를 우회하지 않는다.
- 설치 환경을 조회하지 않는 export이므로 실제 QA로 확인한 기본 좌표계 0/4326만 신규 저장·DDL에 허용한다. 다른 값의 기존 원문은 cause 기반 보존/명시 복구 정책을 유지하며 export에는 환경 진단을 낸다.
- unsupported/gate/environment 및 기존 원문 보존의 차이를 순수 validator 회귀 테스트로 확인하고 고급 실제 API/SQL fixture에서 4326과 공간 인덱스를 검증한다.
