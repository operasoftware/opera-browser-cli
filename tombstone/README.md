# opera-browser-cli is retired

The CLI lives in
[`opera-devtools-mcp`](https://github.com/operasoftware/opera-devtools-mcp)
now — one package provides both the MCP server and the `opera-browser-cli`
command.

```sh
npm rm -g opera-browser-cli
npm i -g opera-devtools-mcp@latest
```

If you installed `opera-browser-cli@0.1.55`, that version was a **launcher**: it
kept the package name so the command you already run delivered the new
implementation, and it delegated every invocation to `opera-devtools-mcp`.

This version (`0.2.0`) is the tombstone that retires the launcher. It has no
bin and no dependencies; installing it is what lets npm unlink the launcher's
global binstub on a same-name upgrade, which is the only way npm removes a
foreign binstub without `--force`. Installing it *together with* the new MCP
package does the whole move in one command:

```sh
npm i -g opera-devtools-mcp@0.9.0 opera-browser-cli@0.2.0
npm rm -g opera-browser-cli       # optional: drops this inert package
```

`opera-browser-cli --version` and `opera-browser-cli doctor` print both recipes
whenever the CLI notices it was launched by the launcher.