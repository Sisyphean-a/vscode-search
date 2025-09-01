// TypeScript文件，包含项目代码但不包含项目名称
interface ProjectConfig {
    code: string;
    version: string;
    description: string;
}

const config: ProjectConfig = {
    code: "vscode-extension",
    version: "1.0.0", 
    description: "一个强大的VSCode扩展"
};

export class ProjectManager {
    private projectCode: string;
    
    constructor(code: string) {
        this.projectCode = code;
    }
    
    getCode(): string {
        return this.projectCode;
    }
}
