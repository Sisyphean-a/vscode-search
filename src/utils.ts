import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * 搜索结果接口
 */
export interface SearchResult {
    filePath: string;
    relativePath: string;
    matches: KeywordMatch[];
    fileSize: number;
    preview?: FilePreview;
    lastModified?: Date;
    fileType?: string;
}

/**
 * 关键词匹配信息
 */
export interface KeywordMatch {
    keyword: string;
    positions: MatchPosition[];
}

/**
 * 匹配位置信息
 */
export interface MatchPosition {
    line: number;
    column: number;
    lineText: string;
}

/**
 * 文件预览信息
 */
export interface FilePreview {
    snippets: PreviewSnippet[];
    totalLines: number;
    encoding?: string;
}

/**
 * 预览片段
 */
export interface PreviewSnippet {
    startLine: number;
    endLine: number;
    content: string;
    highlightedContent: string;
    matchedKeywords: string[];
}

/**
 * 文件索引信息
 */
export interface FileIndex {
    filePath: string;
    relativePath: string;
    lastModified: number;
    fileSize: number;
    fileType: string;
    words: Set<string>;
    lines: string[];
    encoding: string;
}

/**
 * 搜索索引
 */
export interface SearchIndex {
    version: string;
    createdAt: number;
    updatedAt: number;
    files: Map<string, FileIndex>;
    wordToFiles: Map<string, Set<string>>;
    totalFiles: number;
    totalWords: number;
}

/**
 * 获取配置项
 */
export function getConfiguration() {
    const config = vscode.workspace.getConfiguration('intersectionSearch');
    return {
        ignorePatterns: config.get<string[]>('ignorePatterns', [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/*.min.js',
            '**/*.map'
        ]),
        caseSensitive: config.get<boolean>('caseSensitive', false),
        wholeWord: config.get<boolean>('wholeWord', false),
        maxFileSize: config.get<number>('maxFileSize', 1024), // 1024KB
        includePatterns: config.get<string[]>('includePatterns', [
            '**/*.js', '**/*.ts', '**/*.jsx', '**/*.jsp', '**/*.tsx',
            '**/*.vue', '**/*.html', '**/*.css', '**/*.scss',
            '**/*.less', '**/*.json', '**/*.md', '**/*.txt',
            '**/*.py', '**/*.java', '**/*.c', '**/*.cpp',
            '**/*.h', '**/*.php', '**/*.rb', '**/*.go',
            '**/*.rs', '**/*.xml', '**/*.yaml', '**/*.yml'
        ])
    };
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查文件是否包含所有关键词
 */
export async function containsAllKeywords(
    filePath: string,
    keywords: string[],
    caseSensitive: boolean = false,
    wholeWord: boolean = false
): Promise<SearchResult | null> {
    try {
        // 检查文件大小
        const stats = await fs.promises.stat(filePath);
        const config = getConfiguration();
        
        if (stats.size > config.maxFileSize * 1024) {
            return null; // 文件太大，跳过
        }

        // 对于大文件，先使用流式预检查
        if (stats.size > 100 * 1024) { // 100KB以上的文件使用流式预检查
            const hasAllKeywords = await containsKeywordsStream(filePath, keywords, caseSensitive);
            if (!hasAllKeywords) {
                return null; // 不包含所有关键词，跳过详细处理
            }
        }

        // 使用流式处理读取文件内容
        const { content, lines } = await readFileWithStream(filePath, config.maxFileSize * 1024);
        
        // 准备搜索用的关键词
        const searchKeywords = caseSensitive ? keywords : keywords.map(k => k.toLowerCase());
        const searchContent = caseSensitive ? content : content.toLowerCase();
        
        // 检查是否包含所有关键词
        const allMatches: KeywordMatch[] = [];
        
        for (const originalKeyword of keywords) {
            const searchKeyword = caseSensitive ? originalKeyword : originalKeyword.toLowerCase();

            // 检查是否包含关键词（考虑全字匹配）
            let hasKeyword = false;
            if (wholeWord) {
                // 全字匹配：使用正则表达式检查
                const wordRegex = new RegExp(`\\b${escapeRegExp(searchKeyword)}\\b`, caseSensitive ? 'g' : 'gi');
                hasKeyword = wordRegex.test(searchContent);
            } else {
                // 普通匹配：简单包含检查
                hasKeyword = searchContent.includes(searchKeyword);
            }

            if (!hasKeyword) {
                return null; // 不包含某个关键词，直接返回
            }

            // 找到所有匹配位置
            const positions = findKeywordPositions(lines, originalKeyword, caseSensitive, wholeWord);
            if (positions.length > 0) {
                allMatches.push({
                    keyword: originalKeyword,
                    positions
                });
            }
        }
        
        // 如果所有关键词都找到了，返回结果
        if (allMatches.length === keywords.length) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const relativePath = workspaceFolder
                ? path.relative(workspaceFolder.uri.fsPath, filePath)
                : filePath;

            // 生成文件预览
            const preview = generateFilePreview(lines, allMatches, keywords);

            return {
                filePath,
                relativePath,
                matches: allMatches,
                fileSize: stats.size,
                preview,
                lastModified: stats.mtime,
                fileType: path.extname(filePath).toLowerCase()
            };
        }
        
        return null;
    } catch (error) {
        console.error(`读取文件失败: ${filePath}`, error);
        return null;
    }
}

/**
 * 在文本行中查找关键词的所有位置
 */
function findKeywordPositions(
    lines: string[],
    keyword: string,
    caseSensitive: boolean,
    wholeWord: boolean = false
): MatchPosition[] {
    const positions: MatchPosition[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        if (wholeWord) {
            // 全字匹配：使用正则表达式
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, flags);
            let match;

            while ((match = regex.exec(line)) !== null) {
                positions.push({
                    line: lineIndex + 1, // VSCode使用1基索引
                    column: match.index + 1,
                    lineText: line.trim()
                });
            }
        } else {
            // 普通匹配：简单字符串搜索
            const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
            const searchLine = caseSensitive ? line : line.toLowerCase();

            let columnIndex = 0;
            while (true) {
                const foundIndex = searchLine.indexOf(searchKeyword, columnIndex);
                if (foundIndex === -1) {
                    break;
                }

                positions.push({
                    line: lineIndex + 1, // VSCode使用1基索引
                    column: foundIndex + 1,
                    lineText: line.trim()
                });

                columnIndex = foundIndex + 1;
            }
        }
    }
    
    return positions;
}

/**
 * 检查文件路径是否应该被忽略
 */
export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
    const relativePath = vscode.workspace.asRelativePath(filePath);
    
    for (const pattern of ignorePatterns) {
        // 简单的glob模式匹配
        if (matchGlobPattern(relativePath, pattern)) {
            return true;
        }
    }
    
    return false;
}

/**
 * 简单的glob模式匹配
 */
function matchGlobPattern(path: string, pattern: string): boolean {
    // 将glob模式转换为正则表达式
    const regexPattern = pattern
        .replace(/\*\*/g, '.*')  // ** 匹配任意路径
        .replace(/\*/g, '[^/]*') // * 匹配除路径分隔符外的任意字符
        .replace(/\?/g, '[^/]'); // ? 匹配单个字符

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path.replace(/\\/g, '/'));
}

/**
 * 生成文件预览信息
 */
function generateFilePreview(lines: string[], allMatches: KeywordMatch[], keywords: string[]): FilePreview {
    const snippets: PreviewSnippet[] = [];
    const contextLines = 2; // 上下文行数
    const maxSnippets = 5; // 最大预览片段数

    // 收集所有匹配行号
    const matchedLines = new Set<number>();
    allMatches.forEach(match => {
        match.positions.forEach(pos => {
            matchedLines.add(pos.line);
        });
    });

    // 按行号排序
    const sortedLines = Array.from(matchedLines).sort((a, b) => a - b);

    // 合并相近的行，生成预览片段
    let currentSnippet: { start: number; end: number; lines: number[] } | null = null;
    const snippetGroups: { start: number; end: number; lines: number[] }[] = [];

    for (const lineNum of sortedLines) {
        const snippetStart = Math.max(0, lineNum - contextLines);
        const snippetEnd = Math.min(lines.length - 1, lineNum + contextLines);

        if (currentSnippet && snippetStart <= currentSnippet.end + 1) {
            // 合并到当前片段
            currentSnippet.end = snippetEnd;
            currentSnippet.lines.push(lineNum);
        } else {
            // 创建新片段
            if (currentSnippet) {
                snippetGroups.push(currentSnippet);
            }
            currentSnippet = {
                start: snippetStart,
                end: snippetEnd,
                lines: [lineNum]
            };
        }

        if (snippetGroups.length >= maxSnippets) {
            break;
        }
    }

    if (currentSnippet && snippetGroups.length < maxSnippets) {
        snippetGroups.push(currentSnippet);
    }

    // 生成预览片段
    for (const group of snippetGroups) {
        const content = lines.slice(group.start, group.end + 1).join('\n');
        const highlightedContent = highlightKeywords(content, keywords, group.start);
        const matchedKeywords = getMatchedKeywordsInRange(allMatches, group.start, group.end);

        snippets.push({
            startLine: group.start + 1, // 转换为1基索引
            endLine: group.end + 1,
            content,
            highlightedContent,
            matchedKeywords
        });
    }

    return {
        snippets,
        totalLines: lines.length,
        encoding: 'utf8'
    };
}

/**
 * 高亮关键词
 */
function highlightKeywords(content: string, keywords: string[], startLine: number): string {
    let highlighted = content;
    const lines = content.split('\n');

    // 为每个关键词添加高亮标记
    keywords.forEach((keyword, index) => {
        const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
        highlighted = highlighted.replace(regex, `<mark class="keyword-${index % 5}">\$1</mark>`);
    });

    return highlighted;
}



/**
 * 获取指定范围内匹配的关键词
 */
function getMatchedKeywordsInRange(allMatches: KeywordMatch[], startLine: number, endLine: number): string[] {
    const matchedKeywords = new Set<string>();

    allMatches.forEach(match => {
        match.positions.forEach(pos => {
            if (pos.line >= startLine && pos.line <= endLine) {
                matchedKeywords.add(match.keyword);
            }
        });
    });

    return Array.from(matchedKeywords);
}

/**
 * 索引管理器
 */
export class IndexManager {
    private static instance: IndexManager;
    private index: SearchIndex | null = null;
    private indexPath: string;

    private constructor() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            this.indexPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'search-index.json');
        } else {
            this.indexPath = '';
        }
    }

    public static getInstance(): IndexManager {
        if (!IndexManager.instance) {
            IndexManager.instance = new IndexManager();
        }
        return IndexManager.instance;
    }

    /**
     * 检查是否存在索引
     */
    public async hasIndex(): Promise<boolean> {
        if (!this.indexPath) return false;
        try {
            await fs.promises.access(this.indexPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 加载索引
     */
    public async loadIndex(): Promise<SearchIndex | null> {
        if (!this.indexPath || !await this.hasIndex()) {
            return null;
        }

        try {
            const indexData = await fs.promises.readFile(this.indexPath, 'utf8');
            const parsed = JSON.parse(indexData);

            // 重建 Map 和 Set 对象
            const index: SearchIndex = {
                version: parsed.version,
                createdAt: parsed.createdAt,
                updatedAt: parsed.updatedAt,
                totalFiles: parsed.totalFiles,
                totalWords: parsed.totalWords,
                files: new Map(),
                wordToFiles: new Map()
            };

            // 重建文件索引
            for (const [filePath, fileData] of Object.entries(parsed.files as any)) {
                const data = fileData as any;
                const fileIndex: FileIndex = {
                    filePath: data.filePath,
                    relativePath: data.relativePath,
                    lastModified: data.lastModified,
                    fileSize: data.fileSize,
                    fileType: data.fileType,
                    lines: data.lines,
                    encoding: data.encoding,
                    words: new Set(data.words)
                };
                index.files.set(filePath, fileIndex);
            }

            // 重建词汇到文件的映射
            for (const [word, files] of Object.entries(parsed.wordToFiles as any)) {
                index.wordToFiles.set(word, new Set(files as string[]));
            }

            this.index = index;
            return index;
        } catch (error) {
            console.error('加载索引失败:', error);
            return null;
        }
    }

    /**
     * 保存索引
     */
    public async saveIndex(index: SearchIndex): Promise<void> {
        if (!this.indexPath) return;

        try {
            // 确保目录存在
            const indexDir = path.dirname(this.indexPath);
            await fs.promises.mkdir(indexDir, { recursive: true });

            // 转换 Map 和 Set 为可序列化的对象
            const serializable = {
                version: index.version,
                createdAt: index.createdAt,
                updatedAt: index.updatedAt,
                totalFiles: index.totalFiles,
                totalWords: index.totalWords,
                files: Object.fromEntries(
                    Array.from(index.files.entries()).map(([path, fileIndex]) => [
                        path,
                        {
                            ...fileIndex,
                            words: Array.from(fileIndex.words)
                        }
                    ])
                ),
                wordToFiles: Object.fromEntries(
                    Array.from(index.wordToFiles.entries()).map(([word, files]) => [
                        word,
                        Array.from(files)
                    ])
                )
            };

            await fs.promises.writeFile(this.indexPath, JSON.stringify(serializable, null, 2));
            this.index = index;
        } catch (error) {
            console.error('保存索引失败:', error);
            throw error;
        }
    }

    /**
     * 获取当前索引
     */
    public getIndex(): SearchIndex | null {
        return this.index;
    }

    /**
     * 清除索引
     */
    public async clearIndex(): Promise<void> {
        if (!this.indexPath) return;

        try {
            await fs.promises.unlink(this.indexPath);
            this.index = null;
        } catch (error) {
            // 文件不存在时忽略错误
            if ((error as any).code !== 'ENOENT') {
                console.error('清除索引失败:', error);
                throw error;
            }
        }
    }
}

/**
 * 构建文件索引
 */
export async function buildSearchIndex(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<SearchIndex> {
    const config = getConfiguration();
    const indexManager = IndexManager.getInstance();

    progress.report({ message: '正在扫描文件...', increment: 0 });

    // 查找所有符合条件的文件
    const allFiles: vscode.Uri[] = [];
    for (const pattern of config.includePatterns) {
        try {
            const files = await vscode.workspace.findFiles(pattern, undefined, 10000);
            const filteredFiles = files.filter(file =>
                !shouldIgnoreFile(file.fsPath, config.ignorePatterns)
            );
            allFiles.push(...filteredFiles);
        } catch (error) {
            console.error(`搜索模式 ${pattern} 失败:`, error);
        }
    }

    // 去重
    const uniqueFiles = Array.from(
        new Map(allFiles.map(file => [file.fsPath, file])).values()
    );

    progress.report({
        message: `找到 ${uniqueFiles.length} 个文件，开始建立索引...`,
        increment: 10
    });

    const index: SearchIndex = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: new Map(),
        wordToFiles: new Map(),
        totalFiles: 0,
        totalWords: 0
    };

    const totalFiles = uniqueFiles.length;
    let processedFiles = 0;
    const batchSize = 5; // 索引构建使用较小的批量大小

    for (let i = 0; i < uniqueFiles.length; i += batchSize) {
        if (token.isCancellationRequested) {
            break;
        }

        const batch = uniqueFiles.slice(i, i + batchSize);
        const batchPromises = batch.map(async (file) => {
            try {
                return await indexFile(file.fsPath, config.maxFileSize * 1024);
            } catch (error) {
                console.error(`索引文件失败: ${file.fsPath}`, error);
                return null;
            }
        });

        const batchResults = await Promise.all(batchPromises);

        // 处理批量结果
        for (const fileIndex of batchResults) {
            if (fileIndex) {
                index.files.set(fileIndex.filePath, fileIndex);

                // 更新词汇到文件的映射
                for (const word of fileIndex.words) {
                    if (!index.wordToFiles.has(word)) {
                        index.wordToFiles.set(word, new Set());
                    }
                    index.wordToFiles.get(word)!.add(fileIndex.filePath);
                }
            }
        }

        processedFiles += batch.length;
        const progressPercent = Math.floor((processedFiles / totalFiles) * 80) + 10; // 10-90%

        progress.report({
            message: `已索引 ${processedFiles}/${totalFiles} 个文件`,
            increment: progressPercent
        });
    }

    index.totalFiles = index.files.size;
    index.totalWords = index.wordToFiles.size;

    progress.report({
        message: '正在保存索引...',
        increment: 95
    });

    await indexManager.saveIndex(index);

    progress.report({
        message: `索引构建完成！共索引 ${index.totalFiles} 个文件，${index.totalWords} 个词汇`,
        increment: 100
    });

    return index;
}

/**
 * 为单个文件建立索引
 */
async function indexFile(filePath: string, maxFileSize: number): Promise<FileIndex | null> {
    try {
        const stats = await fs.promises.stat(filePath);

        if (stats.size > maxFileSize) {
            return null; // 文件太大，跳过
        }

        const { content, lines } = await readFileWithStream(filePath, maxFileSize);

        // 提取词汇
        const words = extractWords(content);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const relativePath = workspaceFolder
            ? path.relative(workspaceFolder.uri.fsPath, filePath)
            : filePath;

        return {
            filePath,
            relativePath,
            lastModified: stats.mtime.getTime(),
            fileSize: stats.size,
            fileType: path.extname(filePath).toLowerCase(),
            words,
            lines,
            encoding: 'utf8'
        };
    } catch (error) {
        console.error(`索引文件失败: ${filePath}`, error);
        return null;
    }
}

/**
 * 从文本中提取词汇
 */
function extractWords(content: string): Set<string> {
    const words = new Set<string>();

    // 使用正则表达式提取词汇（字母、数字、下划线组成的词）
    const wordRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    let match;

    while ((match = wordRegex.exec(content)) !== null) {
        const word = match[0].toLowerCase();
        if (word.length >= 2) { // 只索引长度大于等于2的词汇
            words.add(word);
        }
    }

    return words;
}

/**
 * 使用索引进行快速搜索
 */
export async function searchWithIndex(
    keywords: string[],
    caseSensitive: boolean = false
): Promise<SearchResult[]> {
    const indexManager = IndexManager.getInstance();
    const index = indexManager.getIndex();

    if (!index) {
        throw new Error('索引不存在，请先建立索引');
    }

    const results: SearchResult[] = [];
    const searchKeywords = caseSensitive ? keywords : keywords.map(k => k.toLowerCase());

    // 找到包含所有关键词的文件
    let candidateFiles: Set<string> | null = null;

    for (const keyword of searchKeywords) {
        const filesWithKeyword = index.wordToFiles.get(keyword);

        if (!filesWithKeyword || filesWithKeyword.size === 0) {
            // 如果任何一个关键词都没有匹配的文件，直接返回空结果
            return [];
        }

        if (candidateFiles === null) {
            candidateFiles = new Set(filesWithKeyword);
        } else {
            // 取交集
            const intersection = new Set<string>();
            for (const file of candidateFiles) {
                if (filesWithKeyword.has(file)) {
                    intersection.add(file);
                }
            }
            candidateFiles = intersection;
        }

        if (candidateFiles.size === 0) {
            return []; // 没有文件包含所有关键词
        }
    }

    if (!candidateFiles || candidateFiles.size === 0) {
        return [];
    }

    // 对候选文件进行详细匹配
    for (const filePath of candidateFiles) {
        const fileIndex = index.files.get(filePath);
        if (!fileIndex) continue;

        try {
            // 检查文件是否仍然存在且未被修改
            const stats = await fs.promises.stat(filePath);
            if (stats.mtime.getTime() !== fileIndex.lastModified) {
                // 文件已被修改，跳过（或者可以选择重新索引）
                continue;
            }

            // 在文件内容中查找精确匹配
            const result = await findKeywordMatches(fileIndex, keywords, caseSensitive);
            if (result) {
                results.push(result);
            }
        } catch (error) {
            // 文件可能已被删除，跳过
            console.warn(`文件不存在或无法访问: ${filePath}`);
            continue;
        }
    }

    // 按文件路径排序
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return results;
}

/**
 * 在索引的文件中查找关键词匹配
 */
async function findKeywordMatches(
    fileIndex: FileIndex,
    keywords: string[],
    caseSensitive: boolean
): Promise<SearchResult | null> {
    const allMatches: KeywordMatch[] = [];

    for (const originalKeyword of keywords) {
        const searchKeyword = caseSensitive ? originalKeyword : originalKeyword.toLowerCase();
        const positions = findKeywordPositions(fileIndex.lines, originalKeyword, caseSensitive);

        if (positions.length > 0) {
            allMatches.push({
                keyword: originalKeyword,
                positions
            });
        } else {
            // 如果任何关键词都没有找到精确匹配，返回null
            return null;
        }
    }

    if (allMatches.length === keywords.length) {
        // 生成文件预览
        const preview = generateFilePreview(fileIndex.lines, allMatches, keywords);

        return {
            filePath: fileIndex.filePath,
            relativePath: fileIndex.relativePath,
            matches: allMatches,
            fileSize: fileIndex.fileSize,
            preview,
            lastModified: new Date(fileIndex.lastModified),
            fileType: fileIndex.fileType
        };
    }

    return null;
}

/**
 * 检查索引是否需要更新
 */
export async function isIndexOutdated(): Promise<boolean> {
    const indexManager = IndexManager.getInstance();
    const index = await indexManager.loadIndex();

    if (!index) {
        return true; // 没有索引，需要建立
    }

    // 检查是否有新文件或文件被修改
    const config = getConfiguration();
    const allFiles: vscode.Uri[] = [];

    for (const pattern of config.includePatterns) {
        try {
            const files = await vscode.workspace.findFiles(pattern, undefined, 10000);
            const filteredFiles = files.filter(file =>
                !shouldIgnoreFile(file.fsPath, config.ignorePatterns)
            );
            allFiles.push(...filteredFiles);
        } catch (error) {
            console.error(`搜索模式 ${pattern} 失败:`, error);
        }
    }

    const uniqueFiles = Array.from(
        new Map(allFiles.map(file => [file.fsPath, file])).values()
    );

    // 检查文件数量是否变化
    if (uniqueFiles.length !== index.totalFiles) {
        return true;
    }

    // 检查文件修改时间
    for (const file of uniqueFiles) {
        const fileIndex = index.files.get(file.fsPath);
        if (!fileIndex) {
            return true; // 新文件
        }

        try {
            const stats = await fs.promises.stat(file.fsPath);
            if (stats.mtime.getTime() !== fileIndex.lastModified) {
                return true; // 文件被修改
            }
        } catch {
            return true; // 文件无法访问
        }
    }

    return false;
}

/**
 * 使用流式处理读取文件内容
 */
async function readFileWithStream(filePath: string, maxFileSize: number): Promise<{ content: string; lines: string[] }> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 }); // 64KB chunks
    let content = '';
    let totalSize = 0;
    const maxChunkSize = maxFileSize;

    return new Promise((resolve, reject) => {
        const chunks: string[] = [];

        stream.on('data', (chunk: string) => {
            totalSize += Buffer.byteLength(chunk, 'utf8');

            // 检查文件大小限制
            if (totalSize > maxChunkSize) {
                stream.destroy();
                reject(new Error(`文件太大，超过 ${maxChunkSize} 字节限制`));
                return;
            }

            chunks.push(chunk);
        });

        stream.on('end', () => {
            content = chunks.join('');
            const lines = content.split('\n');
            resolve({ content, lines });
        });

        stream.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 使用流式处理检查文件是否包含关键词（用于大文件预检查）
 */
async function containsKeywordsStream(filePath: string, keywords: string[], caseSensitive: boolean = false): Promise<boolean> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    const searchKeywords = caseSensitive ? keywords : keywords.map(k => k.toLowerCase());
    const foundKeywords = new Set<string>();
    let buffer = '';

    return new Promise((resolve, reject) => {
        stream.on('data', (chunk: string) => {
            buffer += chunk;

            // 保留一些重叠以处理跨块的关键词
            const searchText = caseSensitive ? buffer : buffer.toLowerCase();

            // 检查每个关键词
            for (const keyword of searchKeywords) {
                if (searchText.includes(keyword)) {
                    foundKeywords.add(keyword);
                }
            }

            // 如果找到所有关键词，可以提前结束
            if (foundKeywords.size === keywords.length) {
                stream.destroy();
                resolve(true);
                return;
            }

            // 保留缓冲区末尾的一部分，以防关键词跨块分割
            const maxKeywordLength = Math.max(...keywords.map(k => k.length));
            if (buffer.length > maxKeywordLength * 2) {
                buffer = buffer.slice(-maxKeywordLength);
            }
        });

        stream.on('end', () => {
            resolve(foundKeywords.size === keywords.length);
        });

        stream.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
