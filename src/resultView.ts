import * as vscode from 'vscode';
import * as path from 'path';
import { SearchResult, formatFileSize } from './utils';

// 全局输出通道管理器
export class OutputChannelManager {
    private static instance: OutputChannelManager;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('关键词交集搜索');
    }

    public static getInstance(): OutputChannelManager {
        if (!OutputChannelManager.instance) {
            OutputChannelManager.instance = new OutputChannelManager();
        }
        return OutputChannelManager.instance;
    }

    public getChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}
import { openFileAndHighlight } from './search';

/**
 * 搜索结果项接口
 */
interface SearchResultItem extends vscode.QuickPickItem {
    searchResult: SearchResult;
    keywords: string[];
}

/**
 * 显示搜索结果
 */
export async function showSearchResults(keywords: string[], results: SearchResult[]): Promise<void> {
    if (results.length === 0) {
        vscode.window.showInformationMessage(
            `没有找到同时包含所有关键词 [${keywords.join(', ')}] 的文件`
        );
        return;
    }

    // 创建QuickPick项
    const quickPickItems: SearchResultItem[] = results.map(result => {
        const totalMatches = result.matches.reduce((sum, match) => sum + match.positions.length, 0);
        const matchInfo = result.matches.map(match => 
            `${match.keyword}(${match.positions.length})`
        ).join(', ');
        
        return {
            label: `$(file) ${path.basename(result.relativePath)}`,
            description: result.relativePath,
            detail: `匹配: ${matchInfo} | 大小: ${formatFileSize(result.fileSize)} | 总匹配数: ${totalMatches}`,
            searchResult: result,
            keywords: keywords
        };
    });

    // 显示快速选择器
    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `找到 ${results.length} 个文件包含所有关键词 [${keywords.join(', ')}]`,
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false
    });

    if (selectedItem) {
        // 打开选中的文件并高亮显示
        await openFileAndHighlight(
            selectedItem.searchResult.filePath,
            selectedItem.keywords,
            selectedItem.searchResult
        );
    }
}

/**
 * 在输出面板显示详细搜索结果
 * @param keywords 搜索关键词
 * @param results 搜索结果
 * @param autoShow 是否自动显示输出面板，默认为false（不自动显示）
 */
export function showDetailedResults(keywords: string[], results: SearchResult[], autoShow: boolean = false): void {
    const outputChannel = OutputChannelManager.getInstance().getChannel();
    outputChannel.clear();

    if (results.length === 0) {
        outputChannel.appendLine(`没有找到同时包含所有关键词的文件:`);
        outputChannel.appendLine(`关键词: [${keywords.join(', ')}]`);
        outputChannel.appendLine('');
        outputChannel.appendLine('建议:');
        outputChannel.appendLine('1. 检查关键词拼写');
        outputChannel.appendLine('2. 尝试减少关键词数量');
        outputChannel.appendLine('3. 检查文件类型配置');

        // 只有在明确要求显示时才自动打开输出面板
        if (autoShow) {
            outputChannel.show();
        }
        return;
    }

    // 显示搜索摘要
    outputChannel.appendLine(`关键词交集搜索结果`);
    outputChannel.appendLine(`${'='.repeat(50)}`);
    outputChannel.appendLine(`搜索关键词: [${keywords.join(', ')}]`);
    outputChannel.appendLine(`找到文件数: ${results.length}`);
    outputChannel.appendLine(`搜索时间: ${new Date().toLocaleString()}`);
    outputChannel.appendLine('');

    // 显示每个文件的详细信息
    results.forEach((result, index) => {
        outputChannel.appendLine(`${index + 1}. ${result.relativePath}`);
        outputChannel.appendLine(`   文件大小: ${formatFileSize(result.fileSize)}`);
        
        // 显示每个关键词的匹配情况
        result.matches.forEach(match => {
            outputChannel.appendLine(`   关键词 "${match.keyword}": ${match.positions.length} 处匹配`);
            
            // 显示前3个匹配位置
            const displayPositions = match.positions.slice(0, 3);
            displayPositions.forEach(pos => {
                outputChannel.appendLine(`     第${pos.line}行,第${pos.column}列: ${pos.lineText}`);
            });
            
            if (match.positions.length > 3) {
                outputChannel.appendLine(`     ... 还有 ${match.positions.length - 3} 处匹配`);
            }
        });
        
        outputChannel.appendLine('');
    });

    // 显示统计信息
    const totalMatches = results.reduce((sum, result) => 
        sum + result.matches.reduce((matchSum, match) => matchSum + match.positions.length, 0), 0
    );
    
    outputChannel.appendLine(`统计信息:`);
    outputChannel.appendLine(`- 总匹配次数: ${totalMatches}`);
    outputChannel.appendLine(`- 平均每文件匹配: ${(totalMatches / results.length).toFixed(1)} 次`);
    
    const totalSize = results.reduce((sum, result) => sum + result.fileSize, 0);
    outputChannel.appendLine(`- 文件总大小: ${formatFileSize(totalSize)}`);

    // 只有在明确要求显示时才自动打开输出面板
    if (autoShow) {
        outputChannel.show();
    }
}

/**
 * 创建搜索结果树视图提供器
 */
export class SearchResultTreeProvider implements vscode.TreeDataProvider<SearchResultTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SearchResultTreeItem | undefined | null | void> = new vscode.EventEmitter<SearchResultTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SearchResultTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private results: SearchResult[] = [];
    private keywords: string[] = [];

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    updateResults(keywords: string[], results: SearchResult[]): void {
        this.keywords = keywords;
        this.results = results;
        this.refresh();
    }

    getTreeItem(element: SearchResultTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SearchResultTreeItem): Thenable<SearchResultTreeItem[]> {
        if (!element) {
            // 根节点 - 返回所有文件
            return Promise.resolve(
                this.results.map(result => new SearchResultTreeItem(
                    path.basename(result.relativePath),
                    result.relativePath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    result,
                    this.keywords
                ))
            );
        } else if (element.searchResult) {
            // 文件节点 - 返回关键词匹配
            return Promise.resolve(
                element.searchResult.matches.map(match => new SearchResultTreeItem(
                    `${match.keyword} (${match.positions.length} 处匹配)`,
                    `关键词: ${match.keyword}`,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    this.keywords,
                    match
                ))
            );
        }
        
        return Promise.resolve([]);
    }
}

/**
 * 搜索结果树项
 */
export class SearchResultTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly searchResult?: SearchResult,
        public readonly keywords?: string[],
        public readonly match?: any
    ) {
        super(label, collapsibleState);

        this.tooltip = tooltip;

        if (searchResult) {
            // 文件节点
            this.iconPath = new vscode.ThemeIcon('file');
            this.command = {
                command: 'intersectionSearch.openFile',
                title: '打开文件',
                arguments: [searchResult.filePath, keywords, searchResult]
            };
            this.contextValue = 'searchResultFile';
        } else if (match) {
            // 关键词匹配节点
            this.iconPath = new vscode.ThemeIcon('search');
            this.contextValue = 'searchResultMatch';
        }
    }
}
