// VSCode API
const vscode = acquireVsCodeApi();

// DOM元素
let keywordsInput;
let searchBtn;
let caseSensitiveCheckbox;
let includeSubdirsCheckbox;
let searchProgress;
let progressFill;
let progressText;
let searchStats;
let statsText;
let searchResults;
let noResults;
let configBtn;
let clearBtn;
let exportBtn;

// 状态
let currentResults = [];
let currentKeywords = [];
let isSearching = false;

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
    searchProgress = document.getElementById('searchProgress');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    searchStats = document.getElementById('searchStats');
    statsText = document.getElementById('statsText');
    searchResults = document.getElementById('searchResults');
    noResults = document.getElementById('noResults');
    configBtn = document.getElementById('configBtn');
    clearBtn = document.getElementById('clearBtn');
    exportBtn = document.getElementById('exportBtn');
}

function setupEventListeners() {
    // 搜索按钮点击
    searchBtn.addEventListener('click', handleSearch);
    
    // 回车键搜索
    keywordsInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !isSearching) {
            handleSearch();
        }
    });
    
    // 配置变化
    caseSensitiveCheckbox.addEventListener('change', function() {
        vscode.postMessage({
            command: 'updateConfig',
            config: {
                caseSensitive: caseSensitiveCheckbox.checked
            }
        });
    });
    
    // 清除按钮
    clearBtn.addEventListener('click', function() {
        clearResults();
        keywordsInput.value = '';
        keywordsInput.focus();
    });
    
    // 配置按钮
    configBtn.addEventListener('click', function() {
        showConfigDialog();
    });
    
    // 导出按钮
    exportBtn.addEventListener('click', function() {
        exportResults();
    });
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
    
    vscode.postMessage({
        command: 'search',
        keywords: keywordArray
    });
}

function showError(message) {
    // 简单的错误显示
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #f44336;
        color: white;
        padding: 12px 16px;
        border-radius: 4px;
        z-index: 1000;
        font-size: 14px;
    `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        document.body.removeChild(errorDiv);
    }, 3000);
}

function clearResults() {
    currentResults = [];
    currentKeywords = [];
    searchResults.innerHTML = '<div class="no-results" id="noResults"><p>输入关键词开始搜索</p></div>';
    searchStats.style.display = 'none';
    exportBtn.disabled = true;
}

function loadConfiguration() {
    vscode.postMessage({
        command: 'getConfig'
    });
}

function exportResults() {
    if (currentResults.length === 0) {
        return;
    }
    
    const exportData = {
        keywords: currentKeywords,
        timestamp: new Date().toISOString(),
        results: currentResults.map(result => ({
            path: result.relativePath,
            matches: result.matches.map(match => ({
                keyword: match.keyword,
                count: match.positions.length
            }))
        }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-results-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    searchProgress.style.display = 'block';
    searchStats.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '正在搜索...';

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
        progressText.textContent = progress.message;
    }
    if (progress.increment !== undefined) {
        const currentWidth = parseFloat(progressFill.style.width) || 0;
        const newWidth = Math.min(100, currentWidth + progress.increment);
        progressFill.style.width = newWidth + '%';
    }
}

function handleSearchCompleted(results, keywords) {
    isSearching = false;
    currentResults = results;
    currentKeywords = keywords;

    searchBtn.disabled = false;
    searchBtn.innerHTML = '🔍 搜索';
    searchBtn.classList.remove('searching');
    searchProgress.style.display = 'none';

    // 恢复输入框样式
    keywordsInput.style.borderColor = '';

    displayResults(results, keywords);

    // 显示完成通知
    if (results.length > 0) {
        showNotification(`找到 ${results.length} 个匹配文件`, 'success');
    }
}

function handleSearchError(message) {
    isSearching = false;
    searchBtn.disabled = false;
    searchBtn.textContent = '搜索';
    searchProgress.style.display = 'none';
    showError(message);
}

function handleConfigData(config) {
    caseSensitiveCheckbox.checked = config.caseSensitive || false;

    // 如果配置对话框打开，更新对话框中的值
    const dialog = document.querySelector('.config-dialog-overlay');
    if (dialog) {
        document.getElementById('configCaseSensitive').checked = config.caseSensitive || false;
        document.getElementById('configMaxFileSize').value = ((config.maxFileSize || 1048576) / 1024 / 1024).toFixed(1);
        document.getElementById('configIncludePatterns').value = (config.includePatterns || []).join(', ');
        document.getElementById('configIgnorePatterns').value = (config.ignorePatterns || []).join(', ');
    }
}

function handleConfigUpdated(success, message) {
    if (!success && message) {
        showError(message);
    }
}

function displayResults(results, keywords) {
    if (results.length === 0) {
        searchResults.innerHTML = `
            <div class="no-results">
                <p>没有找到同时包含所有关键词的文件</p>
                <p style="font-size: 12px; margin-top: 8px;">关键词: [${keywords.join(', ')}]</p>
                <div style="margin-top: 12px; font-size: 12px; color: var(--vscode-foreground); opacity: 0.7;">
                    <p>建议:</p>
                    <ul style="margin-left: 16px; margin-top: 4px;">
                        <li>• 检查关键词拼写</li>
                        <li>• 尝试减少关键词数量</li>
                        <li>• 检查文件类型配置</li>
                    </ul>
                </div>
            </div>
        `;
        searchStats.style.display = 'none';
        exportBtn.disabled = true;
        return;
    }

    // 显示统计信息
    const totalMatches = results.reduce((sum, result) =>
        sum + result.matches.reduce((matchSum, match) => matchSum + match.positions.length, 0), 0
    );

    statsText.textContent = `📊 找到 ${results.length} 个文件 (共 ${totalMatches} 处匹配)`;
    searchStats.style.display = 'block';
    exportBtn.disabled = false;

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

            return `
                <div class="result-item" data-file-path="${escapeHtml(result.filePath)}">
                    <div class="result-file">
                        <span class="result-file-icon">${getFileIcon(result.relativePath)}</span>
                        <span class="result-file-name">${escapeHtml(getFileName(result.relativePath))}</span>
                        <span class="result-file-matches-count">(${totalFileMatches})</span>
                    </div>
                    <div class="result-file-path">${escapeHtml(result.relativePath)}</div>
                    <div class="result-matches">${matchesHtml}</div>
                    <div class="result-file-info">大小: ${fileSize}</div>
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
    searchResults.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', function() {
            const filePath = this.getAttribute('data-file-path');
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath,
                keywords: keywords
            });
        });
    });
}

function getFileIcon(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const iconMap = {
        'js': '📄',
        'ts': '📘',
        'jsx': '⚛️',
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getFileName(path) {
    return path.split(/[/\\]/).pop() || path;
}

function showConfigDialog() {
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
                </div>
                <div class="config-section">
                    <h4>文件过滤</h4>
                    <div class="config-input-group">
                        <label>最大文件大小 (MB):</label>
                        <input type="number" id="configMaxFileSize" min="0.1" max="100" step="0.1" />
                    </div>
                </div>
                <div class="config-section">
                    <h4>包含文件类型</h4>
                    <textarea id="configIncludePatterns" placeholder="**/*.js, **/*.ts, **/*.vue" rows="3"></textarea>
                    <small>用逗号分隔多个模式</small>
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

    // 加载当前配置
    vscode.postMessage({
        command: 'getConfig'
    });

    // 添加事件监听器
    document.getElementById('configDialogClose').addEventListener('click', closeConfigDialog);
    document.getElementById('configDialogCancel').addEventListener('click', closeConfigDialog);
    document.getElementById('configDialogSave').addEventListener('click', saveConfig);
    document.getElementById('configDialogReset').addEventListener('click', resetConfig);

    // 点击遮罩层关闭
    dialog.addEventListener('click', function(e) {
        if (e.target === dialog) {
            closeConfigDialog();
        }
    });
}

function closeConfigDialog() {
    const dialog = document.querySelector('.config-dialog-overlay');
    if (dialog) {
        document.body.removeChild(dialog);
    }
}

function saveConfig() {
    const caseSensitive = document.getElementById('configCaseSensitive').checked;
    const maxFileSize = parseFloat(document.getElementById('configMaxFileSize').value) * 1024 * 1024; // 转换为字节
    const includePatterns = document.getElementById('configIncludePatterns').value
        .split(',').map(p => p.trim()).filter(p => p.length > 0);
    const ignorePatterns = document.getElementById('configIgnorePatterns').value
        .split(',').map(p => p.trim()).filter(p => p.length > 0);

    vscode.postMessage({
        command: 'updateConfig',
        config: {
            caseSensitive,
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
    document.getElementById('configMaxFileSize').value = '1';
    document.getElementById('configIncludePatterns').value = '**/*.js, **/*.ts, **/*.jsx, **/*.tsx, **/*.vue, **/*.html, **/*.css, **/*.scss, **/*.less, **/*.json, **/*.md, **/*.txt, **/*.py, **/*.java, **/*.c, **/*.cpp, **/*.h, **/*.php, **/*.rb, **/*.go, **/*.rs, **/*.xml, **/*.yaml, **/*.yml';
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
    });
}

// 在初始化时添加键盘快捷键
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    loadConfiguration();
    addKeyboardShortcuts();
});
