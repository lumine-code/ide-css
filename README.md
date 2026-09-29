# ide-css

CSS, SCSS, Sass and Less language-server adapter.

Registers the CSS server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) and the indented Sass server from [Some Sass](https://github.com/wkillerud/some-sass) with the `ide-client` package, providing completion, validation, documentation, navigation, refactoring, colors, links, quick fixes, folding, and selection ranges for stylesheets.

## Features

- **Bundled servers**: ships exact server versions, with optional custom executable paths.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **Four syntaxes**: serves CSS, SCSS, Sass and Less with their native protocol language IDs, using a separate server for indented Sass.
- **Custom data**: loads project-defined properties, at-rules, pseudo-classes, and pseudo-elements for CSS, SCSS and Less from custom-data files or URLs.
- **Validation and fixes**: reports syntax and configurable lint problems through LSP diagnostics and offers property-name quick fixes.
- **Navigation and refactoring**: finds definitions and references and renames variables or custom properties.
- **Document tools**: provides symbols, outline data, import links, colors, highlights, folding, selection ranges, and CSS, SCSS and Less formatting.
- **Feature switches**: each editor-facing capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first supported stylesheet editor.

## Installation

To install `ide-css` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-css`.

Install `ide-client` first.

## Usage

Indented Sass uses Some Sass with the native `sass` language ID. Property completions preserve indentation and omit semicolons. Both servers share the package's feature switches, and each has its own bundled fallback and managed upgrade. The Sass server does not provide formatting.

CSS inside HTML is served by `ide-html`. CSS inside JavaScript template strings is outside this adapter's scope.

## Services

- `ide-client`: consumed to register the stylesheet adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
