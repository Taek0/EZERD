# 패키지 버전 전체 목록

이 파일은 `pnpm docs:versions`로 생성합니다. 의존성 설치·변경 후 다시 실행하고 함께 커밋합니다.

- 기준 lockfile: `pnpm-lock.yaml` (형식 9.0)
- lockfile SHA-256: `34d9ca9a39377e0512f28c3b249ceae1f725057984687ad73121cf54d9d0d690`
- 전체 잠금 항목: **345개** (패키지명 + 버전 기준, OS별 선택 의존성 포함)
- 설치 표시: 현재 PC에서 `pnpm list --recursive --depth Infinity --json`으로 확인한 의존성 그래프 기준. 다른 OS에서는 달라질 수 있습니다.

## 직접 의존성과 내부 패키지

### ezerd · 0.1.0

정의: [package.json](../package.json)

| 패키지 | 고정 버전 / 연결 규칙 | 구분 |
| --- | --- | --- |
| `@types/node` | `24.13.4` | 개발 |
| `concurrently` | `10.0.5` | 개발 |
| `typescript` | `6.0.3` | 개발 |
| `vitest` | `5.0.0` | 개발 |

### @ezerd/web · 0.1.0

정의: [apps/web/package.json](../apps/web/package.json)

| 패키지 | 고정 버전 / 연결 규칙 | 구분 |
| --- | --- | --- |
| `@ezerd/contracts` | `workspace:*` | 내부 패키지 연결 |
| `@ezerd/model` | `workspace:*` | 내부 패키지 연결 |
| `react` | `19.3.0` | 실행 |
| `react-aria-components` | `1.21.1` | 실행 |
| `react-dom` | `19.3.0` | 실행 |
| `tailwind-merge` | `3.7.0` | 실행 |
| `@tailwindcss/vite` | `4.3.3` | 개발 |
| `@types/react` | `19.3.0` | 개발 |
| `@types/react-dom` | `19.3.0` | 개발 |
| `@vitejs/plugin-react` | `6.1.1` | 개발 |
| `tailwindcss` | `4.3.3` | 개발 |
| `vite` | `8.3.0` | 개발 |

### @ezerd/server · 0.1.0

정의: [apps/server/package.json](../apps/server/package.json)

| 패키지 | 고정 버전 / 연결 규칙 | 구분 |
| --- | --- | --- |
| `@ezerd/contracts` | `workspace:*` | 내부 패키지 연결 |
| `@ezerd/model` | `workspace:*` | 내부 패키지 연결 |
| `@nestjs/common` | `12.0.1` | 실행 |
| `@nestjs/core` | `12.0.1` | 실행 |
| `@nestjs/platform-express` | `12.0.1` | 실행 |
| `dotenv` | `17.4.2` | 실행 |
| `drizzle-orm` | `0.45.2` | 실행 |
| `pg` | `8.23.0` | 실행 |
| `reflect-metadata` | `0.2.2` | 실행 |
| `rxjs` | `7.8.2` | 실행 |
| `zod` | `4.6.5` | 실행 |
| `@types/pg` | `8.23.1` | 개발 |
| `drizzle-kit` | `0.31.10` | 개발 |
| `tsx` | `4.23.13` | 개발 |

### @ezerd/model · 0.1.0

정의: [packages/model/package.json](../packages/model/package.json)

| 패키지 | 고정 버전 / 연결 규칙 | 구분 |
| --- | --- | --- |
| 외부 직접 의존성 없음 | — | 루트 개발 도구 사용 |

### @ezerd/contracts · 0.1.0

정의: [packages/contracts/package.json](../packages/contracts/package.json)

| 패키지 | 고정 버전 / 연결 규칙 | 구분 |
| --- | --- | --- |
| `zod` | `4.6.5` | 실행 |

## 전체 잠금 버전

동일 패키지의 여러 버전은 별도 행으로 기록합니다. peer 의존성 조합과 무결성 해시는 원본 lockfile에서 확인합니다.

| 패키지 | 버전 | 현재 설치 그래프 |
| --- | --- | --- |
| `@borewit/text-codec` | `0.2.2` | 확인 |
| `@drizzle-team/brocli` | `0.10.2` | 확인 |
| `@esbuild-kit/core-utils` | `3.3.2` | 확인 |
| `@esbuild-kit/esm-loader` | `2.6.5` | 확인 |
| `@esbuild/aix-ppc64` | `0.25.12` | 확인 |
| `@esbuild/aix-ppc64` | `0.28.2` | 확인 |
| `@esbuild/android-arm64` | `0.18.20` | 확인 |
| `@esbuild/android-arm64` | `0.25.12` | 확인 |
| `@esbuild/android-arm64` | `0.28.2` | 확인 |
| `@esbuild/android-arm` | `0.18.20` | 확인 |
| `@esbuild/android-arm` | `0.25.12` | 확인 |
| `@esbuild/android-arm` | `0.28.2` | 확인 |
| `@esbuild/android-x64` | `0.18.20` | 확인 |
| `@esbuild/android-x64` | `0.25.12` | 확인 |
| `@esbuild/android-x64` | `0.28.2` | 확인 |
| `@esbuild/darwin-arm64` | `0.18.20` | 확인 |
| `@esbuild/darwin-arm64` | `0.25.12` | 확인 |
| `@esbuild/darwin-arm64` | `0.28.2` | 확인 |
| `@esbuild/darwin-x64` | `0.18.20` | 확인 |
| `@esbuild/darwin-x64` | `0.25.12` | 확인 |
| `@esbuild/darwin-x64` | `0.28.2` | 확인 |
| `@esbuild/freebsd-arm64` | `0.18.20` | 확인 |
| `@esbuild/freebsd-arm64` | `0.25.12` | 확인 |
| `@esbuild/freebsd-arm64` | `0.28.2` | 확인 |
| `@esbuild/freebsd-x64` | `0.18.20` | 확인 |
| `@esbuild/freebsd-x64` | `0.25.12` | 확인 |
| `@esbuild/freebsd-x64` | `0.28.2` | 확인 |
| `@esbuild/linux-arm64` | `0.18.20` | 확인 |
| `@esbuild/linux-arm64` | `0.25.12` | 확인 |
| `@esbuild/linux-arm64` | `0.28.2` | 확인 |
| `@esbuild/linux-arm` | `0.18.20` | 확인 |
| `@esbuild/linux-arm` | `0.25.12` | 확인 |
| `@esbuild/linux-arm` | `0.28.2` | 확인 |
| `@esbuild/linux-ia32` | `0.18.20` | 확인 |
| `@esbuild/linux-ia32` | `0.25.12` | 확인 |
| `@esbuild/linux-ia32` | `0.28.2` | 확인 |
| `@esbuild/linux-loong64` | `0.18.20` | 확인 |
| `@esbuild/linux-loong64` | `0.25.12` | 확인 |
| `@esbuild/linux-loong64` | `0.28.2` | 확인 |
| `@esbuild/linux-mips64el` | `0.18.20` | 확인 |
| `@esbuild/linux-mips64el` | `0.25.12` | 확인 |
| `@esbuild/linux-mips64el` | `0.28.2` | 확인 |
| `@esbuild/linux-ppc64` | `0.18.20` | 확인 |
| `@esbuild/linux-ppc64` | `0.25.12` | 확인 |
| `@esbuild/linux-ppc64` | `0.28.2` | 확인 |
| `@esbuild/linux-riscv64` | `0.18.20` | 확인 |
| `@esbuild/linux-riscv64` | `0.25.12` | 확인 |
| `@esbuild/linux-riscv64` | `0.28.2` | 확인 |
| `@esbuild/linux-s390x` | `0.18.20` | 확인 |
| `@esbuild/linux-s390x` | `0.25.12` | 확인 |
| `@esbuild/linux-s390x` | `0.28.2` | 확인 |
| `@esbuild/linux-x64` | `0.18.20` | 확인 |
| `@esbuild/linux-x64` | `0.25.12` | 확인 |
| `@esbuild/linux-x64` | `0.28.2` | 확인 |
| `@esbuild/netbsd-arm64` | `0.25.12` | 확인 |
| `@esbuild/netbsd-arm64` | `0.28.2` | 확인 |
| `@esbuild/netbsd-x64` | `0.18.20` | 확인 |
| `@esbuild/netbsd-x64` | `0.25.12` | 확인 |
| `@esbuild/netbsd-x64` | `0.28.2` | 확인 |
| `@esbuild/openbsd-arm64` | `0.25.12` | 확인 |
| `@esbuild/openbsd-arm64` | `0.28.2` | 확인 |
| `@esbuild/openbsd-x64` | `0.18.20` | 확인 |
| `@esbuild/openbsd-x64` | `0.25.12` | 확인 |
| `@esbuild/openbsd-x64` | `0.28.2` | 확인 |
| `@esbuild/openharmony-arm64` | `0.25.12` | 확인 |
| `@esbuild/openharmony-arm64` | `0.28.2` | 확인 |
| `@esbuild/sunos-x64` | `0.18.20` | 확인 |
| `@esbuild/sunos-x64` | `0.25.12` | 확인 |
| `@esbuild/sunos-x64` | `0.28.2` | 확인 |
| `@esbuild/win32-arm64` | `0.18.20` | 확인 |
| `@esbuild/win32-arm64` | `0.25.12` | 확인 |
| `@esbuild/win32-arm64` | `0.28.2` | 확인 |
| `@esbuild/win32-ia32` | `0.18.20` | 확인 |
| `@esbuild/win32-ia32` | `0.25.12` | 확인 |
| `@esbuild/win32-ia32` | `0.28.2` | 확인 |
| `@esbuild/win32-x64` | `0.18.20` | 확인 |
| `@esbuild/win32-x64` | `0.25.12` | 확인 |
| `@esbuild/win32-x64` | `0.28.2` | 확인 |
| `@internationalized/date` | `3.12.4` | 확인 |
| `@internationalized/number` | `3.6.8` | 확인 |
| `@internationalized/string` | `3.2.10` | 확인 |
| `@jridgewell/gen-mapping` | `0.3.13` | 확인 |
| `@jridgewell/remapping` | `2.3.5` | 확인 |
| `@jridgewell/resolve-uri` | `3.1.2` | 확인 |
| `@jridgewell/sourcemap-codec` | `1.6.0` | 확인 |
| `@jridgewell/trace-mapping` | `0.3.31` | 확인 |
| `@lukeed/csprng` | `1.1.0` | 확인 |
| `@nestjs/common` | `12.0.1` | 확인 |
| `@nestjs/core` | `12.0.1` | 확인 |
| `@nestjs/platform-express` | `12.0.1` | 확인 |
| `@oxc-project/types` | `0.149.0` | 확인 |
| `@react-types/shared` | `3.36.1` | 확인 |
| `@rolldown/binding-android-arm-eabi` | `1.2.8` | 확인 |
| `@rolldown/binding-android-arm64` | `1.2.8` | 확인 |
| `@rolldown/binding-darwin-arm64` | `1.2.8` | 확인 |
| `@rolldown/binding-darwin-x64` | `1.2.8` | 확인 |
| `@rolldown/binding-freebsd-x64` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-arm-gnueabihf` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-arm64-gnu` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-arm64-musl` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-ppc64-gnu` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-s390x-gnu` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-x64-gnu` | `1.2.8` | 확인 |
| `@rolldown/binding-linux-x64-musl` | `1.2.8` | 확인 |
| `@rolldown/binding-openharmony-arm64` | `1.2.8` | 확인 |
| `@rolldown/binding-win32-arm64-msvc` | `1.2.8` | 확인 |
| `@rolldown/binding-win32-x64-msvc` | `1.2.8` | 확인 |
| `@rolldown/pluginutils` | `1.0.1` | 확인 |
| `@standard-schema/spec` | `1.1.0` | 확인 |
| `@swc/helpers` | `0.5.23` | 확인 |
| `@tailwindcss/node` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-android-arm64` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-darwin-arm64` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-darwin-x64` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-freebsd-x64` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-linux-arm-gnueabihf` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-linux-arm64-gnu` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-linux-arm64-musl` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-linux-x64-gnu` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-linux-x64-musl` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-wasm32-wasi` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-win32-arm64-msvc` | `4.3.3` | 확인 |
| `@tailwindcss/oxide-win32-x64-msvc` | `4.3.3` | 확인 |
| `@tailwindcss/oxide` | `4.3.3` | 확인 |
| `@tailwindcss/vite` | `4.3.3` | 확인 |
| `@tokenizer/inflate` | `0.4.1` | 확인 |
| `@tokenizer/token` | `0.3.0` | 확인 |
| `@types/chai` | `5.2.3` | 확인 |
| `@types/deep-eql` | `4.0.2` | 확인 |
| `@types/estree` | `1.0.9` | 확인 |
| `@types/node` | `24.13.4` | 확인 |
| `@types/pg` | `8.23.1` | 확인 |
| `@types/react-dom` | `19.3.0` | 확인 |
| `@types/react` | `19.3.0` | 확인 |
| `@vitejs/plugin-react` | `6.1.1` | 확인 |
| `@vitest/mocker` | `5.0.0` | 확인 |
| `@vitest/spy` | `5.0.0` | 확인 |
| `accepts` | `2.0.0` | 확인 |
| `ansi-regex` | `6.3.0` | 확인 |
| `ansi-styles` | `6.2.3` | 확인 |
| `append-field` | `1.0.0` | 확인 |
| `aria-hidden` | `1.2.6` | 확인 |
| `assertion-error` | `2.0.1` | 확인 |
| `body-parser` | `2.3.0` | 확인 |
| `buffer-from` | `1.1.2` | 확인 |
| `busboy` | `1.6.0` | 확인 |
| `bytes` | `3.1.2` | 확인 |
| `call-bind-apply-helpers` | `1.0.2` | 확인 |
| `call-bound` | `1.0.4` | 확인 |
| `chai` | `6.2.2` | 확인 |
| `chalk` | `5.6.2` | 확인 |
| `client-only` | `0.0.1` | 확인 |
| `cliui` | `9.0.1` | 확인 |
| `clsx` | `2.1.1` | 확인 |
| `concat-stream` | `2.0.0` | 확인 |
| `concurrently` | `10.0.5` | 확인 |
| `content-disposition` | `1.1.0` | 확인 |
| `content-type` | `1.0.5` | 확인 |
| `content-type` | `2.1.0` | 확인 |
| `cookie-signature` | `1.2.2` | 확인 |
| `cookie` | `0.7.2` | 확인 |
| `cors` | `2.8.6` | 확인 |
| `csstype` | `3.2.3` | 확인 |
| `debug` | `4.4.3` | 확인 |
| `depd` | `2.0.0` | 확인 |
| `detect-libc` | `2.1.2` | 확인 |
| `dotenv` | `17.4.2` | 확인 |
| `drizzle-kit` | `0.31.10` | 확인 |
| `drizzle-orm` | `0.45.2` | 확인 |
| `dunder-proto` | `1.0.1` | 확인 |
| `ee-first` | `1.1.1` | 확인 |
| `emoji-regex` | `10.6.0` | 확인 |
| `encodeurl` | `2.0.0` | 확인 |
| `enhanced-resolve` | `5.25.0` | 확인 |
| `es-define-property` | `1.0.1` | 확인 |
| `es-errors` | `1.3.0` | 확인 |
| `es-module-lexer` | `2.3.2` | 확인 |
| `es-object-atoms` | `1.1.2` | 확인 |
| `esbuild` | `0.18.20` | 확인 |
| `esbuild` | `0.25.12` | 확인 |
| `esbuild` | `0.28.2` | 확인 |
| `escalade` | `3.2.0` | 확인 |
| `escape-html` | `1.0.3` | 확인 |
| `estree-walker` | `3.0.3` | 확인 |
| `etag` | `1.8.1` | 확인 |
| `expect-type` | `1.4.0` | 확인 |
| `express` | `5.2.1` | 확인 |
| `fast-safe-stringify` | `2.1.1` | 확인 |
| `fdir` | `6.5.0` | 확인 |
| `file-type` | `22.0.2` | 확인 |
| `finalhandler` | `2.1.1` | 확인 |
| `forwarded` | `0.2.0` | 확인 |
| `fresh` | `2.0.0` | 확인 |
| `fsevents` | `2.3.3` | 확인 |
| `function-bind` | `1.1.2` | 확인 |
| `get-caller-file` | `2.0.5` | 확인 |
| `get-east-asian-width` | `1.6.0` | 확인 |
| `get-intrinsic` | `1.3.0` | 확인 |
| `get-proto` | `1.0.1` | 확인 |
| `get-tsconfig` | `4.14.3` | 확인 |
| `gopd` | `1.2.0` | 확인 |
| `graceful-fs` | `4.2.11` | 확인 |
| `has-symbols` | `1.1.0` | 확인 |
| `hasown` | `2.0.4` | 확인 |
| `http-errors` | `2.0.1` | 확인 |
| `iconv-lite` | `0.7.3` | 확인 |
| `ieee754` | `1.2.1` | 확인 |
| `inherits` | `2.0.4` | 확인 |
| `ipaddr.js` | `1.9.1` | 확인 |
| `is-promise` | `4.0.0` | 확인 |
| `iterare` | `1.2.1` | 확인 |
| `jiti` | `2.7.0` | 확인 |
| `lightningcss-android-arm64` | `1.32.0` | 확인 |
| `lightningcss-android-arm64` | `1.33.0` | 확인 |
| `lightningcss-darwin-arm64` | `1.32.0` | 확인 |
| `lightningcss-darwin-arm64` | `1.33.0` | 확인 |
| `lightningcss-darwin-x64` | `1.32.0` | 확인 |
| `lightningcss-darwin-x64` | `1.33.0` | 확인 |
| `lightningcss-freebsd-x64` | `1.32.0` | 확인 |
| `lightningcss-freebsd-x64` | `1.33.0` | 확인 |
| `lightningcss-linux-arm-gnueabihf` | `1.32.0` | 확인 |
| `lightningcss-linux-arm-gnueabihf` | `1.33.0` | 확인 |
| `lightningcss-linux-arm64-gnu` | `1.32.0` | 확인 |
| `lightningcss-linux-arm64-gnu` | `1.33.0` | 확인 |
| `lightningcss-linux-arm64-musl` | `1.32.0` | 확인 |
| `lightningcss-linux-arm64-musl` | `1.33.0` | 확인 |
| `lightningcss-linux-x64-gnu` | `1.32.0` | 확인 |
| `lightningcss-linux-x64-gnu` | `1.33.0` | 확인 |
| `lightningcss-linux-x64-musl` | `1.32.0` | 확인 |
| `lightningcss-linux-x64-musl` | `1.33.0` | 확인 |
| `lightningcss-win32-arm64-msvc` | `1.32.0` | 확인 |
| `lightningcss-win32-arm64-msvc` | `1.33.0` | 확인 |
| `lightningcss-win32-x64-msvc` | `1.32.0` | 확인 |
| `lightningcss-win32-x64-msvc` | `1.33.0` | 확인 |
| `lightningcss` | `1.32.0` | 확인 |
| `lightningcss` | `1.33.0` | 확인 |
| `load-esm` | `1.0.3` | 확인 |
| `magic-string` | `0.30.21` | 확인 |
| `magic-string` | `1.3.1` | 확인 |
| `math-intrinsics` | `1.1.0` | 확인 |
| `media-typer` | `0.3.0` | 확인 |
| `media-typer` | `1.1.1` | 확인 |
| `merge-descriptors` | `2.0.0` | 확인 |
| `mime-db` | `1.52.0` | 확인 |
| `mime-db` | `1.54.0` | 확인 |
| `mime-types` | `2.1.35` | 확인 |
| `mime-types` | `3.0.2` | 확인 |
| `ms` | `2.1.3` | 확인 |
| `multer` | `2.2.0` | 확인 |
| `nanoid` | `3.3.19` | 확인 |
| `negotiator` | `1.1.0` | 확인 |
| `object-assign` | `4.1.1` | 확인 |
| `object-inspect` | `1.13.4` | 확인 |
| `obug` | `2.2.1` | 확인 |
| `on-finished` | `2.4.1` | 확인 |
| `once` | `1.4.0` | 확인 |
| `parseurl` | `1.3.3` | 확인 |
| `path-to-regexp` | `8.4.2` | 확인 |
| `pg-cloudflare` | `1.4.0` | 확인 |
| `pg-connection-string` | `2.14.0` | 확인 |
| `pg-int8` | `1.0.1` | 확인 |
| `pg-pool` | `3.14.0` | 확인 |
| `pg-protocol` | `1.16.0` | 확인 |
| `pg-types` | `2.2.0` | 확인 |
| `pg` | `8.23.0` | 확인 |
| `pgpass` | `1.0.5` | 확인 |
| `picocolors` | `1.1.1` | 확인 |
| `picomatch` | `4.0.7` | 확인 |
| `postcss` | `8.5.28` | 확인 |
| `postgres-array` | `2.0.0` | 확인 |
| `postgres-bytea` | `1.0.1` | 확인 |
| `postgres-date` | `1.0.7` | 확인 |
| `postgres-interval` | `1.2.0` | 확인 |
| `proxy-addr` | `2.0.7` | 확인 |
| `qs` | `6.16.0` | 확인 |
| `range-parser` | `1.3.0` | 확인 |
| `raw-body` | `3.0.2` | 확인 |
| `react-aria-components` | `1.21.1` | 확인 |
| `react-aria` | `3.52.1` | 확인 |
| `react-dom` | `19.3.0` | 확인 |
| `react-stately` | `3.50.0` | 확인 |
| `react` | `19.3.0` | 확인 |
| `readable-stream` | `3.6.2` | 확인 |
| `reflect-metadata` | `0.2.2` | 확인 |
| `resolve-pkg-maps` | `1.0.0` | 확인 |
| `rolldown` | `1.2.8` | 확인 |
| `router` | `2.2.0` | 확인 |
| `rxjs` | `7.8.2` | 확인 |
| `safe-buffer` | `5.2.1` | 확인 |
| `safer-buffer` | `2.1.2` | 확인 |
| `scheduler` | `0.28.0` | 확인 |
| `send` | `1.2.1` | 확인 |
| `serve-static` | `2.2.1` | 확인 |
| `setprototypeof` | `1.2.0` | 확인 |
| `shell-quote` | `1.9.0` | 확인 |
| `side-channel-list` | `1.0.1` | 확인 |
| `side-channel-map` | `1.0.1` | 확인 |
| `side-channel-weakmap` | `1.0.2` | 확인 |
| `side-channel` | `1.1.1` | 확인 |
| `siginfo` | `2.0.0` | 확인 |
| `source-map-js` | `1.2.1` | 확인 |
| `source-map-support` | `0.5.21` | 확인 |
| `source-map` | `0.6.1` | 확인 |
| `split2` | `4.2.0` | 확인 |
| `stackback` | `0.0.2` | 확인 |
| `statuses` | `2.0.2` | 확인 |
| `std-env` | `4.2.0` | 확인 |
| `streamsearch` | `1.1.0` | 확인 |
| `string-width` | `7.2.0` | 확인 |
| `string_decoder` | `1.3.0` | 확인 |
| `strip-ansi` | `7.2.0` | 확인 |
| `strtok3` | `10.3.5` | 확인 |
| `supports-color` | `10.2.2` | 확인 |
| `tailwind-merge` | `3.7.0` | 확인 |
| `tailwindcss` | `4.3.3` | 확인 |
| `tapable` | `2.3.3` | 확인 |
| `tinybench` | `6.1.4` | 확인 |
| `tinyexec` | `1.3.0` | 확인 |
| `tinyglobby` | `0.2.17` | 확인 |
| `toidentifier` | `1.0.1` | 확인 |
| `token-types` | `6.1.2` | 확인 |
| `tree-kill` | `1.2.2` | 확인 |
| `tslib` | `2.8.1` | 확인 |
| `tsx` | `4.23.13` | 확인 |
| `type-is` | `1.6.18` | 확인 |
| `type-is` | `2.1.0` | 확인 |
| `typedarray` | `0.0.6` | 확인 |
| `typescript` | `6.0.3` | 확인 |
| `uid` | `2.0.2` | 확인 |
| `uint8array-extras` | `1.5.0` | 확인 |
| `undici-types` | `7.18.2` | 확인 |
| `unpipe` | `1.0.0` | 확인 |
| `use-sync-external-store` | `1.7.0` | 확인 |
| `util-deprecate` | `1.0.2` | 확인 |
| `vary` | `1.1.2` | 확인 |
| `vite` | `8.3.0` | 확인 |
| `vitest` | `5.0.0` | 확인 |
| `why-is-node-running` | `2.3.0` | 확인 |
| `wrap-ansi` | `9.0.2` | 확인 |
| `wrappy` | `1.0.2` | 확인 |
| `xtend` | `4.0.2` | 확인 |
| `y18n` | `5.0.8` | 확인 |
| `yargs-parser` | `22.0.0` | 확인 |
| `yargs` | `18.0.0` | 확인 |
| `zod` | `4.6.5` | 확인 |
