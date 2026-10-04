# Native 편집 문자셋 정책 일치 계획

- MySQL 문자셋/COLLATE-only/CHARSET-only의 중앙 effective 정책을 default literal·PK/UNIQUE 편집 후보의 facts에도 전달한다. 서버 검증/DDL과 같은 허용 및 길이 단위를 사용한다.
- ASCII/utf8mb3 표현 불가 값과 binary text의 byte 길이를 UI helper에서 거부하고 raw token을 보존한다. collation-only latin1의 키 최대 길이와 미검증 charset 차단을 회귀 검증한다. readiness는 별도이며 이 단위로 활성화하지 않는다.
