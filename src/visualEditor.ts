import * as vscode from 'vscode';

import { JSDOM } from 'jsdom';
import beautify from 'js-beautify';
import he from 'he';
import path from 'path';

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {

  public activeCode: vscode.TextDocument | null = null;

  private editorOptions = { insertSpaces: true, indentSize: 2, indentChar: ' ', indentUnit: '  ' };
  private readonly context: vscode.ExtensionContext;
  private readonly codes = new Map<vscode.TextDocument, Set<vscode.WebviewPanel>>();
  private readonly editedBy = new Set<vscode.WebviewPanel>();

  constructor(private readonly ec: vscode.ExtensionContext) {
    this.context = ec;
    // Get and update indentation setting
    const config = vscode.workspace.getConfiguration('editor', { languageId: 'html' });
    const insertSpaces = config.get<boolean>('insertSpaces');
    const indentSize = config.get<number>('tabSize')!;
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
    // Process when source code changes
    vscode.workspace.onDidChangeTextDocument(event => {
      const code = event.document;
      if (!this.codes.has(code) || event.contentChanges.length === 0) {
        return;
      }
      this.codes.get(code)!.forEach(panel => {
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
      const { insertSpaces, indentSize } = this.editorOptions;
      const indentLevel = Math.ceil(
        code.lineAt(range.start.line).firstNonWhitespaceCharacterIndex
        / (insertSpaces ? indentSize : 1)
      );
      const html = this.formatHtml(fragment.outerHTML, { indent_level: indentLevel }).trimStart();
      edit.replace(code.uri, range, html, { needsConfirmation: false, label: 'Edit on WebView' });
    });
    if (shouldEdit) {
      vscode.workspace.applyEdit(edit);
    }
    return shouldEdit;
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

  private deleteElements(code: vscode.TextDocument, ranges: vscode.Range[]) {
    const edit = new vscode.WorkspaceEdit();
    ranges.forEach((range: vscode.Range) => edit.delete(code.uri, range));
    vscode.workspace.applyEdit(edit);
  }

  // Copy process on WebView
  private copyElements(code: vscode.TextDocument, ranges: vscode.Range[]) {
    vscode.env.clipboard.writeText(
      this.formatHtml(
        ranges.map((range: vscode.Range) => code.getText(range)).join('\n')
      ) + '\n'
    );
  }

  // Paste process on WebView
  private async pasteToElement(code: vscode.TextDocument, event: any) {
    const clipboard = (await vscode.env.clipboard.readText()).trim();
    if (clipboard.length === 0) { return; }
    const { start, end } = event.data.codeRange;
    const destPos = code.positionAt(
      start + code.getText(
        new vscode.Range(code.positionAt(start), code.positionAt(end))
      ).lastIndexOf('</')
    );
    const { insertSpaces, indentSize, indentUnit } = this.editorOptions;
    const startColumn = code.lineAt(destPos.line).firstNonWhitespaceCharacterIndex;
    const indentLevel = Math.ceil(startColumn / (insertSpaces ? indentSize : 1));
    const startLine = code.lineAt(destPos.line);
    const isTextStart = destPos.character === startLine.firstNonWhitespaceCharacterIndex;
    const indentText = indentUnit.repeat(indentLevel);
    const text = (isTextStart ? '' : '\n' + indentText) + indentUnit + (
      event.data.isHtml
        ? this.formatHtml(clipboard, { indent_level: indentLevel + 1 }).trimStart()
        : he.escape(clipboard)
    ) + '\n' + indentText;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(code.uri, destPos, text, { needsConfirmation: false, label: 'Paste on WebView' });
    vscode.workspace.applyEdit(edit);
    vscode.window.visibleTextEditors.forEach(editor => {
      if (editor.document !== code) { return; }
      editor.selection = new vscode.Selection(
        isTextStart ? destPos.with({ character: 0 }) : destPos,
        destPos.with({
          line: destPos.line + Array.from(text.matchAll(/\n/g)).length - 1,
          character: text.split('\n').at(-2)!.length + indentUnit.length
        })
      );
      editor.revealRange(
        new vscode.Range(destPos, destPos), vscode.TextEditorRevealType.InCenter
      );
    });

  }

  // Reflect content of source code to WebView
  private updateWebview(webview: vscode.Webview, code: vscode.TextDocument) {
    const dom = new JSDOM(code.getText(), { includeNodeLocations: true });
    const document = dom.window.document;
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
      // Add source code location information to all elements in body
      const location = dom.nodeLocation(el);
      if (!location) { throw Error(`Failed to get nodeLocation of element ${el}`); }
      el.setAttribute('data-wve-code-start', location.startOffset.toString());
      el.setAttribute('data-wve-code-end', location.endOffset.toString());
    });
    // Disable links and file selection inputs
    document.body.querySelectorAll('a[href]').forEach(
      el => el.setAttribute('onclick', 'event.preventDefault(), event.stopPropagation()')
    );
    document.body.querySelectorAll('input[type=file]').forEach(el => el.setAttribute('disabled', ''));
    // Replace URIs (mainly for CSS files) to be handled in sandbox of WebView
    ['href', 'src'].forEach(attr => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        if (el.tagName === 'A') { return; }
        const uri = el.getAttribute(attr);
        if (!uri || uri.includes('//')) { return; }
        const safeUri = webview.asWebviewUri(
          vscode.Uri.file(path.join(path.dirname(code.uri.fsPath), uri))
        ).toString();
        el.setAttribute(attr, safeUri);
      });
    });
    // Add code id
    const codeId = document.createElement('script');
    codeId.textContent = `const codeId = '${code.uri.toString()}';`;
    document.head.appendChild(codeId);
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
    timestamp.setAttribute('name', 'timestamp');
    timestamp.setAttribute('value', (new Date()).toISOString());
    document.head.appendChild(timestamp);
    webview.html = dom.serialize();
  }

  private formatHtml(
    html: string, options: js_beautify.HTMLBeautifyOptions = {}
  ): string {
    const formatOptions = Object.assign({
      indent_with_tabs: !this.editorOptions.insertSpaces,
      indent_char: this.editorOptions.insertSpaces ? ' ' : '\t',
      indent_size: this.editorOptions.indentSize
    }, options);
    return beautify.html(html, formatOptions);
  }

  private shortName(el: Element) {
    return (
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + Array.from(el.classList).map(c => `.${c}`).join('')
    );
  }
}
