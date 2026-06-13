# ClipVault TCP Protocol

## Framing

每一条消息都使用统一的二进制帧：

```text
4-byte big-endian length + UTF-8 JSON payload
```

## Message Types

### `hello`

客户端向桌面端发起握手：

```json
{
  "type": "hello",
  "token": "pairing-token",
  "device": {
    "id": "device-uuid",
    "name": "Pixel 9 Pro",
    "platform": "android",
    "role": "mobile"
  }
}
```

### `welcome`

桌面端握手成功后返回：

```json
{
  "type": "welcome",
  "server": {
    "id": "desktop-device-id",
    "name": "Office-PC",
    "platform": "windows"
  },
  "peers": []
}
```

### `clipboard_update`

任意一端产生新的剪贴板内容后广播：

```json
{
  "type": "clipboard_update",
  "routeId": "relay-route-id",
  "entry": {
    "id": "entry-id",
    "mimeType": "text/plain",
    "preview": "Hello ClipVault",
    "text": "Hello ClipVault",
    "imageBase64": null,
    "createdAt": 1781260800000,
    "sourceDeviceId": "source-device-id",
    "sourceDeviceName": "Office-PC",
    "sha256": "payload-sha256",
    "direction": "outbound"
  }
}
```

## Pairing Payload

二维码中保存的是纯 JSON：

```json
{
  "version": 1,
  "host": "192.168.1.12",
  "port": 49372,
  "serverId": "desktop-server-id",
  "serverName": "Office-PC",
  "token": "pairing-token",
  "issuedAt": 1781260800000
}
```

## Routing Rules

- Windows / Linux 是 TCP 服务端。
- Android / iOS 是 TCP 客户端。
- 手机连接多台电脑时，会把收到的远端更新继续转发到其它已连接电脑。
- 所有端都维护 `routeId` 去重，避免循环广播。

## Clipboard Payload Rules

- 文本使用 `mimeType = text/plain`
- 图片使用 `mimeType = image/png`
- 图片内容用 `imageBase64`
- 去重依赖 `sha256`

## Persistence

- 每个端都本地持久化 `history` 和 `settings`
- 历史记录按时间逆序展示
- 超出 `historyLimit` 时删除最旧记录
