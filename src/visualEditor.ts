import * as vscode from 'vscode';

import { JSDOM } from 'jsdom';
import beautify from 'js-beautify';
import path from 'path';

export class VisualEditorProvider implements vscode.CustomTextEditorProvider {

  private readonly context: vscode.ExtensionContext;

  constructor(private readonly ec: vscode.ExtensionContext) {
    this.context = ec;
  }

  public async resolveCustomTextEditor(
    code: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _: vscode.CancellationToken
  ): Promise<void> {
    // Retrieve editor options from the panel opening source
    // NOTE Each member of options is an accessor and is not retained until another event, so save as a clone
    const editorOptions = {
      ...vscode.window.visibleTextEditors.find(e => e.document === code)?.options!
    };
    // Initialize WebView
    panel.webview.options = { enableScripts: true };
    panel.onDidDispose(() => { subscription.dispose(); });
    this.updateWebview(panel.webview, code);

    // Process when the source code changes
    const subscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document !== code || event.contentChanges.length === 0) {
        return;
      }
      this.updateWebview(panel.webview, code);
    });

    // Event notification from WebView
    panel.webview.onDidReceiveMessage(event => {
      switch (event.type) {
      case 'move':
        this.moveElements(code, editorOptions, event);
        return;
      case 'copy':
      case 'cut':
        this.copyOrCutElements(code, event);
        return;
      }
    });
  }

  // Copy process on the WebView
  private copyOrCutElements(code: vscode.TextDocument, event: any) {
    const ranges = event.data.map((operation: any) => {
      let start = code.positionAt(operation.code.start);
      const lineStart = code.lineAt(start.line);
      if (start.character === lineStart.firstNonWhitespaceCharacterIndex) {
        start = lineStart.range.start;
      }
      let end = code.positionAt(operation.code.end);
      const lineEnd = code.lineAt(end.line);
      if (end.isEqual(lineEnd.range.end)) {
        end = lineEnd.rangeIncludingLineBreak.end;
      }
      return new vscode.Range(start, end);
    });
    vscode.env.clipboard.writeText(
      ranges.map((range: vscode.Range) => code.getText(range)).join('\n')
    );
    if (event.type === 'cut') {
      const edit = new vscode.WorkspaceEdit();
      ranges.forEach((range: vscode.Range) => edit.delete(code.uri, range));
      vscode.workspace.applyEdit(edit);
    }
  }

  // Reflect element movement on the WebView side to the source code
  private moveElements(code: vscode.TextDocument, editorOptions: vscode.TextEditorOptions, event: any) {
    const edit = new vscode.WorkspaceEdit();
    event.data.forEach((operation: any) => {
      const range = new vscode.Range(
        code.positionAt(operation.code.start),
        code.positionAt(operation.code.end)
      );
      const text = code.getText(range);
      const dom = JSDOM.fragment(text).firstElementChild;
      if (dom === null) {
        throw Error(
          'Failed to create virtual DOM from code fragment of '
          + `${code.fileName}(${operation.code.start}, ${operation.code.end})\n${text}`
        );
      }
      dom.setAttribute('style', operation.style);
      const indentSize = +editorOptions.indentSize!;
      const html = beautify.html(dom.outerHTML, {
        indent_size: indentSize,
        indent_level: Math.ceil(
          code.lineAt(range.start.line).firstNonWhitespaceCharacterIndex / indentSize
        ),
        indent_char: editorOptions.insertSpaces ? ' ' : '\t'
      }).trimStart();
      edit.replace(code.uri, range, html);
    });
    vscode.workspace.applyEdit(edit);
  }

  // Reflect the content of the source code to the WebView
  private updateWebview(webview: vscode.Webview, code: vscode.TextDocument) {
    const dom = new JSDOM(code.getText(), { includeNodeLocations: true });
    const document = dom.window.document;
    // Disable scripts in the code
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
    // Incorporate CSS files into the layer and lower their priority
    const style = document.createElement('style');
    document.querySelectorAll('link[href][rel=stylesheet]').forEach(el => {
      style.append(`@import url('${el.getAttribute('href')}') layer(base);\n`);
      el.remove();
    });
    document.head.appendChild(style);
    // Incorporate resources on the WebView side
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
    // Add source code location information to all elements in the body
    document.body.querySelectorAll('*').forEach(el => {
      const location = dom.nodeLocation(el);
      if (!location) { throw Error(`Failed to get nodeLocation of the element ${el}`); }
      el.setAttribute('data-wve-code-start', location.startOffset.toString());
      el.setAttribute('data-wve-code-end', location.endOffset.toString());
    });
    webview.html = dom.serialize();
  }
}
