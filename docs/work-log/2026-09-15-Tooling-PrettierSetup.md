# Prettier 워크스페이스 구성

작성일: 2026-09-15

Prettier 3.9.6을 루트 개발 의존성에 정확한 버전으로 추가했다. .prettierrc.json은 기존 EditorConfig와 맞춰 2칸 들여쓰기·LF·작은따옴표·세미콜론·100자 줄바꿈을 지정한다. 문자열 내부에 포함된 테스트 fixture의 의미가 바뀌지 않도록 embeddedLanguageFormatting은 off로 둔다.

pnpm format은 코드 포맷을 적용하고 pnpm format:check는 확인만 한다. 기존 pnpm check의 첫 단계에도 포맷 검사를 추가했다. VS Code에는 언어별 Prettier 저장 시 포맷 및 확장 추천을 제공했다. 별도 Git hook은 설치하지 않았다.

마이그레이션·스냅샷·lockfile·외부 자산·문서·캐시·DB·빌드 결과는 .prettierignore로 제외했다. 초기 검사에서 포맷이 필요한 파일 157개를 확인했으며, 실제 일괄 포맷은 다음 커밋으로 분리한다. 기존 문서 재분류 변경은 이번 구성 커밋에 포함하지 않았다.

참고: https://prettier.io/docs/install 및 https://prettier.io/docs/ignore
