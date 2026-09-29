const fs = require("fs");
const os = require("os");
const path = require("path");
const { LiveLspClient, fileUri, position, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = (id = "ide-css") => {
  let adapter;
  const main = lumine.packages.getActivePackage("ide-css").mainModule;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      if (registered.id === id) adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

describe("ide-css bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-css");
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-css-live-"));
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    fs.rmSync(rootPath, { recursive: true, force: true });
    await lumine.packages.deactivatePackage("ide-css");
  });

  it("exercises every advertised capability and the document lifecycle", async () => {
    fs.writeFileSync(path.join(rootPath, "base.css"), ".base { display: block; }\n");
    const filePath = path.join(rootPath, "fixture.css");
    const source = [
      '@import "./base.css";',
      "",
      ":root {",
      "  --brand: #ff0000;",
      "}",
      "",
      ".card {",
      "  color: var(--brand);",
      "  display: grid;",
      "  colr: #00ff00;",
      "}",
      "",
      ".card:hover {",
      "  color: var(--brand);",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    const { capabilities } = await client.start();
    client.open(uri, "css", source);

    expect(capabilities.diagnosticProvider).toBeDefined();
    expect(capabilities.completionProvider).toBeDefined();
    expect(capabilities.hoverProvider).toBe(true);
    expect(capabilities.documentSymbolProvider).toBe(true);
    expect(capabilities.referencesProvider).toBe(true);
    expect(capabilities.definitionProvider).toBe(true);
    expect(capabilities.documentHighlightProvider).toBe(true);
    expect(capabilities.documentLinkProvider).toBeDefined();
    expect(capabilities.codeActionProvider).toBe(true);
    expect(capabilities.renameProvider).toBe(true);
    expect(capabilities.colorProvider).toBeDefined();
    expect(capabilities.foldingRangeProvider).toBe(true);
    expect(capabilities.selectionRangeProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.documentRangeFormattingProvider).toBe(true);

    const completion = await client.request("textDocument/completion", positionParams(uri, 8, 13));
    expect(completion.items.map(({ label }) => label)).toContain("grid");

    const hover = await client.request("textDocument/hover", positionParams(uri, 8, 4));
    expect(hover.contents.value).toContain("determines the type of box");

    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols.map(({ name }) => name)).toContain(".card");

    const references = await client.request("textDocument/references", {
      ...positionParams(uri, 7, 15),
      context: { includeDeclaration: true },
    });
    expect(references.length).toBe(3);

    const definition = await client.request("textDocument/definition", positionParams(uri, 7, 15));
    expect(definition.range.start).toEqual(position(3, 2));

    const highlights = await client.request(
      "textDocument/documentHighlight",
      positionParams(uri, 7, 15),
    );
    expect(highlights.length).toBe(3);

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri },
    });
    expect(links[0].target.toLowerCase()).toContain("base.css");

    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.kind).toBe("full");
    const unknownProperty = diagnostics.items.find(({ code }) => code === "unknownProperties");
    expect(unknownProperty.message).toContain("'colr'");

    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: unknownProperty.range,
      context: { diagnostics: [unknownProperty] },
    });
    expect(actions.map(({ title }) => title)).toContain("Rename to 'color'");

    const rename = await client.request("textDocument/rename", {
      ...positionParams(uri, 7, 15),
      newName: "--accent",
    });
    expect(rename.changes[uri]).toHaveSize(3);
    expect(rename.changes[uri].every(({ newText }) => newText === "--accent")).toBe(true);

    const colors = await client.request("textDocument/documentColor", {
      textDocument: { uri },
    });
    expect(colors).toHaveSize(2);
    const presentations = await client.request("textDocument/colorPresentation", {
      textDocument: { uri },
      color: colors[0].color,
      range: colors[0].range,
    });
    expect(presentations.map(({ label }) => label)).toContain("#ff0000");

    const folding = await client.request("textDocument/foldingRange", {
      textDocument: { uri },
    });
    expect(folding.length).toBeGreaterThanOrEqual(3);

    const selection = await client.request("textDocument/selectionRange", {
      textDocument: { uri },
      positions: [position(7, 15)],
    });
    expect(selection[0].parent.parent).toBeDefined();

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(edits[0].newText).toContain("    --brand");

    const rangeEdits = await client.request("textDocument/rangeFormatting", {
      textDocument: { uri },
      range: { start: position(2, 0), end: position(14, 1) },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(rangeEdits.length).toBeGreaterThan(0);

    const fixed = source.replace("colr:", "color:");
    client.change(uri, fixed);
    const cleared = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(cleared.items).toEqual([]);

    client.closeDocument(uri);
    const closed = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(closed.items).toEqual([]);
  });

  it("uses the native SCSS and Less language services", async () => {
    const scssPath = path.join(rootPath, "fixture.scss");
    const scssSource = [
      "$brand: #f00;",
      ".card {",
      "  color: $brand;",
      "  &:hover { color: lighten($brand, 10%); }",
      "}",
    ].join("\n");
    const lessPath = path.join(rootPath, "fixture.less");
    const lessSource = ["@brand: #f00;", ".card {", "  color: @brand;", "}"].join("\n");
    fs.writeFileSync(scssPath, scssSource);
    fs.writeFileSync(lessPath, lessSource);
    const scssUri = fileUri(scssPath);
    const lessUri = fileUri(lessPath);
    await client.start();
    client.open(scssUri, "scss", scssSource);
    client.open(lessUri, "less", lessSource);

    const scssDefinition = await client.request(
      "textDocument/definition",
      positionParams(scssUri, 2, 11),
    );
    expect(scssDefinition.range.start.line).toBe(0);
    const lessDefinition = await client.request(
      "textDocument/definition",
      positionParams(lessUri, 2, 11),
    );
    expect(lessDefinition.range.start.line).toBe(0);

    const scssSymbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri: scssUri },
    });
    const lessSymbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri: lessUri },
    });
    expect(scssSymbols.map(({ name }) => name)).toContain(".card");
    expect(lessSymbols.map(({ name }) => name)).toContain(".card");

    const scssDiagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri: scssUri },
    });
    const lessDiagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri: lessUri },
    });
    expect(scssDiagnostics.items).toEqual([]);
    expect(lessDiagnostics.items).toEqual([]);
  });

  it("loads project-relative CSS custom data", async () => {
    fs.writeFileSync(
      path.join(rootPath, "css-data.json"),
      JSON.stringify({
        version: 1,
        properties: [{ name: "custom-brand-color", description: "Project brand color." }],
      }),
    );
    lumine.config.set("ide-css.customData", ["css-data.json"]);
    const filePath = path.join(rootPath, "custom.css");
    const source = ".card {\n  custom-br\n}\n";
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    await client.start();
    client.open(uri, "css", source);

    const completion = await client.request("textDocument/completion", positionParams(uri, 1, 11));
    expect(completion.items.map(({ label }) => label)).toContain("custom-brand-color");
    const resolvedSource = source.replace("custom-br", "custom-brand-color: red;");
    client.change(uri, resolvedSource);
    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.items).toEqual([]);
  });

  it("completes indented Sass with its native server and original document positions", async () => {
    disposable.dispose();
    ({ adapter, disposable } = registerAdapter("ide-css-sass"));
    client = new LiveLspClient(adapter, rootPath);
    const source = "$brand: #ff0000\n.card\n  disp\n  color: $br\n";
    const uri = fileUri(path.join(rootPath, "fixture.sass"));
    fs.writeFileSync(path.join(rootPath, "fixture.sass"), source);
    const { capabilities } = await client.start();
    client.open(uri, "sass", source);
    expect(capabilities.documentFormattingProvider).toBeUndefined();
    expect(capabilities.documentRangeFormattingProvider).toBeUndefined();

    const properties = await client.request("textDocument/completion", positionParams(uri, 2, 6));
    const display = properties.items.find(({ label }) => label === "display");
    expect(display.textEdit.range).toEqual({ start: position(2, 2), end: position(2, 6) });
    expect(display.textEdit.newText).toBe("display: $0");
    expect(display.insertTextFormat).toBe(2);
    expect(display.command.command).toBe("editor.action.triggerSuggest");
    expect(display.documentation.value).toContain("MDN Reference");

    const variables = await client.request("textDocument/completion", positionParams(uri, 3, 12));
    expect(variables.items.map(({ label }) => label)).toContain("$brand");

    client.change(uri, "$brand: #ff0000\n.card\n  display: gr\n  color: $brand\n");
    const values = await client.request("textDocument/completion", positionParams(uri, 2, 13));
    const grid = values.items.find(({ label }) => label === "grid");
    expect(grid.textEdit.newText).toBe("grid");
    const definition = await client.request("textDocument/definition", positionParams(uri, 3, 12));
    expect(definition.range.start.line).toBe(0);

    client.change(uri, ".card:ho\n  color: red\n", 3);
    const pseudo = await client.request("textDocument/completion", positionParams(uri, 0, 8));
    expect(pseudo.items.map(({ label }) => label)).toContain(":hover");

    const mixinSource = [
      "@mixin card($color, $padding: 1rem)",
      "  color: $color",
      ".card",
      "  @include card(red, )",
      "",
    ];
    client.change(uri, mixinSource.join("\n"), 4);
    expect(capabilities.signatureHelpProvider).toBeDefined();
    const signature = await client.request(
      "textDocument/signatureHelp",
      positionParams(uri, 3, mixinSource[3].indexOf(")")),
    );
    expect(signature.signatures[0].label).toBe("card($color, $padding: 1rem)");
    expect(signature.activeParameter).toBe(1);
  });

  it("validates Sass at its original ranges and clears resolved problems", async () => {
    disposable.dispose();
    ({ adapter, disposable } = registerAdapter("ide-css-sass"));
    client = new LiveLspClient(adapter, rootPath);
    const uri = fileUri(path.join(rootPath, "invalid.sass"));
    const source = ".card\n  colr: red\n";
    fs.writeFileSync(path.join(rootPath, "invalid.sass"), source);
    await client.start();
    client.open(uri, "sass", source);
    const published = await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .find(({ params }) => params.uri === uri && params.diagnostics.length),
      "Sass diagnostics",
    );
    const unknown = published.params.diagnostics.find(({ code }) => code === "unknownProperties");
    expect(unknown.range).toEqual({ start: position(1, 2), end: position(1, 6) });
    expect(unknown.source).toBe("sass");

    client.change(uri, source.replace("colr:", "color:"));
    await client.waitFor(
      () =>
        client
          .messages("textDocument/publishDiagnostics")
          .find(({ params }) => params.uri === uri && params.diagnostics.length === 0),
      "Resolved Sass diagnostics",
    );
  });

  for (const syntax of [
    {
      name: "CSS",
      adapterId: "ide-css",
      languageId: "css",
      propertySource: ".card {\n  disp\n}\n",
      valueSource: ".card {\n  display: gr;\n}\n",
    },
    {
      name: "Sass",
      adapterId: "ide-css-sass",
      languageId: "sass",
      propertySource: ".card\n  disp\n",
      valueSource: ".card\n  display: gr\n",
    },
  ]) {
    it(`completes an unsaved ${syntax.name} document with an untitled URI`, async () => {
      disposable.dispose();
      ({ adapter, disposable } = registerAdapter(syntax.adapterId));
      client = new LiveLspClient(adapter, rootPath);
      const uri = `untitled:lumine-${syntax.languageId}.${syntax.languageId}`;
      await client.start();
      client.open(uri, syntax.languageId, syntax.propertySource);

      const properties = await client.request("textDocument/completion", positionParams(uri, 1, 6));
      expect(properties?.items?.map(({ label }) => label) || []).toContain("display");

      client.change(uri, syntax.valueSource);
      const values = await client.request("textDocument/completion", positionParams(uri, 1, 13));
      expect(values?.items?.map(({ label }) => label) || []).toContain("grid");
      expect(fs.readdirSync(rootPath)).toEqual([]);
    });
  }
});
