# Changelog

## [0.1.40](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.39...opera-browser-cli-v0.1.40) (2026-06-26)


### Bug Fixes

* **bridge:** add Host/Origin guard + per-instance bearer token to HTTP bridge ([a864cac](https://github.com/operasoftware/opera-browser-cli/commit/a864cac95b59a0809909ddd1411ec5225338b4fb))

## [0.1.36](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.35...opera-browser-cli-v0.1.36) (2026-06-10)


### Features

* chat model selector ([b018f3a](https://github.com/operasoftware/opera-browser-cli/commit/b018f3a27c19a38db1be88cf52a423f2edb5cb35))
* **cli:** add models command for listing available AI models ([09481c6](https://github.com/operasoftware/opera-browser-cli/commit/09481c60d840d6ab9276881e0bcb5f0c9e12980f))
* **cli:** add parseChatArgs for --model flag ([10c1b4f](https://github.com/operasoftware/opera-browser-cli/commit/10c1b4fa5a47b41246edb79041848c2304c12428))
* **cli:** wire --model flag into handleChat ([d322270](https://github.com/operasoftware/opera-browser-cli/commit/d322270d89c3332599b0fe761ecaac38539c2485))
* enhance transport arguments for external extension loading ([2892cce](https://github.com/operasoftware/opera-browser-cli/commit/2892cce9db480f4d05088044b2a486f86a19d9fa))
* enhance transport arguments for external extension loading ([6c68952](https://github.com/operasoftware/opera-browser-cli/commit/6c689524fd97f6eac0d17a1d0c027a1a43410d46))


### Bug Fixes

* **cli:** improve error handling for model listing response ([e6918a5](https://github.com/operasoftware/opera-browser-cli/commit/e6918a579cfdec28f832c401b3c1fd09fef571d9))
* suppress setup hint and ensure Chrome readiness in Docker setup ([48675b1](https://github.com/operasoftware/opera-browser-cli/commit/48675b1b312410cba837a816239cfbe31b63f445))

## [0.1.35](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.34...opera-browser-cli-v0.1.35) (2026-05-22)


### Features

* Add benchmark config for snapshotting single page ([3a58b59](https://github.com/operasoftware/opera-browser-cli/commit/3a58b598c74660706303ccb43ae8bcef9c12db8c))
* add benchmark configuration files ([a5cc1e8](https://github.com/operasoftware/opera-browser-cli/commit/a5cc1e898df1688e71ce3002a3050bbcf2385d9a))
* add benchmark report generation ([1770e5b](https://github.com/operasoftware/opera-browser-cli/commit/1770e5b16c6d2c29d0ec7472260163bbaa203cab))
* Add explicit --full option to agentic-use-benchmark ([6a45631](https://github.com/operasoftware/opera-browser-cli/commit/6a45631111d15bcbd5237e905f1bce9ac884752d))
* add python package for benchmarking ([4df1d09](https://github.com/operasoftware/opera-browser-cli/commit/4df1d091cb612f373619064a158806b4db3cd9af))
* add python package for benchmarking ([7ee028b](https://github.com/operasoftware/opera-browser-cli/commit/7ee028b7508ca92ec5e272b39ebc302993d05472))
* compact snapshot output with URL compression ([30f0e97](https://github.com/operasoftware/opera-browser-cli/commit/30f0e97c8900b2a056104fcb9c9295e1749569b4))
* compact snapshot output with URL compression ([2e27811](https://github.com/operasoftware/opera-browser-cli/commit/2e27811a4f6bd7f3b54b24723ad9b3f57d5d22fd))
* Update SKILL.md after token optimization ([5aa9f2f](https://github.com/operasoftware/opera-browser-cli/commit/5aa9f2fa2dd4f729d169bace09a3b970947ca9bf))


### Bug Fixes

* Add python safety check and verbose error handling ([37b7625](https://github.com/operasoftware/opera-browser-cli/commit/37b76257affd97ce0141e212f16d517bafa72f27))
* Error message readability fix ([3be0b73](https://github.com/operasoftware/opera-browser-cli/commit/3be0b73be1ed0dac7f1097e99cdfb518b72c24d9))
* Explicitly request open before snapshot in every mode ([b501288](https://github.com/operasoftware/opera-browser-cli/commit/b5012882d8e245218acc560c6525f3f091e0f52d))
* Fix linter issues after mv ([2d39628](https://github.com/operasoftware/opera-browser-cli/commit/2d39628c20906d1cea08b936bcb3c176f4ea101b))
* Fixes from review ([440542f](https://github.com/operasoftware/opera-browser-cli/commit/440542f0242e21be54b7c9bb8e05fe046bbc4fbb))
* Set devtools ports explicitly to avoid port collision ([be6a2fc](https://github.com/operasoftware/opera-browser-cli/commit/be6a2fc3b48633922ab688d7f2af9949cf05b535))
* strip whitespace from --conditions split ([485aa49](https://github.com/operasoftware/opera-browser-cli/commit/485aa49d0f3ba20a11c0db3085c621a4a4eec296))
* Update tasks for wikipedia extraction -&gt; year change from 2024 to 2025 ([6b012dd](https://github.com/operasoftware/opera-browser-cli/commit/6b012dde40bb446b494ef53c831648a9a31f7eb6))

## [0.1.34](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.33...opera-browser-cli-v0.1.34) (2026-05-20)


### Bug Fixes

* fixup! feat: detect port conflicts with foreign MCP servers ([2ae18ec](https://github.com/operasoftware/opera-browser-cli/commit/2ae18ec8160b90942dff1e72072b7c1986ca584f))

## [0.1.33](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.32...opera-browser-cli-v0.1.33) (2026-05-20)


### Features

* detect port conflicts with foreign MCP servers ([c8aa858](https://github.com/operasoftware/opera-browser-cli/commit/c8aa858c820c450034e32692bc666329ca3b85b0))


### Bug Fixes

* default open URL to https:// when no protocol is given ([0ff548f](https://github.com/operasoftware/opera-browser-cli/commit/0ff548f9fcec447d2efc9d4605d72adff64aeabd))

## [0.1.32](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.31...opera-browser-cli-v0.1.32) (2026-05-13)


### Features

* Bundle opera-devtools-mcp as a dependency. ([4932ea8](https://github.com/operasoftware/opera-browser-cli/commit/4932ea898cb92fde1aa3031062a5b2ada9ed3975))


### Bug Fixes

* Add setup nudge. ([8f40e44](https://github.com/operasoftware/opera-browser-cli/commit/8f40e446781c1aa2791fad36217c686ac015f9e0))
* Fix stale version in manifest. ([8be41ff](https://github.com/operasoftware/opera-browser-cli/commit/8be41fff4ea969950d337c6a347516268ffbca41))
* Updated docs to point to Neon. ([7d47fa0](https://github.com/operasoftware/opera-browser-cli/commit/7d47fa08aee18d008989a6ae981afb496e2ee9d1))

## [0.1.30](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.29...opera-browser-cli-v0.1.30) (2026-05-08)


### Features

* Bundle opera-devtools-mcp as a dependency. ([4932ea8](https://github.com/operasoftware/opera-browser-cli/commit/4932ea898cb92fde1aa3031062a5b2ada9ed3975))


### Bug Fixes

* Add setup nudge. ([8f40e44](https://github.com/operasoftware/opera-browser-cli/commit/8f40e446781c1aa2791fad36217c686ac015f9e0))
* Fix stale version in manifest. ([8be41ff](https://github.com/operasoftware/opera-browser-cli/commit/8be41fff4ea969950d337c6a347516268ffbca41))
* Updated docs to point to Neon. ([7d47fa0](https://github.com/operasoftware/opera-browser-cli/commit/7d47fa08aee18d008989a6ae981afb496e2ee9d1))

## [0.1.29](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.28...opera-browser-cli-v0.1.29) (2026-05-05)


### Features

* Bundle opera-devtools-mcp as a dependency. ([4932ea8](https://github.com/operasoftware/opera-browser-cli/commit/4932ea898cb92fde1aa3031062a5b2ada9ed3975))

## [0.1.28](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.27...opera-browser-cli-v0.1.28) (2026-05-04)


### Bug Fixes

* Add setup nudge. ([8f40e44](https://github.com/operasoftware/opera-browser-cli/commit/8f40e446781c1aa2791fad36217c686ac015f9e0))
* Fix stale version in manifest. ([8be41ff](https://github.com/operasoftware/opera-browser-cli/commit/8be41fff4ea969950d337c6a347516268ffbca41))
* Updated docs to point to Neon. ([7d47fa0](https://github.com/operasoftware/opera-browser-cli/commit/7d47fa08aee18d008989a6ae981afb496e2ee9d1))

## [0.1.15](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.14...opera-cli-v0.1.15) (2026-04-11)


### Features

* add BROWSER_URL and USER_DATA_DIR env vars for persistent sessions ([#30](https://github.com/kunchenguid/opera-cli/issues/30)) ([400fdda](https://github.com/kunchenguid/opera-cli/commit/400fddad94545a9b7e353dab57892b2351c8574c))

## [0.1.14](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.13...opera-cli-v0.1.14) (2026-04-10)


### Features

* add headed mode, custom Chrome args, and GPU docs ([#25](https://github.com/kunchenguid/opera-cli/issues/25)) ([a917c1a](https://github.com/kunchenguid/opera-cli/commit/a917c1af14b4e937f5f52bdb0d89e8a4eabe8948))

## [0.1.13](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.12...opera-cli-v0.1.13) (2026-04-10)


### Bug Fixes

* **homeview:** reduce verbosity in home view ([#26](https://github.com/kunchenguid/opera-cli/issues/26)) ([df709e9](https://github.com/kunchenguid/opera-cli/commit/df709e98f1e06e90226b1ba95d29981de8ff5c17))

## [0.1.12](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.11...opera-cli-v0.1.12) (2026-04-03)


### Features

* migrate CLI to axi-sdk-js ([#21](https://github.com/kunchenguid/opera-cli/issues/21)) ([257c953](https://github.com/kunchenguid/opera-cli/commit/257c953e101bb176e52c1eb874f46553dac67085))

## [0.1.11](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.10...opera-cli-v0.1.11) (2026-04-01)


### Bug Fixes

* **cli:** add metadata to home view ([#19](https://github.com/kunchenguid/opera-cli/issues/19)) ([8900215](https://github.com/kunchenguid/opera-cli/commit/8900215983f79915fc1d4527b620003a9b900f0b))

## [0.1.10](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.9...opera-cli-v0.1.10) (2026-04-01)


### Bug Fixes

* skip hook install for dev entrypoints ([#18](https://github.com/kunchenguid/opera-cli/issues/18)) ([b12e043](https://github.com/kunchenguid/opera-cli/commit/b12e043c731b66cf7246cb2fbd541dd70255bc39))
* trim no-session help text ([#16](https://github.com/kunchenguid/opera-cli/issues/16)) ([a6c9820](https://github.com/kunchenguid/opera-cli/commit/a6c9820798a5b466d6920592c68c52b60bc7e6a6))

## [0.1.9](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.8...opera-cli-v0.1.9) (2026-03-31)


### Bug Fixes

* **snapshot:** improve truncation handling ([#13](https://github.com/kunchenguid/opera-cli/issues/13)) ([7ebca68](https://github.com/kunchenguid/opera-cli/commit/7ebca6867ff9bd950f63bc8fad7efc7913ccdcd5))
* **snapshot:** skip truncation when marker adds overhead ([#15](https://github.com/kunchenguid/opera-cli/issues/15)) ([5ae7d62](https://github.com/kunchenguid/opera-cli/commit/5ae7d6230e7b9fab5ac83933c6f067202dcc7742))

## [0.1.8](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.7...opera-cli-v0.1.8) (2026-03-30)


### Bug Fixes

* **bridge:** handle exit and orphan cleanup ([#11](https://github.com/kunchenguid/opera-cli/issues/11)) ([ea32d9b](https://github.com/kunchenguid/opera-cli/commit/ea32d9b7fdc3f25da26e235e9f3677e5cbeee410))

## [0.1.7](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.6...opera-cli-v0.1.7) (2026-03-30)


### Bug Fixes

* **cli:** support function input in eval ([#9](https://github.com/kunchenguid/opera-cli/issues/9)) ([cb37c3d](https://github.com/kunchenguid/opera-cli/commit/cb37c3d9c04ed98ade1fa053574dbb2be18fcf98))

## [0.1.6](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.5...opera-cli-v0.1.6) (2026-03-30)


### Features

* **run-cmd:** add script runner command ([#7](https://github.com/kunchenguid/opera-cli/issues/7)) ([5361cc2](https://github.com/kunchenguid/opera-cli/commit/5361cc2d512beea2061b7511c9638308feb5abd2))


### Bug Fixes

* **hooks:** guard installHooks against unrelated execPath ([61c64e7](https://github.com/kunchenguid/opera-cli/commit/61c64e7ffe6abcdaab0ee07487d019a494ac6bbe))

## [0.1.5](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.4...opera-cli-v0.1.5) (2026-03-29)


### Bug Fixes

* code cleanup ([#5](https://github.com/kunchenguid/opera-cli/issues/5)) ([4c435fe](https://github.com/kunchenguid/opera-cli/commit/4c435fedf713bba367fc666520cab995c7e21740))

## [0.1.4](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.3...opera-cli-v0.1.4) (2026-03-28)


### Bug Fixes

* enable codex hooks in config.toml ([1c7a38a](https://github.com/kunchenguid/opera-cli/commit/1c7a38a6684edab81acf6ffcc831270792f7f191))

## [0.1.3](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.2...opera-cli-v0.1.3) (2026-03-28)


### Bug Fixes

* small correction in README ([73c4780](https://github.com/kunchenguid/opera-cli/commit/73c47806e56b3c1cc256e8c15bc88224637ebadd))

## [0.1.2](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.1...opera-cli-v0.1.2) (2026-03-28)


### Features

* **cli:** add --full flag and session hooks ([25c3f53](https://github.com/kunchenguid/opera-cli/commit/25c3f5300410c3144fba523f012a42ac454b139c))
* **cli:** add page management commands and tests ([32cc1f1](https://github.com/kunchenguid/opera-cli/commit/32cc1f1171d1ec05f3e98979d93522543a7f8c7c))

## [0.1.1](https://github.com/kunchenguid/opera-cli/compare/opera-cli-v0.1.0...opera-cli-v0.1.1) (2026-03-27)


### Features

* initial commit ([ac8389b](https://github.com/kunchenguid/opera-cli/commit/ac8389b7182a0a121b33589216b8eed60378c5f4))
