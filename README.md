# Web Visual Editor [![Installs](https://img.shields.io/visual-studio-marketplace/i/urin.vscode-web-visual-editor)](https://marketplace.visualstudio.com/items?itemName=Urin.vscode-web-visual-editor) [![Stars](https://img.shields.io/github/stars/urin/vscode-web-visual-editor?style=flat)](https://api.star-history.com/svg?repos=urin/vscode-web-visual-editor&type=Timeline)

Edit HTML files visually in real-time.

<img src="https://raw.githubusercontent.com/urin/vscode-web-visual-editor/main/docs/demo.webp" alt="Demo">

## ✨ Features
- 🖼️ **Visual Editing**: Edit HTML elements visually within the WebView.
- ⏱️ **Real-Time Preview**: See changes reflected instantly as you edit. Edits in the source editor are reflected on every keystroke. Edits in the WebView are written back to the source instantly.
- 🧩 **Integrated with Visual Studio Code**: No additional processes and windows and well-integrated with VSCode theme.
- 🖱️ **Element Selection**: Select HTML elements with ease. Visual selections are synchronized with text selections on editor. Vice versa.
- ✂️ **Copy, Cut and Paste**: Copy or cut elements, paste text or HTML into selected element.
- 🗑️ **Delete**: Remove selected elements from the source.
- ↩️ **Undo / Redo**: All edits made via the WebView are undoable and redoable.
- 🔍 **Zoom in and out**: Zoom in and out the page.
- ↕️ **Move Elements**: Drag elements to rearrange their position.
- 🔗 **Live resource updates**: CSS, images, and other files referenced by relative path are tracked. The WebView refreshes automatically when any of them is saved.

## 📐 Specification

### ⚙️ Settings (`settings.json`)

- `webVisualEditor.enableMovingElements`<br>
  Enable drag-to-move and keyboard nudge for positioned elements. Default: `false`.
- `webVisualEditor.allowScript`<br>
  Allow `<script>` tags and `on*` event attributes to run inside the WebView. Default: `false`.

> [!TIP]
> When `enableMovingElements` is enabled, moving an element rewrites its tag using VSCode's HTML formatting. To avoid inconsistent indentation, **format the entire document before starting visual editing** (`Shift+Alt+F`).

### 🖱️ Multi-selection

- `Ctrl+Click` adds or removes an element from the current selection.
- Selections made in the source editor (including multiple ranges) are also reflected in the WebView.

### ↕️ Movable element conditions (requires `enableMovingElements`)

An element is draggable when all of the following are true:

- `position` is not `static` or `sticky`
- `left`/`right` are not both set simultaneously (same for `top`/`bottom`)
- Any explicitly set position value uses **`px`** units — other units (`%`, `em`, `rem`, etc.) make the element non-movable

### ✂️ Copy / Cut / Paste

- **Copy / Cut**: `Ctrl+C` / `Ctrl+X` copies the source text of the selected elements to the clipboard — the same range that is highlighted in the source editor. Cut also removes the elements from the source.
- **Paste**: `Ctrl+V` inserts clipboard content just before the closing tag of the last selected element (or `<body>` if nothing is selected). If the clipboard contains valid HTML it is inserted as-is; plain text is HTML-escaped first. The inserted range is then reformatted by VSCode's HTML formatter.

## 🔀 Alternatives
This extension is similar to [microsoft/vscode\-livepreview](https://github.com/microsoft/vscode-livepreview) and it differs in the following points:

- The ability to synchronize code selection with visual selection in the preview.
- Since Web Visual Editor has minimal functionality, the codebase is very small, making future expansions easy.
- It is designed to reflect changes made in the preview back to the code, so enhancing the editing capabilities within the preview may be beneficial in the future. For example, you can copy, cut, paste and delete elements within preview at this moment.

## 📜 License
[MIT License](LICENSE)

## 💛 Sponsor
[![Sponsor icon](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/urin)
Empower my motivation brewing and accelerate development by [buying me a coffee](https://github.com/sponsors/urin)!
