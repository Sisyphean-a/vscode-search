# 更新日志

本文件记录了项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2024-12-19

### 新增
- 🔍 多关键词交集搜索功能
- 🎨 专用的 Webview 搜索面板
- ⚡ 支持 ripgrep 高性能搜索
- 🎯 智能文件过滤和排除模式
- 📋 文件路径复制功能
- 🔧 丰富的配置选项
- 📱 响应式界面设计
- 🎨 关键词高亮显示
- 📄 文件内容预览
- ⌨️ 快捷键支持

### 功能特性
- **搜索功能**：
  - 多关键词空格分隔搜索
  - 全字匹配模式
  - 大小写敏感选项
  - 文件大小限制
  - 自定义包含/排除模式

- **界面功能**：
  - 现代化 Webview 界面
  - 实时搜索结果显示
  - 文件预览功能
  - 结果分页显示
  - 紧凑布局设计

- **操作功能**：
  - 单击预览，双击打开
  - 文件路径复制
  - 快捷键操作
  - 智能缓存机制

### 技术实现
- TypeScript 开发
- VSCode Extension API
- Webview 技术
- ripgrep 集成
- 文件系统监控

### 配置选项
- `intersectionSearch.caseSensitive`: 大小写敏感
- `intersectionSearch.wholeWord`: 全字匹配
- `intersectionSearch.maxFileSize`: 最大文件大小
- `intersectionSearch.includePatterns`: 包含文件模式
- `intersectionSearch.ignorePatterns`: 忽略文件模式

### 系统要求
- VSCode 1.74.0+
- 推荐安装 ripgrep 以获得最佳性能

---

## 未来计划

### [1.1.0] - 计划中
- 🔍 正则表达式搜索支持
- 📊 搜索统计信息
- 🎨 自定义主题支持
- 📱 移动端适配优化

### [1.2.0] - 计划中
- 🔄 搜索历史记录
- 📁 搜索结果导出
- 🔗 文件关联分析
- 🎯 智能搜索建议

---

**注意**: 版本号遵循语义化版本规范 (MAJOR.MINOR.PATCH)
- MAJOR: 不兼容的 API 修改
- MINOR: 向下兼容的功能性新增
- PATCH: 向下兼容的问题修正
