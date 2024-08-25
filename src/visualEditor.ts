import * as vscode from 'vscode';

import { JSDOM } from 'jsdom';
import beautify from 'js-beautify';
import path from 'path';

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {

  private readonly context: vscode.ExtensionContext;
  private editorOptions = { insertSpaces: true, indentSize: 2 };
  private readonly codes = new Map<vscode.TextDocument, Set<vscode.WebviewPanel>>();
  private readonly editedBy = new Set<vscode.WebviewPanel>();

  constructor(private readonly ec: vscode.ExtensionContext) {
    this.context = ec;
    // Get and update indentation setting
    const config = vscode.workspace.getConfiguration('editor', { languageId: 'html' });
    Object.assign(this.editorOptions, {
      insertSpaces: !!config.get('insertSpaces'),
      indentSize: config.get('tabSize')
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
        if (this.editedBy.delete(panel)) { return; }
        this.updateWebview(panel.webview, code);
      });
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
    // Initialize WebView
    panel.webview.options = { enableScripts: true };
    panel.onDidDispose(() => {
      this.codes.get(code)?.delete(panel);
      this.editedBy.delete(panel);
      if (this.codes.get(code)?.size === 0) {
        this.codes.delete(code);
      }
    });
    // Event notification from WebView
    panel.webview.onDidReceiveMessage(event => {
      console.debug(event);
      switch (event.type) {
        case 'edit':
          if (this.editElements(code, event)) {
            this.editedBy.add(panel);
          }
          return;
        case 'copy':
        case 'cut':
          this.copyOrCutElements(code, event);
          return;
        case 'paste':
          this.pasteElements(code, event);
          return;
      }
    });
    // Update webview
    this.updateWebview(panel.webview, code);
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
        fragment.setAttribute('style', operation.style);
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

  // Copy or Cut process on WebView
  private copyOrCutElements(code: vscode.TextDocument, event: any) {
    const ranges = event.data.map((operation: any) => {
      let start = code.positionAt(operation.codeRange.start);
      const lineStart = code.lineAt(start.line);
      if (start.character === lineStart.firstNonWhitespaceCharacterIndex) {
        start = lineStart.range.start;
      }
      let end = code.positionAt(operation.codeRange.end);
      const lineEnd = code.lineAt(end.line);
      if (end.isEqual(lineEnd.range.end)) {
        end = lineEnd.rangeIncludingLineBreak.end;
      }
      return new vscode.Range(start, end);
    });
    vscode.env.clipboard.writeText(
      this.formatHtml(
        ranges.map((range: vscode.Range) => code.getText(range)).join('\n')
      ) + '\n'
    );
    if (event.type === 'cut') {
      const edit = new vscode.WorkspaceEdit();
      ranges.forEach((range: vscode.Range) => edit.delete(code.uri, range));
      vscode.workspace.applyEdit(edit);
    }
  }

  // TODO Paste process on WebView
  private pasteElements(code: vscode.TextDocument, event: any) {
  }

  // Reflect content of source code to WebView
  private updateWebview(webview: vscode.Webview, code: vscode.TextDocument) {
    const dom = new JSDOM(code.getText(), { includeNodeLocations: true });
    const document = dom.window.document;
    // Disable scripts in code
    // NOTE Event scripts specified as element attributes are not disabled,
    // but for performance reasons, they are not disabled.
    document.querySelectorAll('script').forEach(el => { el.remove(); });
    // Disable links and file selection inputs
    document.querySelectorAll('a[href]').forEach(
      el => el.setAttribute('onclick', 'event.preventDefault(), event.stopPropagation()')
    );
    document.querySelectorAll('input[type=file]').forEach(el => el.setAttribute('disabled', ''));
    // Replace various URIs (mainly for CSS files) to be handled securely by WebView
    ['href', 'src'].forEach(attr => {
      document.querySelectorAll(`[${attr}]`).forEach(el => {
        if (el.tagName === 'A') { return; }
        const href = el.getAttribute(attr);
        if (!href || href.includes('//')) { return; }
        const safeUri = webview.asWebviewUri(
          vscode.Uri.file(path.join(path.dirname(code.uri.fsPath), href))
        ).toString();
        el.setAttribute(attr, safeUri);
      });
    });
    // Incorporate CSS files into layer and lower their priority
    const style = document.createElement('style');
    document.querySelectorAll('link[href][rel=stylesheet]').forEach(el => {
      style.append(`@import url('${el.getAttribute('href')}') layer(base);\n`);
      el.remove();
    });
    document.head.appendChild(style);
    // Incorporate resources on WebView side
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href',
      webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'style.css'))
      ).toString()
    );
    document.head.prepend(link);
    const script = document.createElement('script');
    script.setAttribute('src',
      webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'webview.js'))
      ).toString()
    );
    document.head.appendChild(script);
    // Add source code location information to all elements in body
    document.body.querySelectorAll('*').forEach(el => {
      const location = dom.nodeLocation(el);
      if (!location) { throw Error(`Failed to get nodeLocation of element ${el}`); }
      el.setAttribute('data-wve-code-start', location.startOffset.toString());
      el.setAttribute('data-wve-code-end', location.endOffset.toString());
    });
    // Add timestamp to ensure update WebView
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
}
