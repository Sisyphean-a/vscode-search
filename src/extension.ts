import * as vscode from 'vscode';
import { searchKeywordsIntersection, openFileAndHighlight } from './search';
import { showSearchResults, showDetailedResults, SearchResultTreeProvider } from './resultView';

/**
 * 扩展激活时调用
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('关键词交集搜索扩展已激活');

    // 创建树视图提供器
    const treeProvider = new SearchResultTreeProvider();

    // 注册树视图
    const treeView = vscode.window.createTreeView('intersectionSearchResults', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // 注册搜索命令
    const searchCommand = vscode.commands.registerCommand('intersectionSearch.searchKeywords', async () => {
        try {
            // 显示输入框让用户输入关键词
            const input = await vscode.window.showInputBox({
                prompt: '请输入关键词（多个词用空格分隔，例如：项目代码 项目名称）',
                placeHolder: '关键词1 关键词2 关键词3...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '请输入至少一个关键词';
                    }
                    const keywords = value.trim().split(/\s+/);
                    if (keywords.length < 2) {
                        return '请输入至少两个关键词以进行交集搜索';
                    }
                    return null;
                }
            });

            if (!input) {
                return; // 用户取消了输入
            }

            // 解析关键词
            const keywords = input.trim().split(/\s+/).filter(k => k.length > 0);
            
            if (keywords.length < 2) {
                vscode.window.showWarningMessage('请输入至少两个关键词进行交集搜索');
                return;
            }

            // 显示进度条
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在搜索包含所有关键词的文件...`,
                cancellable: true
            }, async (progress, token) => {
                try {
                    // 执行搜索
                    const results = await searchKeywordsIntersection(keywords, progress, token);
                    
                    if (token.isCancellationRequested) {
                        return;
                    }

                    // 显示搜索结果
                    await showSearchResults(keywords, results);

                    // 更新树视图
                    treeProvider.updateResults(keywords, results);

                    // 显示详细结果到输出面板
                    showDetailedResults(keywords, results);

                } catch (error) {
                    console.error('搜索过程中发生错误:', error);
                    vscode.window.showErrorMessage(`搜索失败: ${error instanceof Error ? error.message : '未知错误'}`);
                }
            });

        } catch (error) {
            console.error('命令执行失败:', error);
            vscode.window.showErrorMessage(`命令执行失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    });

    // 注册打开文件命令
    const openFileCommand = vscode.commands.registerCommand('intersectionSearch.openFile',
        async (filePath: string, keywords: string[], searchResult: any) => {
            await openFileAndHighlight(filePath, keywords, searchResult);
        }
    );

    // 将命令添加到订阅列表
    context.subscriptions.push(searchCommand, openFileCommand, treeView);
}

/**
 * 扩展停用时调用
 */
export function deactivate() {
    console.log('关键词交集搜索扩展已停用');
}
