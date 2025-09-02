import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
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
        // 尝试使用ripgrep进行高性能搜索
        const ripgrepResults = await tryRipgrepSearch(keywords, config, progress, token);
        if (ripgrepResults !== null) {
            return ripgrepResults;
        }

        // 如果ripgrep不可用，回退到原有的JavaScript搜索
        progress.report({ message: 'ripgrep不可用，使用JavaScript搜索...', increment: 5 });

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

        // 使用优化的并行搜索
        const searchResults = await searchFilesInParallel(
            allFiles,
            keywords,
            config.caseSensitive,
            config.wholeWord,
            progress,
            token
        );

        results.push(...searchResults);

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
 * 并行搜索文件，优化性能
 */
async function searchFilesInParallel(
    files: vscode.Uri[],
    keywords: string[],
    caseSensitive: boolean,
    wholeWord: boolean,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const totalFiles = files.length;
    let processedFiles = 0;

    // 动态调整批量大小，基于文件数量和系统性能
    const cpuCount = require('os').cpus().length;
    const baseBatchSize = Math.max(5, Math.min(20, Math.ceil(cpuCount * 2)));
    const batchSize = Math.min(baseBatchSize, Math.ceil(totalFiles / 10));

    // 创建工作队列
    const workQueue: vscode.Uri[] = [...files];
    const workers: Promise<void>[] = [];
    const maxConcurrentWorkers = Math.min(cpuCount, 4); // 限制最大并发数

    // 创建工作器函数
    const createWorker = async (): Promise<void> => {
        while (workQueue.length > 0 && !token.isCancellationRequested) {
            // 从队列中取出一批文件
            const batch = workQueue.splice(0, batchSize);
            if (batch.length === 0) break;

            // 并行处理这一批文件
            const batchPromises = batch.map(async (file) => {
                try {
                    return await containsAllKeywords(
                        file.fsPath,
                        keywords,
                        caseSensitive,
                        wholeWord
                    );
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
                increment: progressPercent
            });
        }
    };

    // 启动多个工作器
    for (let i = 0; i < maxConcurrentWorkers; i++) {
        workers.push(createWorker());
    }

    // 等待所有工作器完成
    await Promise.all(workers);

    return results;
}

/**
 * 智能批量处理，根据文件大小和类型优化处理策略
 */
async function smartBatchProcess(
    files: vscode.Uri[],
    keywords: string[],
    caseSensitive: boolean,
    wholeWord: boolean,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // 按文件大小分组
    const smallFiles: vscode.Uri[] = [];
    const largeFiles: vscode.Uri[] = [];

    for (const file of files) {
        try {
            const stats = await fs.promises.stat(file.fsPath);
            if (stats.size > 100 * 1024) { // 100KB以上为大文件
                largeFiles.push(file);
            } else {
                smallFiles.push(file);
            }
        } catch (error) {
            // 如果无法获取文件信息，当作小文件处理
            smallFiles.push(file);
        }
    }

    // 先处理小文件（高并发）
    if (smallFiles.length > 0) {
        const smallFileResults = await searchFilesInParallel(
            smallFiles,
            keywords,
            caseSensitive,
            wholeWord,
            progress,
            token
        );
        results.push(...smallFileResults);
    }

    // 再处理大文件（低并发，使用流式处理）
    if (largeFiles.length > 0 && !token.isCancellationRequested) {
        const largeFileResults = await searchLargeFilesOptimized(
            largeFiles,
            keywords,
            caseSensitive,
            progress,
            token
        );
        results.push(...largeFileResults);
    }

    return results;
}

/**
 * 优化的大文件搜索
 */
async function searchLargeFilesOptimized(
    files: vscode.Uri[],
    keywords: string[],
    caseSensitive: boolean,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const batchSize = 2; // 大文件使用较小的批量大小

    for (let i = 0; i < files.length; i += batchSize) {
        if (token.isCancellationRequested) {
            break;
        }

        const batch = files.slice(i, i + batchSize);
        const batchPromises = batch.map(async (file) => {
            try {
                return await containsAllKeywords(
                    file.fsPath,
                    keywords,
                    caseSensitive
                );
            } catch (error) {
                console.error(`搜索大文件失败: ${file.fsPath}`, error);
                return null;
            }
        });

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
            if (result) {
                results.push(result);
            }
        }

        progress.report({
            message: `正在处理大文件... ${i + batch.length}/${files.length}`,
            increment: 1
        });
    }

    return results;
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

/**
 * 获取ripgrep可执行文件路径
 */
function getRipgrepPath(): string | null {
    try {
        // 尝试使用VSCode内置的ripgrep
        const vscodeExtensionPath = vscode.extensions.getExtension('vscode.search-result')?.extensionPath;
        if (vscodeExtensionPath) {
            // 这个路径可能不准确，我们需要找到VSCode的安装路径
        }

        // 尝试常见的VSCode安装路径
        const os = require('os');
        const possiblePaths = [];

        if (os.platform() === 'win32') {
            const userProfile = os.homedir();
            possiblePaths.push(
                path.join(userProfile, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'resources', 'app', 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg.exe'),
                path.join('C:', 'Program Files', 'Microsoft VS Code', 'resources', 'app', 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg.exe'),
                path.join('C:', 'Program Files (x86)', 'Microsoft VS Code', 'resources', 'app', 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg.exe')
            );
        } else if (os.platform() === 'darwin') {
            possiblePaths.push(
                '/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg'
            );
        } else {
            // Linux
            possiblePaths.push(
                '/usr/share/code/resources/app/node_modules/@vscode/ripgrep/bin/rg',
                '/opt/visual-studio-code/resources/app/node_modules/@vscode/ripgrep/bin/rg'
            );
        }

        // 检查哪个路径存在
        for (const ripgrepPath of possiblePaths) {
            try {
                if (require('fs').existsSync(ripgrepPath)) {
                    return ripgrepPath;
                }
            } catch (error) {
                // 继续尝试下一个路径
            }
        }

        return null;
    } catch (error) {
        console.error('获取ripgrep路径失败:', error);
        return null;
    }
}

/**
 * 检查ripgrep是否可用
 */
async function checkRipgrepAvailable(): Promise<{ available: boolean; path: string | null }> {
    return new Promise((resolve) => {
        // 首先尝试VSCode内置的ripgrep
        const vscodeRipgrepPath = getRipgrepPath();
        if (vscodeRipgrepPath) {
            const child = spawn(vscodeRipgrepPath, ['--version']);

            child.on('error', () => {
                // VSCode内置ripgrep失败，尝试系统ripgrep
                trySystemRipgrep(resolve);
            });

            child.on('exit', (code) => {
                if (code === 0) {
                    resolve({ available: true, path: vscodeRipgrepPath });
                } else {
                    trySystemRipgrep(resolve);
                }
            });

            // 超时处理
            setTimeout(() => {
                child.kill();
                trySystemRipgrep(resolve);
            }, 3000);
        } else {
            // 没找到VSCode内置ripgrep，尝试系统ripgrep
            trySystemRipgrep(resolve);
        }
    });
}

/**
 * 尝试使用系统安装的ripgrep
 */
function trySystemRipgrep(resolve: (value: { available: boolean; path: string | null }) => void) {
    const child = spawn('rg', ['--version'], { shell: true });

    child.on('error', () => {
        resolve({ available: false, path: null });
    });

    child.on('exit', (code) => {
        resolve({ available: code === 0, path: 'rg' });
    });

    // 超时处理
    setTimeout(() => {
        child.kill();
        resolve({ available: false, path: null });
    }, 3000);
}

/**
 * 使用ripgrep搜索单个关键词
 */
async function searchWithRipgrep(
    keyword: string,
    workspaceRoot: string,
    config: any,
    ripgrepPath: string
): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const args = [
            '--files-with-matches',  // 只返回包含匹配的文件名
            '--no-heading',          // 不显示文件头
            '--no-line-number',      // 不显示行号
        ];

        // 大小写敏感设置
        if (!config.caseSensitive) {
            args.push('--ignore-case');
        }

        // 添加忽略模式
        if (config.ignorePatterns && config.ignorePatterns.length > 0) {
            config.ignorePatterns.forEach((pattern: string) => {
                args.push('--glob', `!${pattern}`);
            });
        }

        // 添加包含模式
        if (config.includePatterns && config.includePatterns.length > 0) {
            config.includePatterns.forEach((pattern: string) => {
                args.push('--glob', pattern);
            });
        }

        // 添加搜索关键词
        args.push(keyword);
        args.push(workspaceRoot);

        // 使用指定的ripgrep路径
        const spawnOptions = ripgrepPath === 'rg' ? { shell: true } : {};
        const child = spawn(ripgrepPath, args, spawnOptions);
        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('error', (error) => {
            reject(new Error(`ripgrep执行失败: ${error.message}`));
        });

        child.on('exit', (code) => {
            if (code === 0) {
                // 解析输出，获取文件路径列表
                const files = output
                    .split('\n')
                    .filter(line => line.trim().length > 0)
                    .map(line => line.trim());
                resolve(files);
            } else if (code === 1) {
                // 没有找到匹配，这是正常情况
                resolve([]);
            } else {
                reject(new Error(`ripgrep退出码: ${code}, 错误: ${errorOutput}`));
            }
        });

        // 超时处理
        setTimeout(() => {
            child.kill();
            reject(new Error('ripgrep搜索超时'));
        }, 30000);
    });
}

/**
 * 尝试使用ripgrep进行高性能搜索
 */
async function tryRipgrepSearch(
    keywords: string[],
    config: any,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchResult[] | null> {
    try {
        // 检查ripgrep是否可用
        const ripgrepInfo = await checkRipgrepAvailable();
        if (!ripgrepInfo.available || !ripgrepInfo.path) {
            return null;
        }

        const ripgrepPath = ripgrepInfo.path;
        const ripgrepType = ripgrepPath.includes('Microsoft VS Code') ? 'VSCode内置' : '系统';
        progress.report({ message: `使用${ripgrepType}ripgrep进行高性能搜索...`, increment: 5 });

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const results: SearchResult[] = [];

        // 为每个关键词执行ripgrep搜索
        const keywordResults = new Map<string, Set<string>>();

        for (let i = 0; i < keywords.length; i++) {
            if (token.isCancellationRequested) {
                return [];
            }

            const keyword = keywords[i];
            progress.report({
                message: `搜索关键词 "${keyword}" (${i + 1}/${keywords.length})...`,
                increment: 70 / keywords.length
            });

            const files = await searchWithRipgrep(keyword, workspaceRoot, config, ripgrepPath);
            keywordResults.set(keyword, new Set(files));
        }

        // 找到包含所有关键词的文件（交集）
        const allKeywords = Array.from(keywordResults.keys());
        if (allKeywords.length === 0) {
            return [];
        }

        let intersectionFiles = keywordResults.get(allKeywords[0]) || new Set();
        for (let i = 1; i < allKeywords.length; i++) {
            const currentFiles = keywordResults.get(allKeywords[i]) || new Set();
            intersectionFiles = new Set([...intersectionFiles].filter(file => currentFiles.has(file)));
        }

        progress.report({ message: '处理搜索结果...', increment: 15 });

        // 为交集文件生成详细结果
        for (const filePath of intersectionFiles) {
            if (token.isCancellationRequested) {
                return [];
            }

            const result = await generateDetailedResult(filePath, keywords, config);
            if (result) {
                results.push(result);
            }
        }

        return results;
    } catch (error) {
        console.error('ripgrep搜索失败:', error);
        return null;
    }
}

/**
 * 为单个文件生成详细的搜索结果
 */
async function generateDetailedResult(
    filePath: string,
    keywords: string[],
    config: any
): Promise<SearchResult | null> {
    try {
        // 检查文件是否应该被忽略
        if (shouldIgnoreFile(filePath, config.ignorePatterns)) {
            return null;
        }

        // 直接使用containsAllKeywords函数，它会返回完整的SearchResult（包括预览）
        const result = await containsAllKeywords(filePath, keywords, config.caseSensitive, config.wholeWord);
        return result;
    } catch (error) {
        console.error(`处理文件 ${filePath} 时出错:`, error);
        return null;
    }
}
