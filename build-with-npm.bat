@echo off
echo =========================================
echo 开始使用 npm 打包 Vela (Release 构建)
echo =========================================

REM 1. 备份 pnpm 锁文件
copy pnpm-lock.yaml pnpm-lock.yaml.bak

REM 2. 清理
rd /s /q node_modules
del pnpm-lock.yaml

REM 3. npm 安装
call npm install
if %errorlevel% neq 0 (
    echo npm install 失败，终止打包
    exit /b 1
)

REM 4. 重建原生模块
call npx @electron/rebuild -f
if %errorlevel% neq 0 (
    echo @electron/rebuild 失败，终止打包
    exit /b 1
)

REM 5. 清理旧包
rd /s /q release
rd /s /q dist

REM 6. 执行打包
call npm run build
echo.
echo 打包结束，检查 release 文件夹。
echo.

REM 7. 恢复 pnpm 环境
del package-lock.json
rd /s /q node_modules
copy pnpm-lock.yaml.bak pnpm-lock.yaml
call pnpm install

echo =========================================
echo 完成！已恢复 pnpm 开发环境。
echo =========================================