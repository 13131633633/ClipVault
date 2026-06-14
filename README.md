# ClipVault

[English README](README_EN.md)

![License](https://img.shields.io/github/license/13131633633/ClipVault)
![Release](https://img.shields.io/github/v/release/13131633633/ClipVault)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android%20%7C%20Linux%20%7C%20iOS-60A5FA)

局域网剪贴板同步工具，支持 Windows / Linux / Android / iOS。  
核心目标是“复制即同步”，不走公网，不需要端口映射，设备都在同一局域网里就能互通。
如果你觉得项目还不错的话可以给个STAR吗ヾ(≧▽≦*)o

一句话：ClipVault 是一个开源的局域网剪贴板同步工具，让 Windows 和 Android 之间复制文本、图片后自动同步到系统剪贴板。

关键词：剪贴板同步、局域网同步、跨设备复制、Windows Android 剪贴板、clipboard sync、LAN clipboard、ADB clipboard。

## 立即下载

- [Windows 安装版 EXE](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Windows-Setup-1.0.0.exe)
- [Windows 免安装 EXE](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Windows-Portable-1.0.0.exe)
- [Android APK](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Android-debug-1.0.0.apk)
- [完整 Releases 页面](https://github.com/13131633633/ClipVault/releases)

## 快速开始

如果你只是想先把它跑起来，不想先看长文档，按这个顺序来：

### 方式 1：直接使用 Windows 发布版

1. 打开 Releases 页面，下载 Windows 安装包 `ClipVault Setup *.exe`
2. 安装后启动 ClipVault
3. 在电脑端点击生成配对二维码
4. 手机端安装安卓 APK 或运行 Android Studio 工程
5. 手机端点击扫码连接，扫电脑二维码
6. 如果你希望安卓端在后台也持续读取系统剪贴板，再去开启“高级后台同步”

当前仓库里已经打好的 Windows 包位置：

- 安装包：[ClipVault-Windows-Setup-1.0.0.exe](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Windows-Setup-1.0.0.exe)
- 免安装版：[ClipVault-Windows-Portable-1.0.0.exe](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Windows-Portable-1.0.0.exe)

### 方式 2：从源码启动 Windows 桌面端

```bash
npm install
npm run dev:desktop
```

打包 EXE：

```bash
npm run build:desktop
```

### 方式 3：安卓端快速安装

标准 Debug APK 输出路径：

- [ClipVault-Android-debug-1.0.0.apk](https://github.com/13131633633/ClipVault/releases/download/v1.0.0/ClipVault-Android-debug-1.0.0.apk)

重新编译安卓：

```bash
cd android
gradlew.bat assembleDebug
```

## 项目预览

真实项目界面如下，桌面端和安卓端保持同一套浅蓝卡片风格。

### Windows 桌面端

![ClipVault Windows 连接页](docs/images/desktop-connect.png)

### Android 首页

![ClipVault Android 首页](docs/images/android-home.jpg)

### Android 二维码配对

![ClipVault Android 二维码页](docs/images/android-qr.jpg)

### Android 高级后台同步设置

![ClipVault Android 设置页](docs/images/android-settings.jpg)

## 安卓后台同步，两种开启方式

### 方案 A：无线调试配对，体验最好

适用于支持 Android 11+ 无线调试入口的手机。

1. 打开手机的“设置”
2. 进入“关于手机”
3. 连续点击“版本号”或“Build number”7 次，直到系统提示“你已处于开发者模式”
4. 返回设置首页，进入“系统管理”“更多设置”或“开发者选项”
5. 打开“开发者选项”
6. 打开“无线调试”
7. 打开 ClipVault
8. 进入“设置”或“连接”页，点击“高级后台同步”
9. 在系统无线调试页面里点“使用配对码配对设备”
10. 保持这个系统配对弹窗不要关闭
11. 下拉通知栏，找到 ClipVault 的“高级后台同步”通知
12. 点击“输入配对码”
13. 输入系统弹窗里显示的 6 位配对码
14. 等待 ClipVault 自动完成配对和直连
15. 首次配对成功后，后续重新打开应用、服务重启、开机广播拉起时都会自动尝试回连 ADB

### 方案 B：USB ADB TCP/IP 兜底，兼容不支持无线调试的手机

适用于没有无线调试入口、或者 ROM 把无线调试做得很烂的设备。

前提：

1. 手机打开开发者选项
2. 打开 USB 调试
3. 手机和电脑接上 USB 线
4. 手机同时连着 Wi-Fi
5. 电脑已经安装 adb（Android Studio 自带 Platform Tools 即可）

执行脚本：

```bat
scripts\android-adb-tcpip.bat
```

这个脚本会自动做这些事：

1. 检查 USB 调试设备是否在线
2. 切换 `adb tcpip 5555`
3. 自动读取手机当前 Wi-Fi IP
4. 自动执行 `adb connect 手机IP:5555`
5. 自动给 ClipVault 补上后台白名单和 appops 允许项
6. 自动拉起 ClipVault

脚本位置：

- [scripts/android-adb-tcpip.bat](scripts/android-adb-tcpip.bat)

说明：

- 这是 USB 辅助入口，不是替代 Windows 客户端的连接方式
- 它主要解决“安卓后台读取系统剪贴板需要 ADB 权限，但这台手机没有无线调试入口”的问题
- 如果你后续换到支持无线调试的手机，优先用方案 A

## 安卓小白详细教程

如果你之前没碰过开发者选项，可以按下面一步一步来。

### 第一步：打开开发者选项

常见安卓手机基本都是这个路径：

1. 打开“设置”
2. 找到“关于手机”
3. 找到“版本号”或“Build number”
4. 连续点击 7 次
5. 如果系统要求输入锁屏密码，就输入一次
6. 看到“你已处于开发者模式”或者“开发者选项已开启”就可以了

不同品牌可能会有这些名字：

- 小米 / 红米：`设置 -> 我的设备 -> 全部参数 -> MIUI 版本`
- OPPO / 一加 / realme：`设置 -> 关于本机 -> 版本信息 -> 版本号`
- vivo / iQOO：`设置 -> 系统管理 -> 关于手机 -> 软件版本号`
- 华为 / 荣耀：`设置 -> 关于手机 -> 版本号`
- 三星：`设置 -> 关于手机 -> 软件信息 -> 编译编号`

### 第二步：找到无线调试或 USB 调试

打开开发者选项后，一般在这里能找到：

- `设置 -> 系统 -> 开发者选项`
- `设置 -> 更多设置 -> 开发者选项`
- `设置 -> 系统管理 -> 开发者选项`

进入后：

1. 先打开 `USB 调试`
2. 如果手机支持，再打开 `无线调试`

### 第三步：用 ClipVault 开启高级后台同步

#### 如果手机支持无线调试

1. 打开 ClipVault
2. 点“设置”或“连接”
3. 点“高级后台同步”
4. 系统会跳到无线调试页面
5. 点“使用配对码配对设备”
6. 不要关闭这个系统配对弹窗
7. 下拉通知栏
8. 找到 ClipVault 的“高级后台同步”通知
9. 点“输入配对码”
10. 把系统弹窗里的 6 位数字输进去
11. 等待显示连接成功

#### 如果手机不支持无线调试

1. 用 USB 线把手机连到电脑
2. 手机上打开 `USB 调试`
3. 手机连上 Wi-Fi
4. 在电脑上运行：

```bat
scripts\android-adb-tcpip.bat
```

5. 如果手机弹出 USB 调试授权框，点“允许”
6. 脚本跑完后，再打开手机上的 ClipVault

### 第四步：把后台权限尽量开全

为了让安卓端更稳，建议至少把这些都打开：

1. 通知权限
2. 电池优化白名单 / 无限电量 / 不受限制
3. 自启动
4. 后台弹出界面
5. 精确闹钟
6. 悬浮窗

如果你的手机有“手机管家”“应用启动管理”“耗电管理”“后台冻结”“深度清理”之类页面，也建议把 ClipVault 加入白名单。

## 项目是什么

ClipVault 是一个 Node.js 主工程，不是单一平台的原生仓库。

- Windows / Linux 桌面端：`Electron + Node.js + React`
- Android 客户端：`Capacitor + React UI + Kotlin`
- iOS 客户端：`Capacitor + React UI + Swift`

也就是说：

- Windows 端不是 C# WinForms、WPF、Qt 或 Java Swing 项目
- 桌面端运行、构建、打包都通过 `package.json` 管理
- Android / iOS 共享一套前端界面，再通过 Capacitor 接入各自原生能力

Windows 安装包、桌面窗口与托盘图标统一复用安卓启动图标：

- [assets/desktop-icon.png](assets/desktop-icon.png)
- [assets/desktop-icon.ico](assets/desktop-icon.ico)

## 功能清单

- 局域网二维码配对
- 6 位配对码连接
- 文本 / PNG 图片双向实时同步
- 本地历史记录、搜索、单条复制、删除、清空
- 多设备同时连接
- 设备管理、单个断开、全部断开
- 开机自启、同步开关、历史记录上限、主题固定
- Windows / Linux 托盘常驻、最小化隐藏、全局快捷键 `Ctrl/Cmd + Shift + V`
- Android 前台服务、开机自启广播、权限引导、ADB 后台增强同步

## 仓库结构

```text
.
├─ android/              Android Studio 工程
├─ assets/               桌面端图标等共享资源
├─ docs/                 协议与补充文档
├─ electron/             Electron 主进程、托盘、TCP 服务
├─ ios/                  Xcode 工程
├─ public/               Web 静态资源
├─ scripts/              辅助脚本，例如 USB ADB TCP/IP
├─ src/                  React 共享界面与桥接层
├─ dist/                 Web 构建产物
├─ release/              Electron 打包产物
├─ capacitor.config.ts   Capacitor 配置
├─ package.json          Node.js 主工程入口
└─ README.md
```

## 默认输出路径

仓库已恢复到标准默认输出目录，开源后别人拉下来可以直接按常规路径找产物：

- Android Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- Android Release APK / AAB：`android/app/build/outputs/`
- Web 前端构建产物：`dist/`
- Electron 桌面端打包产物：`release/`

说明：

- Android 端不再使用自定义 `build_clipvault/` 输出目录
- Android Gradle 也不再依赖实验性的 `android.overridePathCheck`

## 环境要求

### 通用

- Node.js 24+
- npm 11+

### Windows / Linux 桌面端

- 不额外依赖本地 Python / Rust / Go
- 运行时依赖 Node.js 与 Electron
- 首次桌面打包时 `electron-builder` 会下载 Electron 打包资源

### Android

- Android Studio Koala 或更新版本
- Android SDK Platform 36
- JDK 17 或更新版本
- 如果要使用 USB ADB 辅助脚本，需要 adb 在 PATH 中可用

### iOS

- Xcode 16 或更新版本
- iOS 16+ 模拟器或真机
- CocoaPods 非必需；仓库使用 Capacitor 8 生成的 iOS 宿主工程

## 开发与构建

### 安装依赖

```bash
npm install
```

### 启动 Web 调试界面

```bash
npm run dev
```

说明：

- 这会打开共享前端的浏览器预览模式，方便调 UI
- 浏览器预览模式不会创建真实局域网 TCP 连接

### 启动 Windows / Linux 桌面端

```bash
npm run dev:desktop
```

功能包括：

- 托盘常驻
- 二维码生成
- 剪贴板监听
- TCP 服务端
- 历史记录本地持久化

### 构建 Web 资源

```bash
npm run build
```

### 同步 Web 资源到 Android / iOS 宿主工程

```bash
npm run sync:native
```

### 打开 Android Studio

```bash
npm run open:android
```

### 打开 Xcode

```bash
npm run open:ios
```

### 打包桌面端

```bash
npm run build:desktop
```

## Windows 用户详细部署

### 直接运行源码

```bash
npm install
npm run dev:desktop
```

### 打包生成 EXE

```bash
npm run build:desktop
```

输出：

- 安装包：`release/ClipVault Setup *.exe`
- 免安装目录：`release/win-unpacked/`

### 首次连接手机

1. 打开 Windows 端 ClipVault
2. 点击生成配对二维码
3. 手机端打开 ClipVault
4. 点击扫码连接
5. 扫描电脑二维码
6. 如果要让安卓端退到后台后依然主动上报自己的系统剪贴板，再继续做 ADB 后台同步配置

## 安卓平台使用流程

### 基础连接

1. 导入 `android/` 到 Android Studio
2. 同步 Gradle
3. 安装到真机
4. 首次启动后点击“权限引导”
5. 依次开启：
   - 相机
   - 通知
   - 电池优化白名单
   - 精确闹钟
   - 悬浮窗
   - 厂商自启动
6. 点击“扫码连接”识别电脑端二维码

### 高级后台同步

二选一：

- 支持无线调试的手机：直接用应用内“高级后台同步”
- 不支持无线调试的手机：连上 USB 后执行 `scripts\android-adb-tcpip.bat`

## Android 权限与后台保活说明

Android 端预设了这些能力：

- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_DATA_SYNC`
- `RECEIVE_BOOT_COMPLETED`
- `WAKE_LOCK`
- `POST_NOTIFICATIONS`
- `SYSTEM_ALERT_WINDOW`
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
- `SCHEDULE_EXACT_ALARM`
- `CAMERA`

保活策略：

- 前台服务持续显示同步通知
- 开机广播自动重启服务
- 首次 ADB 配对成功后，后续服务启动会自动直连 ADB，无需再次手点连接
- `AlarmManager` 精确闹钟 watchdog，短周期补拉前台服务
- `WorkManager` 周期巡检，作为 OEM 杀后台后的第二层兜底
- ADB 成功建立后自动执行 `deviceidle whitelist`、`RUN_IN_BACKGROUND`、`RUN_ANY_IN_BACKGROUND`、standby bucket 提权
- 权限引导跳转系统设置页
- 本地历史与设置文件落盘

Android 10+ 对后台读取系统剪贴板有系统限制。ClipVault 当前通过“前台服务 + ADB + 剪贴板 shell agent”实现后台读取；如果没有完成 ADB 配对或 USB ADB TCP/IP 辅助连接，应用退到后台后只能依赖系统允许范围内的普通监听。

需要说明的限制：

- Android 12+ 和各家 ROM 仍可能在长时间待机、极端省电、厂商管家清理时回收进程
- 当前版本已经加入自恢复链路，但不能对所有 ROM 承诺“永不被杀”
- 若要得到最稳表现，建议同时打开通知常驻、电池无限制、自启动、后台弹出界面与精确闹钟权限

## iOS 后台说明

iOS 不允许普通应用无限时后台读取系统剪贴板。当前实现遵循平台规则：

- 前台时实时监听和同步
- 切到后台后开启有限时长后台任务
- 开启 `fetch` 后台模式，允许系统在合适时机唤醒应用刷新状态

这意味着 iOS 无法像 Android 前台服务那样长期无限保活，这是平台规则限制，不是项目遗漏。

## 通信协议

协议是统一的局域网 TCP 长连接，完整字段说明见 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

- 帧格式：`4 字节大端长度 + UTF-8 JSON`
- 主要消息：
  - `hello`
  - `welcome`
  - `clipboard_update`
- 剪贴记录字段：
  - `mimeType`: `text/plain` 或 `image/png`
  - `text`
  - `imageBase64`
  - `sha256`
  - `sourceDeviceId`
  - `sourceDeviceName`

## 配对码规则

6 位配对码按常见家庭局域网 `/24` 网段设计：

- 前 3 位：目标设备 IP 的最后一段，例如 `192.168.31.086` 会写成 `086`
- 后 3 位：本次配对会话的校验码
- 输入 6 位码后，连接端会使用自己当前网段前缀去拼出目标地址，并连接固定监听端口
- 连接建立后，客户端会把后 3 位校验码发给目标设备，只有校验通过才算配对成功

例子：

- 电脑 IP：`192.168.31.86`
- 配对码：`086314`
- 手机在同一 Wi-Fi 下输入 `086314`
- 手机会尝试连接 `192.168.31.86:49372`
- 电脑校验 `314` 正确后建立 TCP 长连接

说明：

- 这个方案优先服务家庭和办公室里最常见的同网段环境
- 二维码仍然保留完整 `IP + 端口 + 设备标识 + 令牌` 信息，适合更稳妥的一键连接

## 桌面端实现说明

- 桌面端入口由 [package.json](package.json) 的 `main` 字段与脚本统一管理
- Electron 主进程位于 [electron/main.mjs](electron/main.mjs)
- TCP 服务与剪贴板同步位于 [electron/desktop-service.mjs](electron/desktop-service.mjs)
- 预加载桥位于 [electron/preload.mjs](electron/preload.mjs)

常用桌面端命令：

- 开发运行：`npm run dev:desktop`
- 仅前端调试：`npm run dev`
- 生产打包：`npm run build:desktop`

桌面端本地数据保存在：

- Windows: `%APPDATA%/ClipVault` 对应 Electron `userData`
- Linux: `~/.config/ClipVault` 对应 Electron `userData`

## Android 关键文件

- 主插件桥：[android/app/src/main/java/io/clipvault/app/ClipVaultNativePlugin.kt](android/app/src/main/java/io/clipvault/app/ClipVaultNativePlugin.kt)
- 同步运行时：[android/app/src/main/java/io/clipvault/app/ClipVaultRuntime.kt](android/app/src/main/java/io/clipvault/app/ClipVaultRuntime.kt)
- 前台服务：[android/app/src/main/java/io/clipvault/app/ClipVaultSyncService.kt](android/app/src/main/java/io/clipvault/app/ClipVaultSyncService.kt)
- 开机广播：[android/app/src/main/java/io/clipvault/app/ClipVaultBootReceiver.kt](android/app/src/main/java/io/clipvault/app/ClipVaultBootReceiver.kt)
- 后台 watchdog 广播：[android/app/src/main/java/io/clipvault/app/ClipVaultWatchdogReceiver.kt](android/app/src/main/java/io/clipvault/app/ClipVaultWatchdogReceiver.kt)
- 周期巡检 worker：[android/app/src/main/java/io/clipvault/app/ClipVaultWatchdogWorker.kt](android/app/src/main/java/io/clipvault/app/ClipVaultWatchdogWorker.kt)
- ADB 自动回连与通知输入：[android/app/src/main/java/io/clipvault/app/AdvancedAdbManager.kt](android/app/src/main/java/io/clipvault/app/AdvancedAdbManager.kt)
- USB ADB TCP/IP 辅助脚本：[scripts/android-adb-tcpip.bat](scripts/android-adb-tcpip.bat)

## iOS 关键文件

- 原生桥与运行时：[ios/App/App/AppDelegate.swift](ios/App/App/AppDelegate.swift)

## React 共享界面

- 主页布局、历史记录、设备管理、设置页：[src/App.tsx](src/App.tsx)
- 风格样式：[src/index.css](src/index.css)
- 共享数据模型：[src/lib/models.ts](src/lib/models.ts)
- 平台桥接入口：[src/platform/bridge.ts](src/platform/bridge.ts)

## 已完成验证

- `npm run build`
- `npm run lint`
- `npm run sync:native`
- `android/gradlew.bat assembleDebug`
- `npm run build:desktop`
- `node --check electron/main.mjs`
- `node --check electron/desktop-service.mjs`
- `node --check electron/preload.mjs`

## 未完成的本机验证

- iOS 编译需要 macOS + Xcode，当前 Windows 环境无法直接执行

## 许可证

ClipVault 使用 [MIT License](LICENSE) 开源。
