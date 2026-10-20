# ZCode Remote (自建远控中继与网关)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

`zcode-remote` 是为 [ZCode](https://github.com/zai-org/ZCode) 打造的开源、轻量、自托管的 Web 远程控制中继（Relay）与网关服务。

它让开发者与自建用户可以完全脱离官方云端中继与官方账号体系，在自己的云服务器、NAS 或局域网内拥有属于自己的移动端远程控制服务。

---

## 特性亮点

* **协议 100% 原生兼容**：严格遵循 ZCode 官方远控协议规范（基于 HMAC-SHA256 挑战-应答和双向流式透传），无需修改桌面客户端源码即可接入。
* **数据主权与隐私保护**：采用零持久化原则，中继在内存中完成帧转发，**严禁将 RPC / 任务明文负载落盘**。
* **零维护者成本（开源友好）**：用户可在 1 分钟内通过 Docker Compose 自建，也可配合 Cloudflare 免费穿透，维护者无需承担全网用户的集中式服务器费用。
* **单一轻量进程**：纯 TypeScript 编写，单个 Node.js 进程同时提供 `/ws` 中继端点与 `/remote/v4` Web 静态资源托管，内存占用小于 20MB。
* **手机端页面跟随 ZCode 主线（当前 3.15.1）**：`/remote/v4` 由 ZCode 私有 fork 构建（V1 协议 + 同版本 Web 客户端），不需要账号登录，也不依赖 V2 的 `/api/v1/remote/*` 设备与令牌接口。3.16.1 的构建产物保留在 `public-3.16.1/` 备查。

---

## 架构简图

```
+---------------------+                      +---------------------+
|   ZCode Desktop     |                      |  手机移动浏览器     |
|   (PC 桌面端)       |                      |  (Web Terminal)     |
+----------+----------+                      +----------+----------+
           |                                            |
           | 1. 连接 & 注册 / 鉴权                      | 2. 扫码打开 /remote/v4
           v                                            v
    +-------------------------------------------------------+
    |                     zcode-remote                      |
    |                                                       |
    |  - 静态网关: 托管 /remote/v4 网页前端                |
    |  - WebSocket 中继 (/ws): HMAC 挑战应答 + 帧双向透传   |
    +-------------------------------------------------------+
```

---

## 文档目录

* [系统架构设计 (ARCHITECTURE.md)](docs/ARCHITECTURE.md)：连接拓扑、状态机生命周期、单终端排他控制与安全模型。
* [通信协议规范 (PROTOCOL.md)](docs/PROTOCOL.md)：消息帧格式、HMAC-SHA256 签名算法、测试证明向量与错误码字典。
* [客户端对接规范 (CLIENT_INTEGRATION.md)](docs/CLIENT_INTEGRATION.md)：桌面端环境变量覆盖方法与未来客户端 UI 设置演进设计。
* [Web 前端来源与更新 (WEB_FRONTEND.md)](docs/WEB_FRONTEND.md)：`public/` 里的手机端页面从哪来、怎么重新构建、有哪些坑。
* [自建与部署指南 (DEPLOYMENT.md)](docs/DEPLOYMENT.md)：Docker Compose 自动 HTTPS 部署、Node.js 运行与免费穿透配置。

---

## 快速上手 (开发模式)

```bash
# 1. 安装依赖
pnpm install

# 2. 运行测试
pnpm test

# 3. 启动开发服务
pnpm dev
```

---

## 开源许可

本项目遵循 [Apache-2.0 License](LICENSE)。
