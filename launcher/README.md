# opera-browser-cli (compatibility launcher)

`opera-browser-cli` has moved into
[`opera-devtools-mcp`](https://github.com/operasoftware/opera-devtools-mcp),
which now ships both the MCP server and the `opera-browser-cli` command.

This version is a **launcher**: it keeps the package name and the bin name so
that the command you already run installs the new implementation —

```sh
npm i -g opera-browser-cli        # or: npm update -g opera-browser-cli
opera-browser-cli --version       # the new implementation's version
```

— and delegates every invocation to `opera-devtools-mcp`, installed as its
dependency. Nothing about the command line changes.

When you are ready to drop the launcher and keep only one global package:

```sh
npm i -g opera-devtools-mcp@0.9.0 opera-browser-cli@0.2.0
npm rm -g opera-browser-cli       # optional: drops the inert tombstone
```

or, in two steps:

```sh
npm rm -g opera-browser-cli
npm i -g opera-devtools-mcp@0.9.0
```

`opera-browser-cli --version` and `opera-browser-cli doctor` print the same
recipes whenever the CLI notices it was launched from here.

See
[`docs/npm-package-transition.md`](https://github.com/operasoftware/opera-devtools-mcp/blob/main/docs/npm-package-transition.md)
for the full transition, including what each release train publishes.