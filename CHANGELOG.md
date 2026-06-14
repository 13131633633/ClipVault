# 更新日志 / Changelog

## v1.2.0 - 2026-06-14

### 中文

- 新增：首次扫码或输入 6 位配对码连接成功后，会自动保存该设备。
- 新增：重新打开 Windows 端或 Android 端时，会自动连接上一次成功连接的设备。
- 新增：如果上次设备暂时没有打开，ClipVault 会在后台安静重试，不再只尝试一次。
- 新增：连接握手时双方会交换自己的配对信息，手机扫电脑后，电脑也能在下次启动时主动连回手机。
- 修复：Windows 免安装单文件 EXE 无法打开或闪退的问题。
- 调整：Windows 打包现在同时生成安装版和真正的 portable 单文件。
- 调整：README 下载入口统一指向 Releases 页面，避免写死具体附件名导致旧链接失效。

### English

- Added remembered devices after the first successful QR-code or six-digit pairing-code connection.
- Added automatic reconnect to the last successfully connected device when Windows or Android starts again.
- Added quiet background retry when the last device is not available yet.
- Added bidirectional pairing metadata exchange during handshake, so both sides can reconnect later.
- Fixed the Windows portable single-file EXE crash caused by missing Electron runtime resources.
- Updated Windows packaging to produce both installer and true portable single-file builds.
- Updated README download links to point to the Releases page instead of fixed asset filenames.

## v1.0.0 - 2026-06-14

### 中文

- 首个开源发布版本。
- 支持 Windows 桌面端与 Android 客户端。
- 支持局域网二维码配对、6 位配对码连接、文本同步、PNG 图片同步、本地历史记录和设备管理。
- 支持 Android 高级后台同步、无线调试配对和 USB ADB TCP/IP 辅助方案。

### English

- First open-source release.
- Added Windows desktop and Android clients.
- Added LAN QR-code pairing, six-digit pairing-code connection, text sync, PNG image sync, local history, and device management.
- Added Android Advanced Background Sync with Wireless debugging pairing and USB ADB TCP/IP helper.
