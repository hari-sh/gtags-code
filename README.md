# ctags-code

A Visual Studio Code extension that integrates **Ctags** to provide fast and accurate code navigation across multiple languages.

## Features

- Jump to symbol definitions using Ctags
- Fast and scalable tag lookups powered by LevelDB
- Quick symbol search via VSCode's Quick Pick UI
- Supports many programming languages through Ctags
- Lightweight and configurable

## Requirements

This extension supports both [Exuberant Ctags](http://ctags.sourceforge.net/) and [Universal Ctags](https://github.com/universal-ctags/ctags) binaries.

## Installation (VS Code)

Install the extension directly from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/):
1. Open VS Code
2. Go to the Extensions panel (`Ctrl+Shift+X` or `Cmd+Shift+X`)
3. Search for **ctags-code**
4. Click **Install**

## Usage

### 1. Generate the `tags` File

You must manually generate a `tags` file in the **root of your workspace** using Ctags.

#### Using Universal Ctags
```sh
ctags -R -o tags --fields=-n --extras=-F --output-format=tags
```

#### Using Exuberant Ctags
```sh
ctags -R -o tags
```

Any tool can be used as long as the below format of the tags file are holding

- **Column 1**: Symbol definition (tag name)
- **Column 2**: File information
- **Column 3**: Pattern to locate the symbol

> 📂 Place the `tags` file directly in the root of your workspace.

### 2. Store Tags (Build the Tags DB)

Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run:

```
Ctags: Store Tags
```

This command will parse the `tags` file and store its contents in a fast **LevelDB-based key-value store** (`tagsdb`) at the root of your workspace.

This step is **required** before using any search or navigation commands.

### 3. Jump to Tag

Once the `tagsdb` is built, you can navigate to symbol definitions using:

- Right-click on a symbol in the editor → **Ctags: Jump to Tag**
- Or use the Command Palette → **Ctags: Jump to Tag**

### 4. Search Tags

To search for any symbol globally across your project:

- Open the Command Palette and run:

```
Ctags: Search Tag
```

As you type, a **Quick Pick** dropdown will show matching symbols from the `tagsdb`, allowing instant navigation.

## Extension Commands

| Command | Description |
|--------|-------------|
| `Ctags: Store Tags` | Parses `tags` file and creates `tagsdb` (LevelDB) |
| `Ctags: Jump to Tag` | Jump to the selected tag definition |
| `Ctags: Search Tag` | Search symbols interactively via Quick Pick |

## Implementation Details

- `tagsdb` is implemented using **LevelDB**, a fast key-value store.
- Keys are tag names; values contain file paths and symbol location info.
- Lookup is optimized for incremental filtering and fast results.
- Tag search suggestion is optimized based on token match pattern search.

## Contributing

Pull requests and feedback are welcome! Please open an issue or PR.

## License

[MIT](LICENSE)
