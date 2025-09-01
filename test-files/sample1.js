// 这是一个测试文件，包含项目代码和项目名称
const projectName = "VSCode关键词搜索扩展";
const projectCode = "vscode-search-extension";

function initializeProject() {
    console.log(`初始化项目: ${projectName}`);
    console.log(`项目代码: ${projectCode}`);
}

// 项目配置
const config = {
    name: projectName,
    code: projectCode,
    version: "1.0.0"
};

module.exports = { initializeProject, config };
