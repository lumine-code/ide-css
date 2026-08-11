const { CompositeDisposable } = require("lumine");
const { resolveServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-css.${key}`);

const lintSettings = () => ({
  unknownProperties: setting("lint.unknownProperties"),
  unknownAtRules: setting("lint.unknownAtRules"),
  duplicateProperties: setting("lint.duplicateProperties"),
  emptyRules: setting("lint.emptyRules"),
  vendorPrefix: setting("lint.vendorPrefix"),
  important: setting("lint.important"),
  float: setting("lint.float"),
  idSelector: setting("lint.idSelector"),
  validProperties: setting("lint.validProperties") || [],
});

const languageSettings = (languageId) => ({
  validate: setting("features.diagnostics") && setting(`languages.${languageId}`),
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

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-css",
      displayName: "CSS Language Server",
      grammarScopes: ["source.css", "source.css.scss", "source.css.less"],
      languageIdForScope(scope) {
        if (scope === "source.css.scss") return "scss";
        if (scope === "source.css.less") return "less";
        return "css";
      },
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-css"],
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          provideFormatter: setting("features.format"),
          handledSchemas: ["file", "http", "https"],
        };
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

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    const restart = () => {
      for (const session of service.getSessions()) {
        if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
          continue;
        service.restart(session).catch((error) => {
          lumine.notifications.addError("Unable to restart CSS Language Server", {
            detail: error.message,
            dismissable: true,
          });
        });
      }
    };
    for (const key of ["serverPath", "features.format"]) {
      subscriptions.add(lumine.config.onDidChange(`ide-css.${key}`, restart));
    }
    return subscriptions;
  },
};
