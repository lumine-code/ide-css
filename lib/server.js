const fs = require("fs");
const path = require("path");

// Where the editor can fetch a newer server than the one this package pins.
//
// An upgrade tier, not the only way in: the dependency below is always present,
// so uninstalling drops back to it and can never leave the user with nothing.
exports.managedServer = {
  source: "npm",
  displayName: "CSS Language Server",
  packages: ["vscode-langservers-extracted"],
  module: "node_modules/vscode-langservers-extracted/bin/vscode-css-language-server",
  bundled: true,
};

exports.resolveServer = async (configuredPath, managed = null) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["--stdio"] };
  }

  // A copy the user asked the editor to install wins over the pinned one; both
  // are launched the same way, and every one of these entry points resolves
  // everything it needs relative to its own location.
  const serverModule =
    managed?.modulePath ||
    require.resolve("vscode-langservers-extracted/bin/vscode-css-language-server");
  return {
    command: process.execPath,
    args: [serverModule, "--stdio"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    version: managed?.version,
  };
};

exports.managedSassServer = {
  source: "npm",
  displayName: "Sass Language Server",
  packages: ["some-sass-language-server"],
  module: "node_modules/some-sass-language-server/bin/some-sass-language-server",
  bundled: true,
};

exports.resolveSassServer = async (configuredPath, managed = null) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["--stdio"] };
  }

  // 2.3.8's package export points at an absent node-server.js. Its public CLI
  // is intact, so find that entry point along Node's normal package paths;
  // this also works when npm hoists the dependency into the editor's tree.
  const serverModule =
    managed?.modulePath ||
    require.resolve
      .paths("some-sass-language-server")
      .map((directory) =>
        path.join(directory, "some-sass-language-server", "bin", "some-sass-language-server"),
      )
      .find((entry) => fs.existsSync(entry));
  if (!serverModule) throw new Error("The bundled Sass language server is unavailable.");

  return {
    command: process.execPath,
    args: [serverModule, "--stdio"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    version: managed?.version,
  };
};
