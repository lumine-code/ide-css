const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri, position, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
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
});
