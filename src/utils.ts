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
        maxFileSize: config.get<number>('maxFileSize', 1048576), // 1MB
        includePatterns: config.get<string[]>('includePatterns', [
            '**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx',
            '**/*.vue', '**/*.html', '**/*.css', '**/*.scss',
            '**/*.less', '**/*.json', '**/*.md', '**/*.txt',
            '**/*.py', '**/*.java', '**/*.c', '**/*.cpp',
            '**/*.h', '**/*.php', '**/*.rb', '**/*.go',
            '**/*.rs', '**/*.xml', '**/*.yaml', '**/*.yml'
        ])
    };
}

/**
 * 检查文件是否包含所有关键词
 */
export async function containsAllKeywords(
    filePath: string,
    keywords: string[],
    caseSensitive: boolean = false
): Promise<SearchResult | null> {
    try {
        // 检查文件大小
        const stats = await fs.promises.stat(filePath);
        const config = getConfiguration();
        
        if (stats.size > config.maxFileSize) {
            return null; // 文件太大，跳过
        }

        // 读取文件内容
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        
        // 准备搜索用的关键词
        const searchKeywords = caseSensitive ? keywords : keywords.map(k => k.toLowerCase());
        const searchContent = caseSensitive ? content : content.toLowerCase();
        
        // 检查是否包含所有关键词
        const allMatches: KeywordMatch[] = [];
        
        for (const originalKeyword of keywords) {
            const searchKeyword = caseSensitive ? originalKeyword : originalKeyword.toLowerCase();
            
            if (!searchContent.includes(searchKeyword)) {
                return null; // 不包含某个关键词，直接返回
            }
            
            // 找到所有匹配位置
            const positions = findKeywordPositions(lines, originalKeyword, caseSensitive);
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
                
            return {
                filePath,
                relativePath,
                matches: allMatches,
                fileSize: stats.size
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
    caseSensitive: boolean
): MatchPosition[] {
    const positions: MatchPosition[] = [];
    const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
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
