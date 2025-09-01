# VSCode 关键词交集搜索扩展 - 使用指南

## 快速开始

### 1. 安装和运行扩展

在VSCode中：
1. 按 `F5` 启动扩展开发主机
2. 在新打开的VSCode窗口中测试扩展功能

### 2. 使用扩展

1. **打开命令面板**: 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac)
2. **输入命令**: 输入 "交集搜索" 或 "intersection search"
3. **选择命令**: 选择 "交集搜索: 搜索多个关键词"
4. **输入关键词**: 在弹出的输入框中输入关键词，用空格分隔

### 3. 测试示例

在当前项目中，我们已经创建了一些测试文件：

- `test-files/sample1.js` - 包含 "项目代码" 和 "项目名称"
- `test-files/sample2.ts` - 只包含 "项目代码"
- `test-files/sample3.md` - 包含 "项目代码" 和 "项目名称"
- `test-files/sample4.json` - 只包含 "项目名称"

**测试用例**:
- 搜索 `项目代码 项目名称` - 应该找到 `sample1.js` 和 `sample3.md`
- 搜索 `项目代码` - 应该找到 `sample1.js`, `sample2.ts`, `sample3.md`
- 搜索 `项目名称` - 应该找到 `sample1.js`, `sample3.md`, `sample4.json`

### 4. 查看结果

搜索完成后，结果会在以下位置显示：

1. **快速选择器** - 立即显示搜索结果列表，点击可打开文件
2. **侧边栏树视图** - 在资源管理器中显示 "关键词交集搜索结果" 面板
3. **输出面板** - 显示详细的搜索统计和匹配信息

### 5. 配置选项

在VSCode设置中搜索 "intersectionSearch" 可以配置：

- **大小写敏感**: 是否区分大小写搜索
- **文件大小限制**: 搜索文件的最大大小
- **包含模式**: 要搜索的文件类型
- **忽略模式**: 要忽略的文件和目录

## 开发和调试

### 编译代码
```bash
npm run compile
```

### 监听文件变化
```bash
npm run watch
```

### 代码检查
```bash
npm run lint
```

### 打包扩展
```bash
npm run package
```

## 故障排除

1. **扩展无法启动**: 确保已运行 `npm install` 和 `npm run compile`
2. **搜索无结果**: 检查文件类型是否在包含模式中
3. **性能问题**: 调整文件大小限制和忽略模式

## 技术架构

- **extension.ts**: 扩展入口，命令注册
- **search.ts**: 核心搜索逻辑
- **utils.ts**: 工具函数和配置管理
- **resultView.ts**: 结果展示界面
