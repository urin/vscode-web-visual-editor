import * as vscode from 'vscode';

import { JSDOM } from 'jsdom';
import he from 'he';
import path from 'path';

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {

  public activeCode: vscode.TextDocument | null = null;

  private editorOptions = { insertSpaces: true, indentSize: 2, indentChar: ' ', indentUnit: '  ' };
  private readonly context: vscode.ExtensionContext;
  private readonly codes = new Map<vscode.TextDocument, Set<vscode.WebviewPanel>>();
  private readonly editedBy = new Set<vscode.WebviewPanel>();
  private readonly resources = new Map<string, Set<vscode.TextDocument>>();

  constructor(private readonly ec: vscode.ExtensionContext) {
    this.context = ec;
    // Get and update indentation setting
    const editorConfig = vscode.workspace.getConfiguration('editor', { languageId: 'html' });
    const insertSpaces = editorConfig.get<boolean>('insertSpaces');
    const indentSize = editorConfig.get<number>('tabSize')!;
    Object.assign(this.editorOptions, {
      insertSpaces,
      indentSize,
      indentChar: insertSpaces ? ' ' : '\t',
      indentUnit: insertSpaces ? ' '.repeat(indentSize) : '\t'
    });
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      const htmlEditor = editors.find(e => e.document.languageId === 'html');
      if (!htmlEditor) { return; }
      const options = htmlEditor.options;
      Object.assign(this.editorOptions, {
        insertSpaces: options.insertSpaces,
        indentSize: options.indentSize
      });
    });
    // Process when file save
    vscode.workspace.onDidSaveTextDocument(document => {
      this.resources.get(document.uri.fsPath)?.forEach(code => {
        this.codes.get(code)!.forEach(({ webview }) => {
          this.updateWebview(webview, code);
        });
      });
    });
    // Process when source code changes
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length === 0) { return; }
      const code = event.document;
      this.codes.get(code)?.forEach(panel => {
        if (this.editedBy.delete(panel)) {
          this.postCodeRanges(code, panel);
          return;
        }
        this.updateWebview(panel.webview, code);
      });
    });
    // Process when text selection is changed
    vscode.window.onDidChangeTextEditorSelection(event => {
      const code = event.textEditor.document;
      if (!this.codes.has(code) || (
        event.kind && (
          event.kind !== vscode.TextEditorSelectionChangeKind.Keyboard
          && event.kind !== vscode.TextEditorSelectionChangeKind.Mouse
        )
      )) {
        return;
      }
      const positions = event.selections.filter(
        s => !s.isEmpty
      ).map(
        s => ({ start: code.offsetAt(s.start), end: code.offsetAt(s.end) })
      );
      if (positions.length === 0) { return; }
      this.codes.get(code)?.forEach(panel => {
        panel.webview.postMessage({
          type: 'select',
          data: positions
        });
      });
    });
  }

  private postCodeRanges(code: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const dom = new JSDOM(code.getText(), { includeNodeLocations: true });
    panel.webview.postMessage({
      type: 'codeRanges',
      data: Array.from(dom.window.document.querySelectorAll('body *, body')).map(element => {
        const range = dom.nodeLocation(element)!;
        return {
          element: this.shortName(element),
          start: range.startOffset, end: range.endOffset
        };
      })
    });
  }

  public async resolveCustomTextEditor(
    code: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _: vscode.CancellationToken
  ): Promise<void> {
    // Manage webview panels
    if (this.codes.has(code)) {
      this.codes.get(code)?.add(panel);
    } else {
      const panels = new Set<vscode.WebviewPanel>();
      panels.add(panel);
      this.codes.set(code, panels);
    }
    panel.onDidChangeViewState(event => {
      if (event.webviewPanel.visible) { this.activeCode = code; }
    });
    // Initialize WebView
    panel.webview.options = { enableScripts: true };
    panel.onDidDispose(() => {
      this.codes.get(code)?.delete(panel);
      this.editedBy.delete(panel);
      if (this.codes.get(code)?.size === 0) {
        this.codes.delete(code);
      }
    });
    // Message from WebView
    panel.webview.onDidReceiveMessage(event => {
      switch (event.type) {
        case 'state':
          this.codes.get(code)?.forEach(p => {
            if (p === panel) { return; }
            p.webview.postMessage(event);
          });
          break;
        case 'refresh':
          this.updateWebview(panel.webview, code);
          break;
        case 'select':
          this.selectElements(code, event);
          break;
        case 'edit':
          if (this.editElements(code, event)) {
            this.editedBy.add(panel);
          }
          break;
        case 'delete':
          this.deleteElements(code, this.getNiceRanges(code, event.data));
          break;
        case 'copy':
          this.copyElements(code, this.getNiceRanges(code, event.data));
          break;
        case 'cut':
          const niceRanges = this.getNiceRanges(code, event.data);
          this.copyElements(code, niceRanges);
          this.deleteElements(code, niceRanges);
          break;
        case 'paste':
          this.pasteToElement(code, event);
          break;
      }
    });
    // Update webview
    this.updateWebview(panel.webview, code);
    this.activeCode = code;
  }

  // Select code range of selected element
  private selectElements(code: vscode.TextDocument, event: any) {
    const selections = this.getNiceRanges(code, event.data).map(range => {
      return new vscode.Selection(range.start, range.end);
    });
    vscode.window.visibleTextEditors.forEach(editor => {
      if (editor.document !== code) { return; }
      editor.selections = selections;
      if (selections.length > 0) {
        editor.revealRange(selections.at(-1)!, vscode.TextEditorRevealType.InCenter);
      }
    });
  }

  // Reflect edits on WebView to source code
  private editElements(code: vscode.TextDocument, event: any) {
    const edit = new vscode.WorkspaceEdit();
    let shouldEdit = false;
    event.data.forEach((codeEdit: any) => {
      const range = new vscode.Range(
        code.positionAt(codeEdit.codeRange.start),
        code.positionAt(codeEdit.codeRange.end)
      );
      const text = code.getText(range);
      const fragment = JSDOM.fragment(text).firstElementChild;
      if (fragment === null) {
        throw Error(
          'Failed to create virtual DOM from code fragment of '
          + `${code.fileName}(${codeEdit.codeRange.start}, ${codeEdit.codeRange.end})\n`
          + text
        );
      }
      codeEdit.operations.forEach((operation: any) => {
        shouldEdit = true;
        if (operation.style === null) {
          fragment.removeAttribute('style');
        } else {
          fragment.setAttribute('style', operation.style);
        }
      });
      edit.replace(code.uri, range, fragment.outerHTML, {
        needsConfirmation: false, label: 'Edit on WebView'
      });
    });
    if (shouldEdit) {
      vscode.workspace.applyEdit(edit);
    }
    return shouldEdit;
  }

  private deleteElements(code: vscode.TextDocument, ranges: vscode.Range[]) {
    const edit = new vscode.WorkspaceEdit();
    ranges.forEach((range: vscode.Range) => edit.delete(code.uri, range));
    vscode.workspace.applyEdit(edit);
  }

  // Copy process on WebView
  private copyElements(code: vscode.TextDocument, ranges: vscode.Range[]) {
    const textToCopy = ranges.map((range: vscode.Range) => {
      const indent = code.lineAt(range.start.line).text.match(/^\s+/);
      const text = code.getText(range);
      return indent === null ? text : text.replace(new RegExp(`^${indent}`, 'gm'), '');
    }).join('\n');
    vscode.env.clipboard.writeText(textToCopy);
  }

  // Paste process on WebView
  private async pasteToElement(code: vscode.TextDocument, event: any) {
    const clipboard = (await vscode.env.clipboard.readText()).trim() + '\n';
    if (clipboard.length === 0) { return; }
    const { start, end } = event.data.codeRange;
    const destPos = code.positionAt(
      start + code.getText(
        new vscode.Range(code.positionAt(start), code.positionAt(end))
      ).lastIndexOf('</')
    );
    const text = event.data.isHtml ? clipboard : he.escape(clipboard);
    {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(code.uri, destPos, text, { needsConfirmation: false, label: 'Paste on WebView' });
      await vscode.workspace.applyEdit(edit);
    }
    {
      const formatEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatRangeProvider',
        code.uri,
        new vscode.Range(code.positionAt(start), code.positionAt(end + text.length)),
        {
          tabSize: this.editorOptions.indentSize,
          insertSpaces: this.editorOptions.insertSpaces
        }
      );
      const edit = new vscode.WorkspaceEdit();
      for (const f of formatEdits) {
        edit.replace(code.uri, f.range, f.newText, { needsConfirmation: false, label: 'Paste on WebView' });
      }
      await vscode.workspace.applyEdit(edit);
    }
    vscode.window.visibleTextEditors.forEach(editor => {
      if (editor.document !== code) { return; }
      editor.revealRange(
        new vscode.Range(destPos, destPos), vscode.TextEditorRevealType.InCenter
      );
    });
  }

  // Reflect content of source code to WebView
  private updateWebview(webview: vscode.Webview, code: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('webVisualEditor');
    const dom = new JSDOM(code.getText(), { includeNodeLocations: true });
    const document = dom.window.document;
    if (!config.get<boolean>('allowScript')) {
      // Disable scripts in code
      document.querySelectorAll('script').forEach(el => { el.remove(); });
      document.querySelectorAll('body *, body').forEach(el => {
        // Remove event attributes
        el.removeAttribute('disabled');
        const nameToRemove = [];
        for (const attr of el.attributes) {
          if (attr.name.startsWith('on')) {
            nameToRemove.push(attr.name);
          }
        }
        nameToRemove.forEach(name => el.removeAttribute(name));
      });
    }
    document.querySelectorAll('body *, body').forEach(el => {
      // Add source code location information to all elements in body
      const location = dom.nodeLocation(el);
      if (!location) {
        // NOTE `location` can be null if the element is implicitly inserted
        // according to the HTML specification (e.g., `table > tbody`).
        return;
      }
      el.setAttribute('data-wve-code-start', location.startOffset.toString());
      el.setAttribute('data-wve-code-end', location.endOffset.toString());
    });
    // Disable links and file selection inputs
    document.body.querySelectorAll('a[href]').forEach(
      el => el.setAttribute('onclick', 'event.preventDefault(), event.stopPropagation()')
    );
    document.body.querySelectorAll('input[type=file]').forEach(el => el.setAttribute('disabled', ''));
    // - Replace URIs (mainly for CSS files) to be handled in sandbox of WebView
    // - Save resource path to update WebView when it changes
    ['href', 'src'].forEach(attr => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        if (el.tagName === 'A') { return; }
        const uri = el.getAttribute(attr)!;
        if (!this.isRelativePath(uri)) { return; }
        this.addToResources(code, uri);
        const safeUri = webview.asWebviewUri(
          vscode.Uri.file(path.join(path.dirname(code.uri.fsPath), uri))
        ).toString();
        el.setAttribute(attr, safeUri);
      });
    });
    // Add code id
    const embeddedScript = document.createElement('script');
    embeddedScript.textContent = `const wve = ${JSON.stringify({
      codeId: code.uri.toString(), config
    })}`;
    document.head.appendChild(embeddedScript);
    // Default style
    const defaultStyle = document.createElement('style');
    defaultStyle.textContent = 'html, body { background-color: white; }';
    document.head.prepend(defaultStyle);
    // Incorporate CSS files into layer and lower their priority
    const style = document.createElement('style');
    document.querySelectorAll('link[href][rel=stylesheet]').forEach(el => {
      style.append(`@import url('${el.getAttribute('href')}') layer(user-style);\n`);
      el.remove();
    });
    style.id = 'wve-user-css-imports';
    document.head.appendChild(style);
    // Incorporate resources on WebView side
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href',
      webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'style.css'))
      ).toString()
    );
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.setAttribute('src',
      webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'webview.js'))
      ).toString()
    );
    document.head.appendChild(script);
    // Add timestamp to ensure update WebView
    // NOTE WebView has HTML cache, and if the same string is set consecutively,
    // it will not reflect it even if actual HTML on the WebView has been updated.
    const timestamp = document.createElement('meta');
    timestamp.setAttribute('name', 'wve-timestamp');
    timestamp.setAttribute('value', (new Date()).toISOString());
    document.head.appendChild(timestamp);
    webview.html = dom.serialize();
  }

  private getNiceRanges(code: vscode.TextDocument, ranges: any): vscode.Range[] {
    return ranges.map((range: any) => {
      let start = code.positionAt(range.codeRange.start);
      const lineStart = code.lineAt(start.line);
      if (start.character === lineStart.firstNonWhitespaceCharacterIndex) {
        start = lineStart.range.start;
      }
      let end = code.positionAt(range.codeRange.end);
      const lineEnd = code.lineAt(end.line);
      if (end.isEqual(lineEnd.range.end)) {
        end = lineEnd.rangeIncludingLineBreak.end;
      }
      return new vscode.Range(start, end);
    });
  }

  private addToResources(code: vscode.TextDocument, uri: string) {
    const filepath = path.join(path.dirname(code.uri.fsPath), uri);
    if (this.resources.has(filepath)) {
      this.resources.get(filepath)?.add(code);
    } else {
      this.resources.set(filepath, new Set([code]));
    }
  }

  private isRelativePath(path: string) {
    try {
      new URL(path);
      return false;
    } catch (e) {
      return !path.startsWith('/');
    }
  }

  private shortName(el: Element) {
    return (
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + Array.from(el.classList).map(c => `.${c}`).join('')
    );
  }
}
