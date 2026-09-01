# Changelog

## [0.1.51](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.50...opera-browser-cli-v0.1.51) (2026-09-01)


### Features

* add --conversation-id to chat and CONVERSATION_NOT_FOUND error code ([#34](https://github.com/operasoftware/opera-browser-cli/issues/34)) ([62e51e2](https://github.com/operasoftware/opera-browser-cli/commit/62e51e206bdef0db8d8492e2e3d323eef739e6eb))


### Bug Fixes

* **bridge:** match headed mode on bridge discover ([#35](https://github.com/operasoftware/opera-browser-cli/issues/35)) ([15c7907](https://github.com/operasoftware/opera-browser-cli/commit/15c790766192b7b94023e8a7492b3e4ef54cc03b))

## [0.1.50](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.49...opera-browser-cli-v0.1.50) (2026-08-31)


### Features

* add MCP server lifecycle commands (mcp-add, mcp-auth, mcp-remove, mcp-enable, mcp-disable) ([ea2ae8f](https://github.com/operasoftware/opera-browser-cli/commit/ea2ae8f5f3be058467658ed77bf62cb6566970ff))
* add MCP server lifecycle commands (mcp-add, mcp-auth, mcp-remove, mcp-enable, mcp-disable) ([ac7719a](https://github.com/operasoftware/opera-browser-cli/commit/ac7719a698a50b79aff602d339999b173b426ef5))


### Bug Fixes

* require opera-devtools-mcp 0.5.0 for MCP server lifecycle commands ([84ef059](https://github.com/operasoftware/opera-browser-cli/commit/84ef0596310ef3e1dd72e6b4cc52a677826fa693))
* require opera-devtools-mcp 0.5.0 for MCP server lifecycle commands ([1f564e5](https://github.com/operasoftware/opera-browser-cli/commit/1f564e55bc1202efe6e6439a62d364ccce45cf2c))

## [0.1.49](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.48...opera-browser-cli-v0.1.49) (2026-08-24)


### Bug Fixes

* map isError tool results to HTTP 500 in bridge ([4bff7a1](https://github.com/operasoftware/opera-browser-cli/commit/4bff7a17d4b05f37c4e19bf46325611108228e6d))
* map isError tool results to HTTP 500 in bridge ([ef07da1](https://github.com/operasoftware/opera-browser-cli/commit/ef07da1eb36651891a7e92089cb8faa650a5b695))

## [0.1.48](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.47...opera-browser-cli-v0.1.48) (2026-08-19)


### Bug Fixes

* require opera-devtools-mcp 0.4.0 for MCP Hub support ([7e4cfb5](https://github.com/operasoftware/opera-browser-cli/commit/7e4cfb501ad0437b130ddece20f746998002a409))
* require opera-devtools-mcp 0.4.0 for MCP Hub support ([17a4c70](https://github.com/operasoftware/opera-browser-cli/commit/17a4c70cab07fe9186b04f24efe49c981dc3faed))

## [0.1.47](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.46...opera-browser-cli-v0.1.47) (2026-08-19)


### Features

* add MCP Hub CLI commands (mcp-servers, mcp-tools, mcp-call) ([9ec776d](https://github.com/operasoftware/opera-browser-cli/commit/9ec776d480864151f06f70d95a559678831bbc08))
* add MCP Hub CLI commands (mcp-servers, mcp-tools, mcp-call) ([d77dd84](https://github.com/operasoftware/opera-browser-cli/commit/d77dd843c672ec1de3deee91c928b137c4744195))

## [0.1.46](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.45...opera-browser-cli-v0.1.46) (2026-08-19)


### Bug Fixes

* harden the CLI so browser automation works without manual recovery ([12d57ac](https://github.com/operasoftware/opera-browser-cli/commit/12d57ac41fbe9090c00880d92de779f74f6562c2))
* harden bridge self-healing on dead browsers and condense the skill ([fded5e6](https://github.com/operasoftware/opera-browser-cli/commit/fded5e60ac3404cba807868648091f69b9e51a81))
* make `open` fail loudly rather than return a fake zero-ref page when the browser is unreachable ([a9fd83f](https://github.com/operasoftware/opera-browser-cli/commit/a9fd83fa74b10ee4178c8e70c7789ae4ad1b10f9))

## [0.1.45](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.44...opera-browser-cli-v0.1.45) (2026-08-19)


### Features

* Add benchmark config for snapshotting single page ([3a58b59](https://github.com/operasoftware/opera-browser-cli/commit/3a58b598c74660706303ccb43ae8bcef9c12db8c))
* add benchmark configuration files ([a5cc1e8](https://github.com/operasoftware/opera-browser-cli/commit/a5cc1e898df1688e71ce3002a3050bbcf2385d9a))
* add benchmark report generation ([1770e5b](https://github.com/operasoftware/opera-browser-cli/commit/1770e5b16c6d2c29d0ec7472260163bbaa203cab))
* Add explicit --full option to agentic-use-benchmark ([6a45631](https://github.com/operasoftware/opera-browser-cli/commit/6a45631111d15bcbd5237e905f1bce9ac884752d))
* add python package for benchmarking ([4df1d09](https://github.com/operasoftware/opera-browser-cli/commit/4df1d091cb612f373619064a158806b4db3cd9af))
* add python package for benchmarking ([7ee028b](https://github.com/operasoftware/opera-browser-cli/commit/7ee028b7508ca92ec5e272b39ebc302993d05472))
* Bundle opera-devtools-mcp as a dependency. ([4932ea8](https://github.com/operasoftware/opera-browser-cli/commit/4932ea898cb92fde1aa3031062a5b2ada9ed3975))
* chat model selector ([b018f3a](https://github.com/operasoftware/opera-browser-cli/commit/b018f3a27c19a38db1be88cf52a423f2edb5cb35))
* **cli:** add models command for listing available AI models ([09481c6](https://github.com/operasoftware/opera-browser-cli/commit/09481c60d840d6ab9276881e0bcb5f0c9e12980f))
* **cli:** add parseChatArgs for --model flag ([10c1b4f](https://github.com/operasoftware/opera-browser-cli/commit/10c1b4fa5a47b41246edb79041848c2304c12428))
* **cli:** wire --model flag into handleChat ([d322270](https://github.com/operasoftware/opera-browser-cli/commit/d322270d89c3332599b0fe761ecaac38539c2485))
* compact snapshot output with URL compression ([30f0e97](https://github.com/operasoftware/opera-browser-cli/commit/30f0e97c8900b2a056104fcb9c9295e1749569b4))
* compact snapshot output with URL compression ([2e27811](https://github.com/operasoftware/opera-browser-cli/commit/2e27811a4f6bd7f3b54b24723ad9b3f57d5d22fd))
* detect port conflicts with foreign MCP servers ([c8aa858](https://github.com/operasoftware/opera-browser-cli/commit/c8aa858c820c450034e32692bc666329ca3b85b0))
* enhance transport arguments for external extension loading ([2892cce](https://github.com/operasoftware/opera-browser-cli/commit/2892cce9db480f4d05088044b2a486f86a19d9fa))
* enhance transport arguments for external extension loading ([6c68952](https://github.com/operasoftware/opera-browser-cli/commit/6c689524fd97f6eac0d17a1d0c027a1a43410d46))
* install skill to claude, codex, and generic agent dirs on setup ([5e155ef](https://github.com/operasoftware/opera-browser-cli/commit/5e155ef272a95e9843edd46e22b60bcea824bdde))
* Update SKILL.md after token optimization ([5aa9f2f](https://github.com/operasoftware/opera-browser-cli/commit/5aa9f2fa2dd4f729d169bace09a3b970947ca9bf))


### Bug Fixes

* Add python safety check and verbose error handling ([37b7625](https://github.com/operasoftware/opera-browser-cli/commit/37b76257affd97ce0141e212f16d517bafa72f27))
* Add setup nudge. ([8f40e44](https://github.com/operasoftware/opera-browser-cli/commit/8f40e446781c1aa2791fad36217c686ac015f9e0))
* **bridge:** add Host/Origin guard + bearer token to HTTP bridge ([109c042](https://github.com/operasoftware/opera-browser-cli/commit/109c0421e28e9b83b832bfc7b6c30ac34c1a2699))
* **bridge:** add Host/Origin guard + bearer token to HTTP bridge ([a864cac](https://github.com/operasoftware/opera-browser-cli/commit/a864cac95b59a0809909ddd1411ec5225338b4fb))
* **cli:** improve error handling for model listing response ([e6918a5](https://github.com/operasoftware/opera-browser-cli/commit/e6918a579cfdec28f832c401b3c1fd09fef571d9))
* default open URL to https:// when no protocol is given ([0ff548f](https://github.com/operasoftware/opera-browser-cli/commit/0ff548f9fcec447d2efc9d4605d72adff64aeabd))
* do not truncate Neon AI tool output (chat, do, make, research) ([a7bee3d](https://github.com/operasoftware/opera-browser-cli/commit/a7bee3db415116108e00f563c9b3dee79bf370e7))
* Error message readability fix ([3be0b73](https://github.com/operasoftware/opera-browser-cli/commit/3be0b73be1ed0dac7f1097e99cdfb518b72c24d9))
* exclude openclaw/.env from npm package ([0ab08c2](https://github.com/operasoftware/opera-browser-cli/commit/0ab08c29eb61fbf66548d318b8287e2f1175f189))
* Explicitly request open before snapshot in every mode ([b501288](https://github.com/operasoftware/opera-browser-cli/commit/b5012882d8e245218acc560c6525f3f091e0f52d))
* Fix linter issues after mv ([2d39628](https://github.com/operasoftware/opera-browser-cli/commit/2d39628c20906d1cea08b936bcb3c176f4ea101b))
* Fix stale version in manifest. ([8be41ff](https://github.com/operasoftware/opera-browser-cli/commit/8be41fff4ea969950d337c6a347516268ffbca41))
* Fixes from review ([440542f](https://github.com/operasoftware/opera-browser-cli/commit/440542f0242e21be54b7c9bb8e05fe046bbc4fbb))
* fixup! feat: detect port conflicts with foreign MCP servers ([2ae18ec](https://github.com/operasoftware/opera-browser-cli/commit/2ae18ec8160b90942dff1e72072b7c1986ca584f))
* Set devtools ports explicitly to avoid port collision ([be6a2fc](https://github.com/operasoftware/opera-browser-cli/commit/be6a2fc3b48633922ab688d7f2af9949cf05b535))
* strip whitespace from --conditions split ([485aa49](https://github.com/operasoftware/opera-browser-cli/commit/485aa49d0f3ba20a11c0db3085c621a4a4eec296))
* suppress setup hint and ensure Chrome readiness in Docker setup ([48675b1](https://github.com/operasoftware/opera-browser-cli/commit/48675b1b312410cba837a816239cfbe31b63f445))
* Update tasks for wikipedia extraction -&gt; year change from 2024 to 2025 ([6b012dd](https://github.com/operasoftware/opera-browser-cli/commit/6b012dde40bb446b494ef53c831648a9a31f7eb6))
* Updated docs to point to Neon. ([7d47fa0](https://github.com/operasoftware/opera-browser-cli/commit/7d47fa08aee18d008989a6ae981afb496e2ee9d1))


## [0.1.44](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.43...opera-browser-cli-v0.1.44) (2026-08-06)


### Miscellaneous Chores

* install skill via generic ~/.agents path instead of codex dir ([5fb4da7](https://github.com/operasoftware/opera-browser-cli/commit/5fb4da739e4c8b5cf4f2a05f6746156b7e3c0ff0))

## [0.1.43](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.42...opera-browser-cli-v0.1.43) (2026-08-06)


### Features

* install skill to Claude, Codex, and generic agent skill dirs on setup ([5e155ef](https://github.com/operasoftware/opera-browser-cli/commit/5e155ef))

## [0.1.42](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.41...opera-browser-cli-v0.1.42) (2026-08-06)


### Bug Fixes

* do not truncate Neon AI tool output (chat, do, make, research) ([5a853f1](https://github.com/operasoftware/opera-browser-cli/commit/5a853f1ca05c7f89c1b2dbfbe4c1910c0326c9c7))

## [0.1.37](https://github.com/operasoftware/opera-browser-cli/compare/opera-browser-cli-v0.1.36...opera-browser-cli-v0.1.37) (2026-08-05)


### Bug Fixes

* **bridge:** add Host/Origin guard + bearer token to HTTP bridge ([109c042](https://github.com/operasoftware/opera-browser-cli/commit/109c0421e28e9b83b832bfc7b6c30ac34c1a2699))
* **bridge:** add Host/Origin guard + bearer token to HTTP bridge ([a864cac](https://github.com/operasoftware/opera-browser-cli/commit/a864cac95b59a0809909ddd1411ec5225338b4fb))
* exclude openclaw/.env from npm package ([0ab08c2](https://github.com/operasoftware/opera-browser-cli/commit/0ab08c29eb61fbf66548d318b8287e2f1175f189))

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
