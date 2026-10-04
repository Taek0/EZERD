# Native 편집 문자셋 정책 결과

- [계획](../planning/2026-10-02-Database-NativeCharacterEditorPolicy.md). literal default와 key 후보에 중앙 effectiveMysqlCharacters를 전달했다. 컬럼 COLLATE-only latin1/ASCII와 CHARSET-only binary의 길이/표현 검사가 서버·DDL과 같은 규칙을 사용한다.
- UI helper/static51개 통과. ASCII에서 é 거부, binary VARCHAR(1)의 2-byte é 거부, latin1 VARCHAR(1000) 키 허용과 utf8mb4 동일 선언3072-byte 초과 거부를 확인했다. readiness 플래그는 변경하지 않았다.
