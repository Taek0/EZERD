# 로컬 pnpm 경로 진단 결과

## 확인 결과

- 기본 pnpm은 `C:\Program Files\nodejs\pnpm.ps1`이며 Corepack 래퍼다. 프로젝트에서는 pnpm 11.24.0이 실행된다.
- 기본 Node는 `C:\Program Files\nodejs\node.exe`의 v24.15.0이다. 프로젝트 요구사항 `>=24.18.1 <25`를 충족하지 못한다.
- `pnpm exec node -p 'process.execPath'` 실행 시 pnpm 내부의 설치 확인 과정에서 `ERR_PNPM_UNSUPPORTED_ENGINE`이 재현됐다.
- `C:\Users\TY\AppData\Local\pnpm\bin\pnpm.exe --version`은 `the global target of the pnpm shim points back at the shim` 오류로 실패한다. 이 설치본은 현재 프로세스 PATH에 없다.
- Codex fallback 래퍼는 별도 Node v24.19.0과 pnpm 11.19.0을 사용한다. pnpm 버전은 프로젝트 지정 버전과 다르다.
- Hermes Node v22.23.2도 존재한다. 현재 기본 Node보다 PATH 우선순위가 낮다.
- 사용자 pnpm 전역 `config.yaml`의 `globalShims` 설정은 기본 pnpm 11.24.0에서 인식되지 않아 경고가 발생한다.
- 사용자 PNPM_HOME은 설정되지 않았다.

## 권장 정리 방향

- 일반 개발용 Node를 프로젝트 요구사항에 맞는 24.x 버전으로 정렬하고, Corepack의 프로젝트 지정 pnpm 11.24.0을 사용한다.
- 사용자 pnpm 설치본은 자기 자신을 가리키는 shim 상태를 복구하기 전까지 PATH에 추가하지 않는다.
- 전역 globalShims 설정은 사용하는 pnpm 버전에 맞춰 정리한다.
- Codex 및 Hermes 번들 런타임은 해당 앱 용도이므로 일괄 삭제 대상으로 취급하지 않는다.

## 변경 범위

- 진단 문서만 추가했다. 시스템 설치본과 영구 PATH 및 전역 설정은 변경하지 않았다.
- 명령 실행 후 추적 파일 변경이 없음을 `git status --short`로 확인했다. 의존성 전체 설치나 빌드 검증은 수행하지 않았다.
