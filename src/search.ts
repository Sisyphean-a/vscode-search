import * as vscode from 'vscode';
import * as path from 'path';
import { containsAllKeywords, getConfiguration, shouldIgnoreFile, SearchResult } from './utils';

/**
 * 执行关键词交集搜索
 */
export async function searchKeywordsIntersection(
    keywords: string[],
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchResult[]> {
    const config = getConfiguration();
    const results: SearchResult[] = [];
    
    // 获取工作区文件夹
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('没有打开的工作区文件夹');
    }

    progress.report({ message: '正在扫描文件...', increment: 0 });

    try {
        // 查找所有符合条件的文件
        const allFiles = await findAllFiles(config.includePatterns, config.ignorePatterns);
        
        if (token.isCancellationRequested) {
            return [];
        }

        if (allFiles.length === 0) {
            vscode.window.showInformationMessage('没有找到符合条件的文件');
            return [];
        }

        progress.report({ 
            message: `找到 ${allFiles.length} 个文件，开始搜索关键词...`,
            increment: 10 
        });

        // 搜索每个文件
        const totalFiles = allFiles.length;
        let processedFiles = 0;
        const batchSize = 10; // 批量处理文件数量

        for (let i = 0; i < allFiles.length; i += batchSize) {
            if (token.isCancellationRequested) {
                break;
            }

            const batch = allFiles.slice(i, i + batchSize);
            const batchPromises = batch.map(async (file) => {
                try {
                    const result = await containsAllKeywords(
                        file.fsPath,
                        keywords,
                        config.caseSensitive
                    );
                    return result;
                } catch (error) {
                    console.error(`搜索文件失败: ${file.fsPath}`, error);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            
            // 收集有效结果
            for (const result of batchResults) {
                if (result) {
                    results.push(result);
                }
            }

            processedFiles += batch.length;
            const progressPercent = Math.floor((processedFiles / totalFiles) * 80) + 10; // 10-90%
            
            progress.report({
                message: `已搜索 ${processedFiles}/${totalFiles} 个文件，找到 ${results.length} 个匹配文件`,
                increment: progressPercent - (progress as any).value || 0
            });
        }

        progress.report({ 
            message: `搜索完成！找到 ${results.length} 个包含所有关键词的文件`,
            increment: 100 
        });

        // 按文件路径排序
        results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        return results;

    } catch (error) {
        console.error('搜索过程中发生错误:', error);
        throw error;
    }
}

/**
 * 查找所有符合条件的文件
 */
async function findAllFiles(
    includePatterns: string[],
    ignorePatterns: string[]
): Promise<vscode.Uri[]> {
    const allFiles: vscode.Uri[] = [];
    
    // 对每个包含模式进行搜索
    for (const pattern of includePatterns) {
        try {
            const files = await vscode.workspace.findFiles(
                pattern,
                undefined, // 不在这里使用exclude，我们手动过滤
                10000 // 最大文件数限制
            );
            
            // 过滤掉应该忽略的文件
            const filteredFiles = files.filter(file => 
                !shouldIgnoreFile(file.fsPath, ignorePatterns)
            );
            
            allFiles.push(...filteredFiles);
        } catch (error) {
            console.error(`搜索模式 ${pattern} 失败:`, error);
        }
    }
    
    // 去重（同一个文件可能匹配多个模式）
    const uniqueFiles = Array.from(
        new Map(allFiles.map(file => [file.fsPath, file])).values()
    );
    
    return uniqueFiles;
}

/**
 * 获取文件的相对路径
 */
export function getRelativePath(filePath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        return path.relative(workspaceFolder.uri.fsPath, filePath);
    }
    return filePath;
}

/**
 * 打开文件并跳转到第一个匹配位置
 */
export async function openFileAndHighlight(
    filePath: string,
    keywords: string[],
    searchResult?: SearchResult
): Promise<void> {
    try {
        // 打开文件
        const document = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(document);
        
        if (searchResult && searchResult.matches.length > 0) {
            // 跳转到第一个匹配位置
            const firstMatch = searchResult.matches[0];
            if (firstMatch.positions.length > 0) {
                const position = new vscode.Position(
                    firstMatch.positions[0].line - 1, // VSCode使用0基索引
                    firstMatch.positions[0].column - 1
                );
                
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position));
            }
            
            // 高亮显示所有关键词
            await highlightKeywords(editor, keywords, searchResult);
        }
        
    } catch (error) {
        console.error(`打开文件失败: ${filePath}`, error);
        vscode.window.showErrorMessage(`无法打开文件: ${path.basename(filePath)}`);
    }
}

/**
 * 在编辑器中高亮显示关键词
 */
async function highlightKeywords(
    editor: vscode.TextEditor,
    keywords: string[],
    searchResult: SearchResult
): Promise<void> {
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder')
    });
    
    const ranges: vscode.Range[] = [];
    
    // 收集所有匹配位置
    for (const match of searchResult.matches) {
        for (const position of match.positions) {
            const startPos = new vscode.Position(
                position.line - 1,
                position.column - 1
            );
            const endPos = new vscode.Position(
                position.line - 1,
                position.column - 1 + match.keyword.length
            );
            ranges.push(new vscode.Range(startPos, endPos));
        }
    }
    
    // 应用高亮
    editor.setDecorations(decorationType, ranges);
    
    // 5秒后清除高亮
    setTimeout(() => {
        decorationType.dispose();
    }, 5000);
}
