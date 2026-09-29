const path = require("path");
const { pathToFileURL } = require("url");
const { CompositeDisposable } = require("lumine");
const { resolveServer, managedServer, resolveSassServer, managedSassServer } = require("./server");

const LANGUAGE_SCOPES = {
  css: "source.css",
  scss: "source.css.scss",
  less: "source.css.less",
  sass: "source.sass",
};
const setting = (key, scope) =>
  scope
    ? lumine.config.get(`ide-css.${key}`, { scope: [scope] })
    : lumine.config.get(`ide-css.${key}`);

const lintSettings = () => ({
  compatibleVendorPrefixes: setting("lint.compatibleVendorPrefixes"),
  vendorPrefix: setting("lint.vendorPrefix"),
  duplicateProperties: setting("lint.duplicateProperties"),
  emptyRules: setting("lint.emptyRules"),
  importStatement: setting("lint.importStatement"),
  boxModel: setting("lint.boxModel"),
  universalSelector: setting("lint.universalSelector"),
  zeroUnits: setting("lint.zeroUnits"),
  fontFaceProperties: setting("lint.fontFaceProperties"),
  hexColorLength: setting("lint.hexColorLength"),
  argumentsInColorFunction: setting("lint.argumentsInColorFunction"),
  unknownProperties: setting("lint.unknownProperties"),
  unknownAtRules: setting("lint.unknownAtRules"),
  ieHack: setting("lint.ieHack"),
  unknownVendorSpecificProperties: setting("lint.unknownVendorSpecificProperties"),
  propertyIgnoredDueToDisplay: setting("lint.propertyIgnoredDueToDisplay"),
  important: setting("lint.important"),
  float: setting("lint.float"),
  idSelector: setting("lint.idSelector"),
  validProperties: setting("lint.validProperties") || [],
});

const languageSettings = (languageId) => ({
  validate:
    setting("features.diagnostics", LANGUAGE_SCOPES[languageId]) &&
    setting(`languages.${languageId}`),
  lint: lintSettings(),
  completion: {
    triggerPropertyValueCompletion: setting("completion.triggerPropertyValueCompletion"),
    completePropertyWithSemicolon: setting("completion.completePropertyWithSemicolon"),
  },
  hover: {
    documentation: setting("hover.documentation"),
    references: setting("hover.references"),
  },
});

const allSettings = () => ({
  css: languageSettings("css"),
  scss: languageSettings("scss"),
  less: languageSettings("less"),
});

const customDataPaths = (rootPath) =>
  (setting("customData") || []).map((entry) => {
    if (path.isAbsolute(entry)) return pathToFileURL(entry).href;
    try {
      if (new URL(entry).protocol) return entry;
    } catch {
      // Relative file path, resolved against this server's project root below.
    }
    return pathToFileURL(path.resolve(rootPath, entry)).href;
  });

const sassSettings = () => ({
  sass: {
    diagnostics: {
      enabled: setting("features.diagnostics", LANGUAGE_SCOPES.sass) && setting("languages.sass"),
      lint: { enabled: true, ...lintSettings() },
    },
    completion: {
      triggerPropertyValueCompletion: setting("completion.triggerPropertyValueCompletion"),
    },
    hover: {
      documentation: setting("hover.documentation"),
      references: setting("hover.references"),
    },
  },
});

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-css",
      featuresKeyPath: "ide-css.features",
      displayName: "CSS Language Server",
      grammarScopes: ["source.css", "source.css.scss", "source.css.less"],
      languageIdForScope(scope) {
        if (scope === "source.css.scss") return "scss";
        if (scope === "source.css.less") return "less";
        return "css";
      },
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-css"],
      restartKeyPaths: ["ide-css.serverPath", "ide-css.customData"],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          // Feature routing is grammar-scoped. Keeping the server capability
          // alive lets a scoped true override a false base setting.
          provideFormatter: true,
          handledSchemas: ["file", "http", "https"],
        };
      },
      getInitializedNotifications({ rootPath }) {
        return [{ method: "css/customDataChanged", params: customDataPaths(rootPath) }];
      },
      getSettings() {
        return allSettings();
      },
      getWorkspaceConfiguration(section) {
        if (!section) return allSettings();
        if (["css", "scss", "less"].includes(section)) return languageSettings(section);
        return undefined;
      },
    };

    const sassAdapter = {
      id: "ide-css-sass",
      featuresKeyPath: "ide-css.features",
      displayName: "Sass Language Server",
      grammarScopes: ["source.sass"],
      languageId: "sass",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-css"],
      restartKeyPaths: ["ide-css.sassServerPath"],
      managedServer: managedSassServer,
      async resolveServer(context) {
        const launch = await resolveSassServer(setting("sassServerPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getSettings() {
        return { somesass: sassSettings() };
      },
      getWorkspaceConfiguration(section) {
        if (!section) return { somesass: sassSettings() };
        if (section === "somesass") return sassSettings();
        if (section === "editor") return {};
        return undefined;
      },
    };

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    try {
      subscriptions.add(service.registerAdapter(sassAdapter));
    } catch (error) {
      subscriptions.dispose();
      throw error;
    }
    return subscriptions;
  },
};
