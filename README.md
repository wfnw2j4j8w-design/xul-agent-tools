# XUL Agent Tools

> **`xul-dsh-agent-tools`** —— 把 XUL Chain（Chain ID 12310 / 0x3016，EVM 兼容）的链上读写能力，封装成可被 AI agent / dsh 直接调用的工具集。让 AI 代理用自然语言**读链上状态、广播已签名交易**，是 "AI 原生公链" 对外最底层的 agent 接入骨架。

> 📦 **开源许可**：本包以 **MIT 协议**开源（版权归 XUL Chain）。任何人可免费使用、修改、分发。
>
> 🧭 **XUL 开源边界**：本工具是**通用链上开发者工具**（连 XUL 链的扳手，行业通用范式），故开源以利生态；XUL 的**护城河核心**（链底层代码、Go AI 网关、经济模型、未公开战略）仍为私有资产，不公开。

---

## 它能做什么（9 个 `xul_*` 工具）

| tool | 用途 |
|---|---|
| `xul_chain_status` | 查链状态：blockNumber / gasPrice / chainId |
| `xul_get_balance` | 查地址原生 XUL 余额（wei + XUL 双单位） |
| `xul_get_transaction_count` | 查地址 nonce |
| `xul_estimate_gas` | 估算一笔交易的 gas |
| `xul_call_contract` | 通用 `eth_call`，读任意合约原始数据 |
| `xul_erc20_balance` | 读 ERC-20 余额（自动 `balanceOf` + `decimals`） |
| `xul_get_block` | 取区块元数据 |
| `xul_validators` | 读验证人集合（Beacon/consensus REST，需配 `consensusRpcUrl`） |
| `xul_send_raw_transaction` | 广播**已签名**交易（`eth_sendRawTransaction`） |

实现上全部走标准 `eth_*` JSON-RPC over `fetch`，**零外部链 SDK 依赖**。

> ⚠️ **`xul_validators` 的坑**：XUL 的 eth JSON-RPC（`scan.xulchain.com/rpc`）**不暴露** `validators`。XUL 是 Berachain fork（beacon-kit），验证人要走**你的 beacon 节点 REST**（通常另一端口，如 `http://host:3500`）。所以 `xul_validators` 需要你在 patch 里显式填 `consensusRpcUrl`，否则会报错提示。

---

## 一、获取与作为 SDK 使用（任意项目，脱离 dsh 亦可）

> 📥 **当前获取主渠道：GitHub 直装**（本包暂未上架 npmjs.org 官方源——因 npm Organization 订阅过期、官方源发布暂缓；仓已 PUBLIC，`lib/` 随仓提交，装即用，无需 npmjs 账号）。

作为 npm 依赖安装（自动拉取公开仓）：
```sh
npm install github:wfnw2j4j8w-design/xul-agent-tools
```

或克隆源码：
```sh
git clone https://github.com/wfnw2j4j8w-design/xul-agent-tools.git
cd xul-agent-tools
```

核心工具定义可直接 import：
```ts
import { tools } from 'xul-dsh-agent-tools'
// tools = 9 个 xul_* 工具的注册描述，可被任意 agent 框架（LangChain / 自研 / dsh）消费
```

工具内部通过标准 `eth_*` JSON-RPC 通信，**零外部链 SDK 依赖**。

---

## 二、挂入 dsh（获得模型调度 + 对话 UI）

如果你用 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)，可一键把本工具挂进 dsh 的 web profile：

```sh
# 方式 A（推荐）：已用 npm 装到项目 node_modules（见「一」）
cd node_modules/xul-dsh-agent-tools
node scripts/inject.mjs

# 方式 B：克隆源码
git clone https://github.com/wfnw2j4j8w-design/xul-agent-tools.git
cd xul-agent-tools
pnpm run build                 # 编译 lib/

# 启动带 XUL 工具的 dsh Web UI
pnpm run dsh web
# 浏览器开 http://127.0.0.1:3080 —— 新建会话即可在 tool 列表看到 xul_* 工具
```

脚本行为：
- 把插件以 junction（Windows）/ symlink（macOS/Linux）链入 `$DSH_HOME/profiles/node_modules/xul-dsh-agent-tools`
- 写入或合并 `$DSH_HOME/profiles/web/cordis.patch.yml`（插入 `xul-agent-tools` 挂载项）
- `$DSH_HOME` 默认 `~/.dsh`，可用环境变量覆盖

### 手动等价步骤

```sh
# 1) 链入 profile 的 node_modules
#    Windows (PowerShell):
#      New-Item -ItemType Junction -Path "$env:USERPROFILE/.dsh/profiles/node_modules/xul-dsh-agent-tools" -Target (Resolve-Path .)
#    macOS/Linux:
#      mkdir -p ~/.dsh/profiles/node_modules
#      ln -s "$(pwd)" ~/.dsh/profiles/node_modules/xul-dsh-agent-tools

# 2) 挂载 patch
mkdir -p "$DSH_HOME/profiles/web"
cp patches/xul-agent-tools.patch.yml "$DSH_HOME/profiles/web/cordis.patch.yml"

# 3) 启动
pnpm run dsh web
```

也可不复制、启动时临时指定：
```sh
npx @deepseek-ai/dsh web --patch ./patches/xul-agent-tools.patch.yml
```

---

## 三、配置 RPC / Chain ID

优先级（从高到低）：**env 变量 `XUL_RPC_URL`** > **patch 里的 `rpcUrl`** > **代码默认 `https://scan.xulchain.com/rpc`**。

patch 示例：
```yaml
- insert:
    - id: xul-agent-tools
      name: 'xul-dsh-agent-tools'
      config:
        rpcUrl: 'https://scan.xulchain.com/rpc'   # 文档指定公共 RPC
        chainId: 12310
        # consensusRpcUrl: 'http://your-beacon-node:3500'   # 仅 xul_validators 需要
```

> 当前（2026-08-17）公共 RPC `scan.xulchain.com/rpc` 偶发 502，属节点侧问题；开发者侧代码已对齐到该端点，节点恢复后即可直连。

---

## 四、写更多 XUL tool 的契约

本插件严格遵循 dsh 官方 cookbook：

1. `parameters` 决定模型所见 schema；`defineTool` 在 `execute` 前完成参数校验。
2. `execute(args, exec)` 必须 honor `exec.signal`（传入 `fetch` 的 `signal`）。
3. `output.schema` 是规范的 JSON 返回值；`output.render` 只负责模型可见文本。
4. `presentCall` 必须是 `args` 的纯函数（用于流式 UI + session log replay，禁止 I/O）。
5. 注册走 `ctx.tools.register(...)`，插件卸载自动反注册（Cordis effect 机制）。
6. 新增工具：在 `src/index.ts` 的 `apply()` 里再加一个 `ctx.tools.register(defineTool({...}))`，然后 `pnpm run build` + 重新注入。

---

## 五、与 XUL 生态的关系

- 本工具**不访问私钥、不签名**；`xul_send_raw_transaction` 只广播**已签名**交易（调用方须自己先签好）。
- 适合：agent 在执行链上操作前**验证环境**（chain id、余额、nonce）；在 agent 会话里把**链上状态**作为模型上下文；广播交易（agent 产出已签名 raw tx → 调本工具上链，签名器 / AA Paymaster 由上游提供）。
- 对外定位为 **XUL 开发者 SDK**：既可作为 dsh 插件挂入 agent 运行时，也可作为独立 npm 模块被任意项目 `import` 调用。是 XUL 三个 AI 面（xul-ai 对话网关 / Agent Hub / 本工具）中**唯一真正能做链上读/广播**的 agent 层。

---

## 六、安全与免责

- 本工具仅做链上**读**与**已签名交易广播**，绝不接触私钥。
- 链上操作不可逆，使用前请充分测试；本工具按 MIT 协议提供，**不提供担保**。
- 发现漏洞请在仓库 Issues 反馈。

---

© 2026 XUL Chain. 保留 MIT 下的所有权利。
