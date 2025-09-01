# 关键词交集搜索 VSCode 扩展

一个强大的 VSCode 扩展，用于在工作区中搜索同时包含多个关键词的文件。

## 功能特性

- 🔍 **多关键词交集搜索**：输入多个关键词，快速找到同时包含所有关键词的文件
- 📁 **智能文件过滤**：支持配置包含和排除的文件类型
- 🎯 **精确定位**：点击搜索结果直接跳转到文件并高亮显示匹配内容
- 📊 **详细统计**：显示匹配次数、文件大小等详细信息
- 🌳 **树形视图**：在侧边栏以树形结构展示搜索结果
- ⚙️ **灵活配置**：支持大小写敏感、文件大小限制等多种配置选项

## 使用方法

### 基本搜索

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 "交集搜索" 或 "intersection search"
3. 选择 "交集搜索: 搜索多个关键词"
4. 在输入框中输入关键词，用空格分隔（例如：`项目代码 项目名称`）
5. 查看搜索结果并点击文件名打开

### 查看结果

搜索完成后，结果会在以下位置显示：

- **快速选择器**：立即显示搜索结果列表
- **侧边栏树视图**：在资源管理器中显示 "关键词交集搜索结果" 面板
- **输出面板**：显示详细的搜索统计和匹配信息

## 配置选项

在 VSCode 设置中搜索 "intersectionSearch" 可以找到以下配置选项：

### `intersectionSearch.caseSensitive`
- **类型**: `boolean`
- **默认值**: `false`
- **描述**: 是否区分大小写

### `intersectionSearch.maxFileSize`
- **类型**: `number`
- **默认值**: `1048576` (1MB)
- **描述**: 搜索文件的最大大小（字节）

### `intersectionSearch.includePatterns`
- **类型**: `array`
- **默认值**: 包含常见的代码文件类型
- **描述**: 包含在搜索中的文件模式

### `intersectionSearch.ignorePatterns`
- **类型**: `array`
- **默认值**: `["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]`
- **描述**: 忽略搜索的文件或目录模式

## 示例配置

```json
{
  "intersectionSearch.caseSensitive": true,
  "intersectionSearch.maxFileSize": 2097152,
  "intersectionSearch.includePatterns": [
    "**/*.js",
    "**/*.ts",
    "**/*.vue",
    "**/*.md"
  ],
  "intersectionSearch.ignorePatterns": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/*.min.js"
  ]
}
```

## 使用场景

- **代码重构**：查找需要同时修改多个相关概念的文件
- **功能开发**：找到涉及特定功能模块的所有相关文件
- **问题排查**：定位包含特定错误信息和相关上下文的文件
- **文档整理**：查找同时提到多个主题的文档文件

## 开发和构建

### 环境要求

- Node.js 16+
- VSCode 1.74.0+

### 本地开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 监听文件变化
npm run watch

# 运行 ESLint
npm run lint

# 打包扩展
npm run package
```

### 调试扩展

1. 在 VSCode 中打开项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中测试扩展功能

## 技术实现

- **语言**: TypeScript
- **框架**: VSCode Extension API
- **主要模块**:
  - `extension.ts`: 扩展入口和命令注册
  - `search.ts`: 核心搜索逻辑
  - `utils.ts`: 工具函数和配置管理
  - `resultView.ts`: 结果展示和用户界面

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 更新日志

### 1.0.0
- 初始版本发布
- 支持多关键词交集搜索
- 提供树形视图和详细结果展示
- 支持文件类型过滤和大小限制
