import * as vscode from 'vscode';
import { searchKeywordsIntersection } from './search';
import { SearchResult } from './utils';
import { showDetailedResults, SearchResultTreeProvider } from './resultView';

/**
 * Webview搜索面板类
 */
export class SearchWebviewPanel {
    public static currentPanel: SearchWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _treeProvider: SearchResultTreeProvider | undefined;

    public static createOrShow(extensionUri: vscode.Uri, treeProvider?: SearchResultTreeProvider) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已经有面板存在，则显示它
        if (SearchWebviewPanel.currentPanel) {
            SearchWebviewPanel.currentPanel._panel.reveal(column);
            if (treeProvider) {
                SearchWebviewPanel.currentPanel._treeProvider = treeProvider;
            }
            return SearchWebviewPanel.currentPanel;
        }

        // 否则，创建新的面板
        const panel = vscode.window.createWebviewPanel(
            'intersectionSearch',
            '关键词交集搜索',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out')
                ]
            }
        );

        SearchWebviewPanel.currentPanel = new SearchWebviewPanel(panel, extensionUri);
        if (treeProvider) {
            SearchWebviewPanel.currentPanel._treeProvider = treeProvider;
        }
        return SearchWebviewPanel.currentPanel;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        SearchWebviewPanel.currentPanel = new SearchWebviewPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 设置初始HTML内容
        this._update();

        // 监听面板关闭事件
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自webview的消息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'search':
                        await this._handleSearch(message.keywords);
                        break;
                    case 'openFile':
                        await this._handleOpenFile(message.filePath, message.keywords);
                        break;
                    case 'getConfig':
                        await this._handleGetConfig();
                        break;
                    case 'updateConfig':
                        await this._handleUpdateConfig(message.config);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        SearchWebviewPanel.currentPanel = undefined;

        // 清理资源
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = '关键词交集搜索';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 获取样式和脚本的URI
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css')
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css')
        );
        const styleMainUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
        );

        // 使用nonce来确保只有我们的脚本可以运行
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>关键词交集搜索</title>
            </head>
            <body>
                <div class="search-container">
                    <div class="search-header">
                        <h1>🔍 关键词交集搜索</h1>
                    </div>
                    
                    <div class="search-input-section">
                        <div class="input-group">
                            <input type="text" id="keywordsInput" placeholder="输入关键词（空格分隔）..." />
                            <button id="searchBtn" class="search-btn">搜索</button>
                        </div>
                        
                        <div class="search-options">
                            <label class="checkbox-label">
                                <input type="checkbox" id="caseSensitive" />
                                <span class="checkmark"></span>
                                区分大小写
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="includeSubdirs" checked />
                                <span class="checkmark"></span>
                                包含子目录
                            </label>
                        </div>
                    </div>

                    <div class="search-progress" id="searchProgress" style="display: none;">
                        <div class="progress-bar">
                            <div class="progress-fill" id="progressFill"></div>
                        </div>
                        <div class="progress-text" id="progressText">正在搜索...</div>
                    </div>

                    <div class="search-stats" id="searchStats" style="display: none;">
                        <span id="statsText">找到 0 个文件</span>
                    </div>

                    <div class="search-results" id="searchResults">
                        <div class="no-results" id="noResults">
                            <p>输入关键词开始搜索</p>
                        </div>
                    </div>

                    <div class="search-actions">
                        <div class="action-buttons">
                            <button id="configBtn" class="action-btn">⚙️ 配置</button>
                            <button id="clearBtn" class="action-btn">🗑️ 清除</button>
                            <button id="exportBtn" class="action-btn" disabled>📤 导出结果</button>
                        </div>
                        <div class="keyboard-shortcuts">
                            <span class="shortcut">Ctrl+Enter</span> 搜索 |
                            <span class="shortcut">Ctrl+K</span> 聚焦 |
                            <span class="shortcut">Esc</span> 清除
                        </div>
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async _handleSearch(keywords: string[]) {
        if (!keywords || keywords.length === 0) {
            this._panel.webview.postMessage({
                command: 'searchError',
                message: '请输入至少一个关键词'
            });
            return;
        }

        try {
            // 发送搜索开始消息
            this._panel.webview.postMessage({
                command: 'searchStarted',
                keywords: keywords
            });

            // 创建进度报告器
            const progress = {
                report: (value: { message?: string; increment?: number }) => {
                    this._panel.webview.postMessage({
                        command: 'searchProgress',
                        progress: value
                    });
                }
            };

            // 创建取消令牌
            const tokenSource = new vscode.CancellationTokenSource();
            
            // 执行搜索
            const results = await searchKeywordsIntersection(keywords, progress, tokenSource.token);

            // 发送搜索结果到webview
            this._panel.webview.postMessage({
                command: 'searchCompleted',
                results: results,
                keywords: keywords
            });

            // 更新树视图（如果存在）
            if (this._treeProvider) {
                this._treeProvider.updateResults(keywords, results);
                // 设置上下文以显示树视图
                vscode.commands.executeCommand('setContext', 'intersectionSearch:hasResults', results.length > 0);
            }

            // 显示详细结果到输出面板
            showDetailedResults(keywords, results);

        } catch (error) {
            console.error('搜索过程中发生错误:', error);
            this._panel.webview.postMessage({
                command: 'searchError',
                message: error instanceof Error ? error.message : '搜索失败'
            });
        }
    }

    private async _handleOpenFile(filePath: string, keywords: string[]) {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // 高亮关键词
            if (keywords && keywords.length > 0) {
                await this._highlightKeywords(editor, keywords);
            }
        } catch (error) {
            console.error('打开文件失败:', error);
            vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
        }
    }

    private async _highlightKeywords(editor: vscode.TextEditor, keywords: string[]) {
        const document = editor.document;
        const text = document.getText();
        const config = vscode.workspace.getConfiguration('intersectionSearch');
        const caseSensitive = config.get('caseSensitive', false);

        // 创建装饰类型
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.3)',
            border: '1px solid rgba(255, 255, 0, 0.8)',
            borderRadius: '2px'
        });

        const ranges: vscode.Range[] = [];

        keywords.forEach(keyword => {
            const searchText = caseSensitive ? text : text.toLowerCase();
            const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();

            let index = 0;
            while ((index = searchText.indexOf(searchKeyword, index)) !== -1) {
                const startPos = document.positionAt(index);
                const endPos = document.positionAt(index + keyword.length);
                ranges.push(new vscode.Range(startPos, endPos));
                index += keyword.length;
            }
        });

        editor.setDecorations(decorationType, ranges);

        // 跳转到第一个匹配位置
        if (ranges.length > 0) {
            editor.selection = new vscode.Selection(ranges[0].start, ranges[0].start);
            editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
        }
    }

    private async _handleGetConfig() {
        const config = vscode.workspace.getConfiguration('intersectionSearch');
        this._panel.webview.postMessage({
            command: 'configData',
            config: {
                caseSensitive: config.get('caseSensitive', false),
                maxFileSize: config.get('maxFileSize', 1048576),
                includePatterns: config.get('includePatterns', []),
                ignorePatterns: config.get('ignorePatterns', [])
            }
        });
    }

    private async _handleUpdateConfig(configData: any) {
        const config = vscode.workspace.getConfiguration('intersectionSearch');

        try {
            const updates: Thenable<void>[] = [];

            if (configData.caseSensitive !== undefined) {
                updates.push(config.update('caseSensitive', configData.caseSensitive, vscode.ConfigurationTarget.Workspace));
            }

            if (configData.maxFileSize !== undefined) {
                updates.push(config.update('maxFileSize', configData.maxFileSize, vscode.ConfigurationTarget.Workspace));
            }

            if (configData.includePatterns !== undefined) {
                updates.push(config.update('includePatterns', configData.includePatterns, vscode.ConfigurationTarget.Workspace));
            }

            if (configData.ignorePatterns !== undefined) {
                updates.push(config.update('ignorePatterns', configData.ignorePatterns, vscode.ConfigurationTarget.Workspace));
            }

            await Promise.all(updates);

            this._panel.webview.postMessage({
                command: 'configUpdated',
                success: true
            });

            vscode.window.showInformationMessage('配置已保存');

        } catch (error) {
            console.error('更新配置失败:', error);
            this._panel.webview.postMessage({
                command: 'configUpdated',
                success: false,
                message: '配置更新失败'
            });

            vscode.window.showErrorMessage('配置保存失败: ' + (error instanceof Error ? error.message : '未知错误'));
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
