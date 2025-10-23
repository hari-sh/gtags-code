# gtags-code

A Visual Studio Code extension that integrates **Gtags** to provide fast and accurate code navigation across multiple languages.

## Features

- Jump to symbol definitions using GNU Global
- Fast and scalable tag lookups powered by LevelDB
- Quick symbol search via VSCode's Quick Pick UI
- Supports many programming languages through Gtags
- Lightweight and configurable

## Requirements

GNU global should be installed in the system.

## Installation (VS Code)

Install the extension directly from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/):
1. Open VS Code
2. Go to the Extensions panel (`Ctrl+Shift+X` or `Cmd+Shift+X`)
3. Search for **gtags-code**
4. Click **Install**

## Usage

Generate GTAGS in your root directory.

and then write a script to get all tags file similar to ctags tag file output.
I will push future update that use gtags directly. For now please use this script.

```
#!/usr/bin/env bash
# gtags-to-ctags.sh
# Usage: ./gtags-to-ctags.sh [project-root] > tags
# Produces a ctags-compatible "tags" file (with search-pattern addresses)
set -euo pipefail

proj="${1:-.}"
cd "$proj" || exit 1

# Ensure GTAGS exists / update gtags database
if ! [ -f GTAGS ]; then
  echo "GTAGS not found: running gtags..." >&2
  gtags >/dev/null 2>&1 || { echo "gtags failed" >&2; exit 1; }
fi

# Print ctags header
printf "%s\n" "!_TAG_FILE_FORMAT\t2\t/extended format/" 

# Use global -f to list tags. Format of global -f lines (typical):
#    name lineno path rest-of-line-source
# We will produce: tag<TAB>path<TAB>/^escaped_source$/;"
# Use awk to parse and escape slashes and leading/trailing spaces.
global -f | awk '
{
  name = $1;
  lineno = $2;
  file = $3;
  # remove first three fields from $0 to get the source text (the rest)
  sub($1 FS $2 FS $3 FS, "", $0);
  src = $0;
  # trim leading/trailing spaces
  gsub(/^[ \t]+|[ \t]+$/, "", src);
  if (src == "") {
    # fallback to using a search by the name (safer than nothing)
    pattern = "/^" name "$/;"
  } else {
    # escape backslashes and slashes and caret/dollar which could break searches
    gsub(/\\/,"\\\\\\",src);
    gsub(/\//,"\\/\\/",src);
    # remove literal leading ^ or trailing $ to avoid double anchors
    gsub(/^[\^]+|[\$]+$/,"",src);
    # collapse multiple spaces for stability (optional)
    gsub(/[ \t]+/," ",src);
    pattern = "/^" src "$/;"
  }
  # Output: tag<TAB>file<TAB>pattern"<TAB> (ctags extended normally adds \" as comment start)
  printf("%s\t%s\t%s\"\\n", name, file, pattern);
}'
```

Any tool can be used as long as the below format of the tags file are holding

- **Column 1**: Symbol definition (tag name)
- **Column 2**: File information
- **Column 3**: Pattern to locate the symbol

> 📂 Place the `tags` file directly in the root of your workspace.

### 2. Store Tags (Build the Tags DB)

Open the **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run:

```
Gtags: Store Tags
```

This command will parse the `tags` file and store its contents in a fast **LevelDB-based key-value store** (`tagsdb`) at the root of your workspace.

This step is **required** before using any search or navigation commands.

### 3. Jump to Tag

Once the `tagsdb` is built, you can navigate to symbol definitions using:

- Right-click on a symbol in the editor → **Gtags: Jump to Tag**
- Or use the Command Palette → **Gtags: Jump to Tag**

### 4. Search Tags

To search for any symbol globally across your project:

- Open the Command Palette and run:

```
Gtags: Search Tag
```

As you type, a **Quick Pick** dropdown will show matching symbols from the `tagsdb`, allowing instant navigation.

## Extension Commands

| Command | Description |
|--------|-------------|
| `Gtags: Store Tags` | Parses `tags` file and creates `tagsdb` (LevelDB) |
| `Gtags: Jump to Tag` | Jump to the selected tag definition |
| `Gtags: Search Tag` | Search symbols interactively via Quick Pick |

## Implementation Details

- `tagsdb` is implemented using **LevelDB**, a fast key-value store.
- Keys are tag names; values contain file paths and symbol location info.
- Lookup is optimized for incremental filtering and fast results.
- Tag search suggestion is optimized based on token match pattern search.

## Contributing

Pull requests and feedback are welcome! Please open an issue or PR.

## License

[MIT](LICENSE)
