// VSCode API
const vscode = acquireVsCodeApi();

// DOM元素
let keywordsInput;
let searchBtn;
let caseSensitiveCheckbox;
let includeSubdirsCheckbox;
let wholeWordCheckbox;
let searchProgress;
let progressFill;
let progressText;
let searchStats;
let statsText;
let searchResults;
let noResults;
let configBtn;
let clearBtn;

// 过滤相关元素
let filterSection;
let toggleFilters;
let filterControls;
let fileTypeFilter;
let fileSizeFilter;
let modifiedTimeFilter;
let minMatchesFilter;
let clearFilters;



// 分页相关元素
let paginationSection;
let paginationInfo;
let pageSizeSelect;
let firstPageBtn;
let prevPageBtn;
let pageNumbers;
let nextPageBtn;
let lastPageBtn;



// 状态
let currentResults = [];
let currentKeywords = [];
let isSearching = false;
let filteredResults = [];

// 搜索缓存
let searchCache = {
    keywords: [],
    results: [],
    timestamp: 0
};
let activeFilters = {
    fileType: '',
    fileSize: '',
    modifiedTime: '',
    minMatches: 0
};


// 分页相关状态
let currentPage = 1;
let pageSize = 20; // 每页显示的文件数量
let totalPages = 1;



// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    loadConfiguration();
});

function initializeElements() {
    keywordsInput = document.getElementById('keywordsInput');
    searchBtn = document.getElementById('searchBtn');
    caseSensitiveCheckbox = document.getElementById('caseSensitive');
    includeSubdirsCheckbox = document.getElementById('includeSubdirs');
    wholeWordCheckbox = document.getElementById('wholeWord');
    searchProgress = document.getElementById('searchProgress');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    searchStats = document.getElementById('searchStats');
    statsText = document.getElementById('statsText');
    searchResults = document.getElementById('searchResults');
    noResults = document.getElementById('noResults');
    configBtn = document.getElementById('configBtn');
    clearBtn = document.getElementById('clearBtn');

    // 过滤相关元素
    filterSection = document.getElementById('filterSection');
    toggleFilters = document.getElementById('toggleFilters');
    filterControls = document.getElementById('filterControls');
    fileTypeFilter = document.getElementById('fileTypeFilter');
    fileSizeFilter = document.getElementById('fileSizeFilter');
    modifiedTimeFilter = document.getElementById('modifiedTimeFilter');
    minMatchesFilter = document.getElementById('minMatchesFilter');
    clearFilters = document.getElementById('clearFilters');



    // 分页相关元素
    paginationSection = document.getElementById('paginationSection');
    paginationInfo = document.getElementById('paginationInfo');
    pageSizeSelect = document.getElementById('pageSizeSelect');
    firstPageBtn = document.getElementById('firstPageBtn');
    prevPageBtn = document.getElementById('prevPageBtn');
    pageNumbers = document.getElementById('pageNumbers');
    nextPageBtn = document.getElementById('nextPageBtn');
    lastPageBtn = document.getElementById('lastPageBtn');


}

function setupEventListeners() {
    // 搜索按钮点击
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    // 回车键搜索
    if (keywordsInput) {
        keywordsInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !isSearching) {
                handleSearch();
            }
        });
    }

    // 配置变化
    if (caseSensitiveCheckbox) {
        caseSensitiveCheckbox.addEventListener('change', function() {
            vscode.postMessage({
                command: 'updateConfig',
                config: {
                    caseSensitive: caseSensitiveCheckbox.checked
                }
            });
        });
    }

    if (wholeWordCheckbox) {
        wholeWordCheckbox.addEventListener('change', function() {
            vscode.postMessage({
                command: 'updateConfig',
                config: {
                    wholeWord: wholeWordCheckbox.checked
                }
            });
        });
    }

    // 清除按钮
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            clearResults();
            if (keywordsInput) {
                keywordsInput.value = '';
                keywordsInput.focus();
            }
        });
    }

    // 配置按钮
    if (configBtn) {
        configBtn.addEventListener('click', function() {
            showConfigDialog();
        });
    }



    // 过滤功能事件监听器 - 移除toggleFilters功能，因为没有高级选项

    if (clearFilters) {
        clearFilters.addEventListener('click', function() {
            clearAllFilters();
        });
    }

    // 过滤器变化时自动应用
    [fileTypeFilter, fileSizeFilter, modifiedTimeFilter].forEach(filter => {
        if (filter) {
            filter.addEventListener('change', function() {
                applyCurrentFilters();
            });
        }
    });

    if (minMatchesFilter) {
        minMatchesFilter.addEventListener('input', function() {
            // 延迟应用过滤，避免频繁更新
            clearTimeout(this.filterTimeout);
            this.filterTimeout = setTimeout(() => {
                applyCurrentFilters();
            }, 500);
        });
    }



    // 分页事件监听器
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
            pageSize = parseInt(this.value);
            currentPage = 1;
            updatePaginatedResults();
        });
    }

    if (firstPageBtn) {
        firstPageBtn.addEventListener('click', function() {
            currentPage = 1;
            updatePaginatedResults();
        });
    }

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', function() {
            if (currentPage > 1) {
                currentPage--;
                updatePaginatedResults();
            }
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', function() {
            if (currentPage < totalPages) {
                currentPage++;
                updatePaginatedResults();
            }
        });
    }

    if (lastPageBtn) {
        lastPageBtn.addEventListener('click', function() {
            currentPage = totalPages;
            updatePaginatedResults();
        });
    }


}

/**
 * 检查搜索缓存是否可用于增量搜索
 */
function checkSearchCache(keywords) {
    // 如果没有缓存，不能使用
    if (!searchCache.keywords.length || !searchCache.results.length) {
        return { canUseCache: false };
    }

    // 检查缓存是否过期（5分钟）
    const cacheAge = Date.now() - searchCache.timestamp;
    if (cacheAge > 5 * 60 * 1000) {
        return { canUseCache: false };
    }

    // 检查新关键词是否是缓存关键词的超集（增量搜索）
    const cachedKeywords = searchCache.keywords;
    const isIncremental = cachedKeywords.length < keywords.length &&
                         cachedKeywords.every(keyword => keywords.includes(keyword));

    if (isIncremental) {
        return {
            canUseCache: true,
            cachedResults: searchCache.results,
            newKeywords: keywords.filter(k => !cachedKeywords.includes(k))
        };
    }

    return { canUseCache: false };
}

/**
 * 处理增量搜索
 */
function handleIncrementalSearch(keywords, cachedResults) {
    // 显示正在进行增量搜索的提示
    showNotification('使用缓存进行增量搜索...', 'info');

    // 在缓存结果中进行客户端过滤
    const filteredResults = cachedResults.filter(result => {
        // 检查是否包含所有新关键词
        return keywords.every(keyword => {
            const searchText = caseSensitiveCheckbox.checked ?
                result.relativePath + ' ' + (result.preview?.snippets?.map(s => s.content).join(' ') || '') :
                (result.relativePath + ' ' + (result.preview?.snippets?.map(s => s.content).join(' ') || '')).toLowerCase();

            const searchKeyword = caseSensitiveCheckbox.checked ? keyword : keyword.toLowerCase();

            if (wholeWordCheckbox.checked) {
                const regex = new RegExp(`\\b${escapeRegExp(searchKeyword)}\\b`, caseSensitiveCheckbox.checked ? 'g' : 'gi');
                return regex.test(searchText);
            } else {
                return searchText.includes(searchKeyword);
            }
        });
    });

    // 更新缓存
    updateSearchCache(keywords, filteredResults);

    // 显示结果
    handleSearchCompleted(filteredResults, keywords);
}

/**
 * 更新搜索缓存
 */
function updateSearchCache(keywords, results) {
    searchCache = {
        keywords: [...keywords],
        results: [...results],
        timestamp: Date.now()
    };
}

/**
 * 清除搜索缓存
 */
function clearSearchCache() {
    searchCache = {
        keywords: [],
        results: [],
        timestamp: 0
    };
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function handleSearch() {
    const keywords = keywordsInput.value.trim();
    if (!keywords) {
        showError('请输入至少一个关键词');
        return;
    }

    if (isSearching) {
        return;
    }

    const keywordArray = keywords.split(/\s+/).filter(k => k.length > 0);

    // 检查是否可以使用缓存进行增量搜索
    const cacheResult = checkSearchCache(keywordArray);
    if (cacheResult.canUseCache) {
        // 使用缓存结果进行增量搜索
        handleIncrementalSearch(keywordArray, cacheResult.cachedResults);
        return;
    }

    vscode.postMessage({
        command: 'search',
        keywords: keywordArray
    });
}

function showError(message) {
    // 简单的错误显示
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-toast';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);

    setTimeout(() => {
        if (document.body.contains(errorDiv)) {
            document.body.removeChild(errorDiv);
        }
    }, 3000);
}

function clearResults() {
    currentResults = [];
    currentKeywords = [];
    searchResults.innerHTML = `
        <div class="no-results" id="noResults">
            <p>💡 输入关键词开始搜索</p>
            <p class="text-small margin-top-small opacity-70">支持多个关键词，用空格分隔</p>
        </div>
    `;
    searchStats.classList.add('hidden');

    // 清除搜索缓存
    clearSearchCache();
}

function loadConfiguration() {
    vscode.postMessage({
        command: 'getConfig'
    });
}



// 监听来自扩展的消息
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'searchStarted':
            handleSearchStarted(message.keywords);
            break;
        case 'searchProgress':
            handleSearchProgress(message.progress);
            break;
        case 'searchCompleted':
            handleSearchCompleted(message.results, message.keywords);
            break;
        case 'searchError':
            handleSearchError(message.message);
            break;
        case 'configData':
            handleConfigData(message.config);
            break;
        case 'configUpdated':
            handleConfigUpdated(message.success, message.message);
            break;

    }
});

function handleSearchStarted(keywords) {
    isSearching = true;
    currentKeywords = keywords;
    searchBtn.disabled = true;
    searchBtn.innerHTML = '🔍 搜索中...';
    searchBtn.classList.add('searching');
    searchProgress.classList.remove('hidden');
    searchStats.classList.add('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '初始化搜索...';

    // 添加搜索动画效果
    keywordsInput.style.borderColor = 'var(--vscode-progressBar-background, #0e70c0)';

    // 清除之前的结果
    searchResults.innerHTML = `
        <div class="searching-indicator">
            <div class="spinner"></div>
            <p>正在搜索包含关键词 [${keywords.join(', ')}] 的文件...</p>
        </div>
    `;
}

function handleSearchProgress(progress) {
    if (progress.message) {
        // 优化进度文案显示
        let displayMessage = progress.message;
        if (displayMessage.includes('正在扫描文件')) {
            displayMessage = '📂 ' + displayMessage;
        } else if (displayMessage.includes('正在搜索')) {
            displayMessage = '🔍 ' + displayMessage;
        } else if (displayMessage.includes('处理')) {
            displayMessage = '⚡ ' + displayMessage;
        }
        progressText.textContent = displayMessage;
    }
    if (progress.increment !== undefined) {
        const currentWidth = parseFloat(progressFill.style.width) || 0;
        const newWidth = Math.min(100, currentWidth + progress.increment);
        progressFill.style.width = newWidth + '%';

        // 根据进度显示不同的状态
        if (newWidth < 30) {
            if (!progress.message) {
                progressText.textContent = '📂 扫描文件中...';
            }
        } else if (newWidth < 70) {
            if (!progress.message) {
                progressText.textContent = '🔍 分析文件内容...';
            }
        } else if (newWidth < 95) {
            if (!progress.message) {
                progressText.textContent = '⚡ 整理搜索结果...';
            }
        } else {
            if (!progress.message) {
                progressText.textContent = '✅ 搜索完成';
            }
        }
    }
}

function handleSearchCompleted(results, keywords) {
    isSearching = false;
    currentResults = results;
    currentKeywords = keywords;

    searchBtn.disabled = false;
    searchBtn.innerHTML = '🔍 搜索';
    searchBtn.classList.remove('searching');
    searchProgress.classList.add('hidden');

    // 恢复输入框样式
    keywordsInput.style.borderColor = '';

    // 更新搜索缓存
    updateSearchCache(keywords, results);

    displayResults(results, keywords);

    // 显示完成通知
    if (results.length > 0) {
        showNotification(`找到 ${results.length} 个匹配文件`, 'success');
    }
}

function handleSearchError(message) {
    isSearching = false;
    searchBtn.disabled = false;
    searchBtn.innerHTML = '🔍 搜索';
    searchBtn.classList.remove('searching');
    searchProgress.classList.add('hidden');

    // 恢复输入框样式
    keywordsInput.style.borderColor = '';

    // 显示错误状态
    searchResults.innerHTML = `
        <div class="no-results">
            <p>❌ 搜索失败</p>
            <p class="text-small margin-top-small text-error">${escapeHtml(message)}</p>
            <p class="text-small margin-top-small opacity-70">请检查关键词或重试</p>
        </div>
    `;

    showError(message);
}

function handleConfigData(config) {
    caseSensitiveCheckbox.checked = config.caseSensitive || false;
    wholeWordCheckbox.checked = config.wholeWord || false;

    // 如果配置对话框打开，更新对话框中的值
    const dialog = document.querySelector('.config-dialog-overlay');
    if (dialog) {
        document.getElementById('configCaseSensitive').checked = config.caseSensitive || false;
        document.getElementById('configWholeWord').checked = config.wholeWord || false;
        document.getElementById('configMaxFileSize').value = config.maxFileSize || 1024;

        // 处理includePatterns，如果为空则使用默认值
        let includePatterns = config.includePatterns;
        if (!includePatterns || includePatterns.length === 0) {
            // 使用默认的文件类型列表
            includePatterns = [
                '**/*.js', '**/*.ts', '**/*.jsx','**/*.jsp', '**/*.tsx', '**/*.vue',
                '**/*.html', '**/*.css', '**/*.scss', '**/*.less', '**/*.json',
                '**/*.md', '**/*.txt', '**/*.py', '**/*.java', '**/*.c',
                '**/*.cpp', '**/*.h', '**/*.php', '**/*.rb', '**/*.go',
                '**/*.rs', '**/*.xml', '**/*.yaml', '**/*.yml'
            ];
        }

        // 将 **/*.js 格式转换为 js 格式显示
        const simplifiedPatterns = includePatterns.map(pattern => {
            if (pattern.startsWith('**/') && pattern.includes('.')) {
                return pattern.replace('**/*.', '');
            }
            return pattern;
        });
        document.getElementById('configIncludePatterns').value = simplifiedPatterns.join(', ');
        document.getElementById('configIgnorePatterns').value = (config.ignorePatterns || []).join(', ');
    }
}

function handleConfigUpdated(success, message) {
    if (!success && message) {
        showError(message);
    }
}

function displayResults(results, keywords) {
    // 保存当前结果
    currentResults = results;
    currentKeywords = keywords;
    filteredResults = [...results];

    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="no-results">
                <p>🔍 未找到匹配的文件</p>
                <p class="text-small margin-top-small opacity-80">搜索关键词: [${escapeHtml(keywords.join(', '))}]</p>
                <div class="margin-top-medium text-small opacity-70">
                    <p>💡 建议:</p>
                    <ul class="margin-left-medium margin-top-tiny">
                        <li>• 检查关键词拼写是否正确</li>
                        <li>• 尝试减少关键词数量</li>
                        <li>• 检查文件类型配置</li>
                        <li>• 确认文件在工作区范围内</li>
                    </ul>
                </div>
            </div>
        `;
        searchStats.classList.add('hidden');
        filterSection.classList.add('hidden');
        return;
    }

    // 显示过滤控件
    filterSection.classList.remove('hidden');

    // 显示统计信息
    const totalMatches = results.reduce((sum, result) =>
        sum + result.matches.reduce((matchSum, match) => matchSum + match.positions.length, 0), 0
    );

    updateStatsText(results.length, totalMatches);
    searchStats.classList.remove('hidden');



    // 按目录分组显示结果
    const groupedResults = groupResultsByDirectory(results);
    const resultsHtml = generateGroupedResultsHtml(groupedResults, keywords);

    searchResults.innerHTML = `<div class="results-list">${resultsHtml}</div>`;

    // 添加点击事件
    addResultClickHandlers(keywords);
}

function groupResultsByDirectory(results) {
    const groups = {};

    results.forEach(result => {
        const dirPath = getDirPath(result.relativePath);
        if (!groups[dirPath]) {
            groups[dirPath] = [];
        }
        groups[dirPath].push(result);
    });

    return groups;
}

function getDirPath(filePath) {
    const parts = filePath.split(/[/\\]/);
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

function generateGroupedResultsHtml(groupedResults, keywords) {
    const sortedDirs = Object.keys(groupedResults).sort();

    return sortedDirs.map(dirPath => {
        const files = groupedResults[dirPath];
        const filesHtml = files.map(result => {
            const matchesHtml = result.matches.map(match =>
                `<span class="match-keyword">${escapeHtml(match.keyword)}(${match.positions.length})</span>`
            ).join('');

            const totalFileMatches = result.matches.reduce((sum, match) => sum + match.positions.length, 0);
            const fileSize = formatFileSize(result.fileSize || 0);
            const lastModified = result.lastModified ? new Date(result.lastModified).toLocaleString() : '';

            // 生成预览HTML
            const previewHtml = generatePreviewHtml(result.preview);

            return `
                <div class="result-item" data-file-path="${escapeHtml(result.filePath)}">
                    <div class="result-content">
                        <div class="result-file-header">
                            <div class="result-file">

                                <span class="result-file-icon">${getFileIcon(result.relativePath)}</span>
                                <span class="result-file-name">${escapeHtml(getFileName(result.relativePath))}</span>
                                <span class="result-file-matches-count">(${totalFileMatches})</span>
                                <span class="result-file-path">${escapeHtml(result.relativePath)}</span>
                            </div>
                            <div class="result-actions">
                                <button class="action-btn-small copy-path" title="复制路径" data-path="${escapeHtml(result.filePath)}">📋</button>
                            </div>
                        </div>
                        <div class="result-matches-and-info">
                            <div class="result-matches">${matchesHtml}</div>
                            <div class="result-file-info">
                                <span>大小: ${fileSize}</span>
                                ${lastModified ? `<span>修改: ${lastModified}</span>` : ''}
                                ${result.fileType ? `<span>类型: ${result.fileType}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="result-preview hidden">
                        ${previewHtml}
                    </div>
                </div>
            `;
        }).join('');

        const dirDisplayName = dirPath === '.' ? '📁 根目录' : `📁 ${dirPath}`;

        return `
            <div class="result-group">
                <div class="result-group-header">
                    <span class="result-group-name">${escapeHtml(dirDisplayName)}</span>
                    <span class="result-group-count">(${files.length} 个文件)</span>
                </div>
                <div class="result-group-files">
                    ${filesHtml}
                </div>
            </div>
        `;
    }).join('');
}

function addResultClickHandlers(keywords) {
    // 移除原有的文件名点击事件，现在由文件头处理

    // 文件项点击处理：单击预览，双击打开
    searchResults.querySelectorAll('.result-item').forEach(item => {
        let clickTimer = null;

        item.addEventListener('click', function(e) {
            // 如果点击的是按钮，不处理
            if (e.target.matches('.copy-path, button, input, select')) {
                return;
            }

            e.stopPropagation();
            const resultItem = this;

            if (clickTimer) {
                // 双击：打开文件
                clearTimeout(clickTimer);
                clickTimer = null;

                const filePath = resultItem.getAttribute('data-file-path');
                vscode.postMessage({
                    command: 'openFile',
                    filePath: filePath,
                    keywords: keywords
                });
            } else {
                // 单击：预览
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    togglePreview(resultItem);
                }, 250);
            }
        });
    });

    // 复制路径按钮
    searchResults.querySelectorAll('.copy-path').forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            const path = this.getAttribute('data-path');
            copyToClipboard(path);
            showNotification('路径已复制到剪贴板', 'success');
        });
    });


}

function getFileIcon(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const iconMap = {
        'js': '📄',
        'ts': '📘',
        'jsx': '⚛️',
        'jsp': '⚛️',
        'tsx': '⚛️',
        'vue': '💚',
        'html': '🌐',
        'css': '🎨',
        'scss': '🎨',
        'less': '🎨',
        'json': '📋',
        'md': '📝',
        'txt': '📄',
        'py': '🐍',
        'java': '☕',
        'c': '🔧',
        'cpp': '🔧',
        'h': '🔧',
        'php': '🐘',
        'rb': '💎',
        'go': '🐹',
        'rs': '🦀',
        'xml': '📄',
        'yaml': '📄',
        'yml': '📄'
    };
    return iconMap[ext] || '📄';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * 生成文件预览HTML
 */
function generatePreviewHtml(preview) {
    if (!preview || !preview.snippets || preview.snippets.length === 0) {
        return '<div class="preview-empty">暂无预览内容</div>';
    }

    const snippetsHtml = preview.snippets.map(snippet => {
        return `
            <div class="preview-snippet">
                <div class="preview-snippet-header">
                    <span class="preview-line-range">第 ${snippet.startLine}-${snippet.endLine} 行</span>
                    <span class="preview-keywords">匹配: ${snippet.matchedKeywords.join(', ')}</span>
                </div>
                <div class="preview-content">
                    <pre><code>${snippet.highlightedContent}</code></pre>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="preview-container">
            <div class="preview-header">
                <span class="preview-title">📄 文件预览</span>
                <span class="preview-info">共 ${preview.totalLines} 行，显示 ${preview.snippets.length} 个片段</span>
            </div>
            <div class="preview-snippets">
                ${snippetsHtml}
            </div>
        </div>
    `;
}

/**
 * 复制文本到剪贴板
 */
function copyToClipboard(text) {
    // 使用VSCode API复制到剪贴板
    vscode.postMessage({
        command: 'copyToClipboard',
        text: text
    });
}

/**
 * 应用当前过滤条件
 */
function applyCurrentFilters() {
    if (currentResults.length === 0) {
        return;
    }

    // 更新过滤条件
    activeFilters.fileType = fileTypeFilter.value;
    activeFilters.fileSize = fileSizeFilter.value;
    activeFilters.modifiedTime = modifiedTimeFilter.value;
    activeFilters.minMatches = parseInt(minMatchesFilter.value) || 0;

    // 应用过滤
    filteredResults = currentResults.filter(result => {
        return passesAllFilters(result);
    });

    // 重新显示结果
    displayFilteredResults(filteredResults, currentKeywords);
}

/**
 * 清除所有过滤条件
 */
function clearAllFilters() {
    fileTypeFilter.value = '';
    fileSizeFilter.value = '';
    modifiedTimeFilter.value = '';
    minMatchesFilter.value = '';

    activeFilters = {
        fileType: '',
        fileSize: '',
        modifiedTime: '',
        minMatches: 0
    };

    // 显示所有结果
    filteredResults = [...currentResults];
    displayFilteredResults(filteredResults, currentKeywords);
}

/**
 * 检查结果是否通过所有过滤条件
 */
function passesAllFilters(result) {
    // 文件类型过滤
    if (activeFilters.fileType && result.fileType !== activeFilters.fileType) {
        return false;
    }

    // 文件大小过滤
    if (activeFilters.fileSize && !passesFileSizeFilter(result.fileSize, activeFilters.fileSize)) {
        return false;
    }

    // 修改时间过滤
    if (activeFilters.modifiedTime && !passesModifiedTimeFilter(result.lastModified, activeFilters.modifiedTime)) {
        return false;
    }

    // 最少匹配数过滤
    if (activeFilters.minMatches > 0) {
        const totalMatches = result.matches.reduce((sum, match) => sum + match.positions.length, 0);
        if (totalMatches < activeFilters.minMatches) {
            return false;
        }
    }

    return true;
}

/**
 * 检查文件大小是否通过过滤条件
 */
function passesFileSizeFilter(fileSize, filterValue) {
    const sizeInKB = fileSize / 1024;
    const sizeInMB = sizeInKB / 1024;

    switch (filterValue) {
        case 'small':
            return sizeInKB < 10;
        case 'medium':
            return sizeInKB >= 10 && sizeInKB < 100;
        case 'large':
            return sizeInKB >= 100 && sizeInMB < 1;
        case 'xlarge':
            return sizeInMB >= 1;
        default:
            return true;
    }
}

/**
 * 检查修改时间是否通过过滤条件
 */
function passesModifiedTimeFilter(lastModified, filterValue) {
    if (!lastModified) {
        return true;
    }

    const now = new Date();
    const modifiedDate = new Date(lastModified);
    const diffInDays = (now - modifiedDate) / (1000 * 60 * 60 * 24);

    switch (filterValue) {
        case 'today':
            return diffInDays < 1;
        case 'week':
            return diffInDays < 7;
        case 'month':
            return diffInDays < 30;
        case 'older':
            return diffInDays >= 30;
        default:
            return true;
    }
}

/**
 * 显示过滤后的结果
 */
function displayFilteredResults(results, keywords) {
    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="no-results">
                <p>🔍 没有符合过滤条件的文件</p>
                <p class="text-small margin-top-small opacity-80">尝试调整过滤条件或清除过滤器</p>
            </div>
        `;
        updateStatsText(0, 0);
        paginationSection.classList.add('hidden');
        return;
    }

    // 计算统计信息
    const totalMatches = results.reduce((sum, result) =>
        sum + result.matches.reduce((matchSum, match) => matchSum + match.positions.length, 0), 0
    );

    // 更新统计信息
    updateStatsText(results.length, totalMatches);

    // 重置分页状态
    currentPage = 1;

    // 使用分页显示结果
    updatePaginatedResults();
}

/**
 * 更新统计文本
 */
function updateStatsText(fileCount, matchCount) {
    const filterInfo = getActiveFilterInfo();
    const baseText = `📊 找到 ${fileCount} 个文件 (共 ${matchCount} 处匹配)`;
    statsText.textContent = filterInfo ? `${baseText} ${filterInfo}` : baseText;
}

/**
 * 获取当前激活的过滤器信息
 */
function getActiveFilterInfo() {
    const activeFilterNames = [];

    if (activeFilters.fileType) {
        activeFilterNames.push(`类型:${activeFilters.fileType}`);
    }
    if (activeFilters.fileSize) {
        const sizeLabels = {
            'small': '小文件',
            'medium': '中等文件',
            'large': '大文件',
            'xlarge': '超大文件'
        };
        activeFilterNames.push(`大小:${sizeLabels[activeFilters.fileSize]}`);
    }
    if (activeFilters.modifiedTime) {
        const timeLabels = {
            'today': '今天',
            'week': '本周',
            'month': '本月',
            'older': '更早'
        };
        activeFilterNames.push(`时间:${timeLabels[activeFilters.modifiedTime]}`);
    }
    if (activeFilters.minMatches > 0) {
        activeFilterNames.push(`匹配≥${activeFilters.minMatches}`);
    }

    return activeFilterNames.length > 0 ? `[已过滤: ${activeFilterNames.join(', ')}]` : '';
}








/**
 * 切换文件预览
 */
function togglePreview(resultItem) {
    const preview = resultItem.querySelector('.result-preview');
    if (preview) {
        const isHidden = preview.classList.contains('hidden');
        if (isHidden) {
            preview.classList.remove('hidden');
        } else {
            preview.classList.add('hidden');
        }
    }
}





/**
 * 更新分页结果显示
 */
function updatePaginatedResults() {
    if (filteredResults.length === 0) {
        return;
    }

    // 计算分页信息
    totalPages = Math.ceil(filteredResults.length / pageSize);
    currentPage = Math.min(currentPage, totalPages);

    // 获取当前页的结果
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredResults.length);
    const pageResults = filteredResults.slice(startIndex, endIndex);

    // 显示当前页结果
    displayPageResults(pageResults, currentKeywords);

    // 更新分页控件
    updatePaginationControls();
}

/**
 * 显示当前页的结果
 */
function displayPageResults(results, keywords) {
    // 按目录分组显示结果
    const groupedResults = groupResultsByDirectory(results);
    const resultsHtml = generateGroupedResultsHtml(groupedResults, keywords);

    searchResults.innerHTML = `<div class="results-list">${resultsHtml}</div>`;

    // 添加点击事件
    addResultClickHandlers(keywords);


}

/**
 * 更新分页控件状态
 */
function updatePaginationControls() {
    // 更新分页信息
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, filteredResults.length);
    paginationInfo.textContent = `第 ${currentPage} 页，共 ${totalPages} 页 (显示 ${startItem}-${endItem}，共 ${filteredResults.length} 项)`;

    // 更新按钮状态
    firstPageBtn.disabled = currentPage === 1;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
    lastPageBtn.disabled = currentPage === totalPages;

    // 生成页码按钮
    generatePageNumbers();

    // 显示或隐藏分页控件
    if (totalPages > 1) {
        paginationSection.classList.remove('hidden');
    } else {
        paginationSection.classList.add('hidden');
    }
}

/**
 * 生成页码按钮
 */
function generatePageNumbers() {
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // 调整起始页，确保显示足够的页码
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    let pageNumbersHtml = '';

    // 添加省略号（如果需要）
    if (startPage > 1) {
        pageNumbersHtml += `<button class="page-number-btn" data-page="1">1</button>`;
        if (startPage > 2) {
            pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
        }
    }

    // 添加页码按钮
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage ? 'active' : '';
        pageNumbersHtml += `<button class="page-number-btn ${isActive}" data-page="${i}">${i}</button>`;
    }

    // 添加省略号（如果需要）
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
        }
        pageNumbersHtml += `<button class="page-number-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    pageNumbers.innerHTML = pageNumbersHtml;

    // 添加页码按钮点击事件
    pageNumbers.querySelectorAll('.page-number-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            currentPage = parseInt(this.getAttribute('data-page'));
            updatePaginatedResults();
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getFileName(path) {
    return path.split(/[/\\]/).pop() || path;
}

function showConfigDialog() {
    // 检查是否已经存在对话框
    const existingDialog = document.querySelector('.config-dialog-overlay');
    if (existingDialog) {
        return; // 如果已经存在，直接返回
    }

    // 创建配置对话框
    const dialog = document.createElement('div');
    dialog.className = 'config-dialog-overlay';
    dialog.innerHTML = `
        <div class="config-dialog">
            <div class="config-dialog-header">
                <h3>搜索配置</h3>
                <button class="config-dialog-close" id="configDialogClose">×</button>
            </div>
            <div class="config-dialog-content">
                <div class="config-section">
                    <h4>搜索选项</h4>
                    <label class="config-checkbox-label">
                        <input type="checkbox" id="configCaseSensitive" />
                        <span class="checkmark"></span>
                        区分大小写
                    </label>
                    <label class="config-checkbox-label">
                        <input type="checkbox" id="configWholeWord" />
                        <span class="checkmark"></span>
                        全字匹配
                    </label>
                </div>
                <div class="config-section">
                    <h4>文件过滤</h4>
                    <div class="config-input-group">
                        <label>最大文件大小 (KB):</label>
                        <input type="number" id="configMaxFileSize" min="1" max="102400" step="1" />
                    </div>
                </div>
                <div class="config-section">
                    <h4>包含文件类型</h4>
                    <textarea id="configIncludePatterns" placeholder="例如：js, ts, vue, html, css..." rows="3"></textarea>
                    <small>用逗号分隔多个文件扩展名</small>
                </div>
                <div class="config-section">
                    <h4>忽略文件和目录</h4>
                    <textarea id="configIgnorePatterns" placeholder="**/node_modules/**, **/.git/**" rows="3"></textarea>
                    <small>用逗号分隔多个模式</small>
                </div>
            </div>
            <div class="config-dialog-actions">
                <button id="configDialogSave" class="config-btn-primary">保存</button>
                <button id="configDialogCancel" class="config-btn-secondary">取消</button>
                <button id="configDialogReset" class="config-btn-secondary">重置为默认</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 使用setTimeout确保DOM元素完全添加后再绑定事件和加载配置
    setTimeout(() => {
        // 添加事件监听器
        const closeBtn = document.getElementById('configDialogClose');
        const cancelBtn = document.getElementById('configDialogCancel');
        const saveBtn = document.getElementById('configDialogSave');
        const resetBtn = document.getElementById('configDialogReset');

        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('关闭按钮被点击');
                closeConfigDialog();
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('取消按钮被点击');
                closeConfigDialog();
            });
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('保存按钮被点击');
                saveConfig();
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('重置按钮被点击');
                resetConfig();
            });
        }

        // 点击遮罩层关闭
        dialog.addEventListener('click', function(e) {
            if (e.target === dialog) {
                closeConfigDialog();
            }
        });

        // 事件绑定完成后，加载当前配置
        vscode.postMessage({
            command: 'getConfig'
        });
    }, 0);
}

function closeConfigDialog() {
    console.log('closeConfigDialog 被调用');
    const dialog = document.querySelector('.config-dialog-overlay');
    console.log('找到的对话框元素:', dialog);
    if (dialog && document.body.contains(dialog)) {
        try {
            document.body.removeChild(dialog);
            console.log('配置对话框已关闭');
        } catch (error) {
            console.error('关闭配置对话框时出错:', error);
        }
    } else {
        console.log('没有找到配置对话框或对话框不在DOM中');
    }
}

function saveConfig() {
    const caseSensitive = document.getElementById('configCaseSensitive').checked;
    const wholeWord = document.getElementById('configWholeWord').checked;
    const maxFileSize = parseInt(document.getElementById('configMaxFileSize').value); // 直接使用KB值

    // 将简化格式转换为完整的glob模式
    const includePatterns = document.getElementById('configIncludePatterns').value
        .split(',').map(p => {
            const trimmed = p.trim();
            if (trimmed.length === 0) return '';
            // 如果已经是完整格式，直接返回
            if (trimmed.startsWith('**/') || trimmed.includes('/')) {
                return trimmed;
            }
            // 如果是简化格式（如 js），转换为 **/*.js
            return `**/*.${trimmed}`;
        }).filter(p => p.length > 0);

    const ignorePatterns = document.getElementById('configIgnorePatterns').value
        .split(',').map(p => p.trim()).filter(p => p.length > 0);

    vscode.postMessage({
        command: 'updateConfig',
        config: {
            caseSensitive,
            wholeWord,
            maxFileSize,
            includePatterns,
            ignorePatterns
        }
    });

    closeConfigDialog();
}

function resetConfig() {
    // 重置为默认值
    document.getElementById('configCaseSensitive').checked = false;
    document.getElementById('configWholeWord').checked = false;
    document.getElementById('configMaxFileSize').value = '1024';
    document.getElementById('configIncludePatterns').value = 'js, ts, jsx, jsp, tsx, vue, html, css, scss, less, json, md, txt, py, java, c, cpp, h, php, rb, go, rs, xml, yaml, yml';
    document.getElementById('configIgnorePatterns').value = '**/node_modules/**, **/.git/**, **/dist/**, **/build/**, **/*.min.js, **/*.map';
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // 自动消失
    setTimeout(() => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    }, 3000);
}

function addKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl+Enter 或 Cmd+Enter 执行搜索
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!isSearching) {
                handleSearch();
            }
        }

        // Escape 键清除结果
        if (e.key === 'Escape') {
            if (document.querySelector('.config-dialog-overlay')) {
                closeConfigDialog();
            } else {
                clearResults();
                keywordsInput.focus();
            }
        }

        // Ctrl+K 或 Cmd+K 聚焦搜索框
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            keywordsInput.focus();
            keywordsInput.select();
        }

        // Alt+W 切换全字匹配
        if (e.altKey && e.key === 'w') {
            e.preventDefault();
            if (wholeWordCheckbox) {
                wholeWordCheckbox.checked = !wholeWordCheckbox.checked;
                // 触发change事件以保存配置
                wholeWordCheckbox.dispatchEvent(new Event('change'));
            }
        }
    });
}



// 在初始化时添加键盘快捷键
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    loadConfiguration();
    addKeyboardShortcuts();


});
