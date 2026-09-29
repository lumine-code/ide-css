const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  resolveServer,
  managedServer,
  resolveSassServer,
  managedSassServer,
} = require("../lib/server");

const registerAdapter = () => {
  const adapters = new Map();
  const main = lumine.packages.getActivePackage("ide-css").mainModule;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapters.set(registered.id, registered);
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return {
    adapter: adapters.get("ide-css"),
    sassAdapter: adapters.get("ide-css-sass"),
    disposable,
  };
};

describe("ide-css server resolution", () => {
  it("prefers the configured path", async () => {
    const launch = await resolveServer(process.execPath);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--stdio"]);
  });

  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.args[1]).toBe("--stdio");
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/server.js", version: "9.9.9" };
    const launch = await resolveServer("", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    // Reported in the session details, so which copy is running is visible.
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("declares the bundled floor so uninstall falls back", () => {
    // The dependency is always present, so removing the managed copy returns to
    // a working server rather than to none.
    expect(managedServer.source).toBe("npm");
    expect(managedServer.bundled).toBe(true);
    expect(managedServer.module).toContain("node_modules/");
  });

  it("resolves the indented Sass server independently", async () => {
    const bundled = await resolveSassServer("");
    expect(bundled.command).toBe(process.execPath);
    expect(fs.existsSync(bundled.args[0])).toBe(true);
    expect(bundled.args[1]).toBe("--stdio");
    expect(bundled.env.ELECTRON_RUN_AS_NODE).toBe("1");
    const managed = { modulePath: "/managed/sass.js", version: "9.9.9" };
    expect((await resolveSassServer("", managed)).args[0]).toBe(managed.modulePath);
    expect((await resolveSassServer("", managed)).version).toBe(managed.version);
    expect((await resolveSassServer(process.execPath, managed)).command).toBe(process.execPath);
    expect(managedSassServer.bundled).toBe(true);
    expect(managedSassServer.packages).toEqual(["some-sass-language-server"]);
  });
});

describe("ide-css adapter", () => {
  let adapter, sassAdapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-css");
    ({ adapter, sassAdapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-css");
  });

  it("registers CSS, SCSS and Less with their protocol language IDs", async () => {
    expect(adapter.id).toBe("ide-css");
    expect(adapter.grammarScopes).toEqual(["source.css", "source.css.scss", "source.css.less"]);
    expect(adapter.languageIdForScope("source.css")).toBe("css");
    expect(adapter.languageIdForScope("source.css.scss")).toBe("scss");
    expect(adapter.languageIdForScope("source.css.less")).toBe("less");
    expect(adapter.settingsKeyPaths).toEqual(["ide-css"]);
    expect(adapter.restartKeyPaths).toEqual(["ide-css.serverPath", "ide-css.customData"]);
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
  });

  it("registers indented Sass with its own native server and shared feature switches", async () => {
    expect(sassAdapter.id).toBe("ide-css-sass");
    expect(sassAdapter.grammarScopes).toEqual(["source.sass"]);
    expect(sassAdapter.languageId).toBe("sass");
    expect(sassAdapter.featuresKeyPath).toBe("ide-css.features");
    expect(adapter.featuresKeyPath).toBe(sassAdapter.featuresKeyPath);
    expect(sassAdapter.restartKeyPaths).toEqual(["ide-css.sassServerPath"]);
    expect(sassAdapter.managedServer.packages).toEqual(["some-sass-language-server"]);
    const launch = await sassAdapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
    expect(launch.args[0]).not.toBe((await adapter.resolveServer({ rootPath: __dirname })).args[0]);
  });

  it("forwards Sass validation, completion and documentation settings", () => {
    lumine.config.set("ide-css.completion.triggerPropertyValueCompletion", false);
    lumine.config.set("ide-css.hover.references", false);
    lumine.config.set("ide-css.lint.unknownProperties", "error");
    const settings = sassAdapter.getWorkspaceConfiguration("somesass").sass;
    expect(settings.diagnostics.enabled).toBe(true);
    expect(settings.diagnostics.lint.unknownProperties).toBe("error");
    expect(settings.completion.triggerPropertyValueCompletion).toBe(false);
    expect(settings.hover.references).toBe(false);
    expect(sassAdapter.getSettings().somesass.sass).toEqual(settings);
    expect(sassAdapter.getWorkspaceConfiguration("editor")).toEqual({});
    lumine.config.set("ide-css.languages.sass", false);
    expect(sassAdapter.getWorkspaceConfiguration("somesass").sass.diagnostics.enabled).toBe(false);
  });

  it("disposes every registered adapter when its service edge disappears", () => {
    const disposed = [];
    const main = lumine.packages.getActivePackage("ide-css").mainModule;
    const registration = main.consumeIdeClient({
      registerAdapter(registered) {
        return { dispose: () => disposed.push(registered.id) };
      },
    });
    registration.dispose();
    registration.dispose();
    expect(disposed).toEqual(["ide-css", "ide-css-sass"]);
  });

  it("cleans up the first registration if the second server cannot register", () => {
    const disposed = jasmine.createSpy("dispose");
    const main = lumine.packages.getActivePackage("ide-css").mainModule;
    expect(() =>
      main.consumeIdeClient({
        registerAdapter(registered) {
          if (registered.id === "ide-css-sass") throw new Error("registration failed");
          return { dispose: disposed };
        },
      }),
    ).toThrowError("registration failed");
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("declares supported URI schemes, custom data, and the static formatter capability", () => {
    lumine.config.set("ide-css.customData", ["config/css-data.json", "https://x.test/css.json"]);
    expect(adapter.getInitializationOptions({ rootPath: __dirname })).toEqual({
      provideFormatter: true,
      handledSchemas: ["file", "http", "https"],
    });
    expect(adapter.getInitializedNotifications({ rootPath: __dirname })).toEqual([
      {
        method: "css/customDataChanged",
        params: [
          pathToFileURL(path.join(__dirname, "config", "css-data.json")).href,
          "https://x.test/css.json",
        ],
      },
    ]);
    lumine.config.set("ide-css.features.format", false);
    expect(adapter.getInitializationOptions().provideFormatter).toBe(true);
  });

  it("returns compatibility-shaped scoped settings for all three languages", () => {
    lumine.config.set("ide-css.completion.completePropertyWithSemicolon", false);
    lumine.config.set("ide-css.hover.references", false);
    lumine.config.set("ide-css.lint.unknownProperties", "error");
    lumine.config.set("ide-css.lint.validProperties", ["custom-prop"]);
    lumine.config.set("ide-css.languages.scss", false);

    const css = adapter.getWorkspaceConfiguration("css");
    expect(css.validate).toBe(true);
    expect(css.completion.completePropertyWithSemicolon).toBe(false);
    expect(css.hover.references).toBe(false);
    expect(css.lint.unknownProperties).toBe("error");
    expect(css.lint.hexColorLength).toBe("error");
    expect(css.lint.propertyIgnoredDueToDisplay).toBe("warning");
    expect(css.lint.validProperties).toEqual(["custom-prop"]);
    expect(adapter.getWorkspaceConfiguration("scss").validate).toBe(false);
    expect(adapter.getWorkspaceConfiguration("less").validate).toBe(true);
    expect(adapter.getWorkspaceConfiguration()).toEqual(adapter.getSettings());
    expect(adapter.getWorkspaceConfiguration("unknown")).toBeUndefined();
  });

  it("turns all three validators off with the diagnostics feature", () => {
    lumine.config.set("ide-css.features.diagnostics", false);
    expect(adapter.getSettings().css.validate).toBe(false);
    expect(adapter.getSettings().scss.validate).toBe(false);
    expect(adapter.getSettings().less.validate).toBe(false);
  });

  it("preserves grammar-scoped diagnostic overrides", () => {
    lumine.config.set("ide-css.features.diagnostics", false);
    lumine.config.set("ide-css.features.diagnostics", true, {
      scopeSelector: ".source.css.scss",
    });
    expect(adapter.getSettings().css.validate).toBe(false);
    expect(adapter.getSettings().scss.validate).toBe(true);
    expect(adapter.getSettings().less.validate).toBe(false);
    expect(sassAdapter.getSettings().somesass.sass.diagnostics.enabled).toBe(false);
    lumine.config.set("ide-css.features.diagnostics", true, { scopeSelector: ".source.sass" });
    expect(sassAdapter.getSettings().somesass.sass.diagnostics.enabled).toBe(true);
  });

  it("offers switches for exactly the capabilities consumed by the editor", () => {
    const { configSchema } = require("../package.json");
    expect(Object.keys(configSchema.features.properties)).toEqual([
      "diagnostics",
      "autocomplete",
      "hover",
      "definition",
      "references",
      "symbols",
      "format",
      "rename",
      "codeActions",
    ]);
  });

  it("describes every titled configuration setting", () => {
    const pkg = require("../package.json");
    const missing = [];
    const visit = (value, keyPath = "") => {
      if (value?.title && !value.description) missing.push(keyPath);
      for (const [key, child] of Object.entries(value?.properties || {}))
        visit(child, keyPath ? `${keyPath}.${key}` : key);
    };
    visit({ properties: pkg.configSchema });
    expect(missing).toEqual([]);
    expect(pkg.keywords.some((keyword) => pkg.name.includes(keyword))).toBe(false);
  });
});

describe("ide-css feature contracts", () => {
  const features = [
    "diagnostics",
    "autocomplete",
    "hover",
    "definition",
    "references",
    "symbols",
    "format",
    "rename",
    "codeActions",
  ];
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-css");
  });

  afterEach(async () => {
    for (const feature of features) lumine.config.unset(`ide-css.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-css");
  });

  for (const feature of features) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-css.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
