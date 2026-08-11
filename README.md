# ide-css

CSS, SCSS and Less language-server adapter.

Registers the CSS server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the bundled `ide-client` package, providing completion, validation, documentation, navigation, refactoring, colors, links, quick fixes, folding, selection ranges, and formatting for stylesheets.

## Features

- **Bundled server**: ships an exact server version, with an optional custom executable path.
- **Three syntaxes**: serves CSS, SCSS and Less with their native protocol language IDs.
- **Validation and fixes**: reports syntax and configurable lint problems through LSP pull diagnostics and offers property-name quick fixes.
- **Navigation and refactoring**: finds definitions and references and renames variables or custom properties.
- **Document tools**: provides symbols, outline data, import links, colors, highlights, folding, selection ranges, and formatting.
- **Feature switches**: each editor-facing capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first supported stylesheet editor.

## Installation

To install `ide-css` search for _ide-css_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-css`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the stylesheet adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
