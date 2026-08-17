# XUL Agent Tools

> **`@xul-chain/dsh-agent-tools`** —— 把 XUL Chain（Chain ID 12310 / 0x3016，EVM 兼容）的链上读写能力，封装成 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的 model-facing agent tools。
> 让 AI 代理能用自然语言**读链上状态、广播已签名交易**，是 "AI 原生公链" 对外最底层的 agent 接入骨架。

> ⚠️ **资产与许可**：本包归属 XUL Chain 私有资产（license: UNLICENSED），发布到**私有 npm**（access: restricted），不进公开仓库。任何对外开源需老板显式授权。

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

## 一、合作伙伴一键接入（推荐）

本包随附 **一键注入脚本**，自动完成"挂进 dsh profile"的全部手工步骤（建 junction + 写 patch）：

```sh
# 在 deepseek-harness monorepo 根目录
pnpm install
pnpm run build                 # 构建整库（含本插件）

# 一键把插件挂进你的 dsh web profile
node packages/xul/tool-xul-chain-status/scripts/inject.mjs

# 启动带 XUL 工具的 dsh Web UI
pnpm run dsh web
# 浏览器开 http://127.0.0.1:3080 —— 新建会话即可在 tool 列表看到 xul_* 工具
```

脚本行为：
- 把插件以 junction（Windows）/ symlink（macOS/Linux）链入 `$DSH_HOME/profiles/node_modules/@xul-chain/dsh-agent-tools`
- 写入或合并 `$DSH_HOME/profiles/web/cordis.patch.yml`（插入 `xul-agent-tools` 挂载项）
- `$DSH_HOME` 默认 `~/.dsh`，可用环境变量覆盖

---

## 二、手动接入（等价步骤）

```sh
# 1) 链入 profile 的 node_modules
#    Windows (PowerShell):
#      New-Item -ItemType Junction -Path "$env:USERPROFILE/.dsh/profiles/node_modules/@xul-chain/dsh-agent-tools" -Target (Resolve-Path packages/xul/tool-xul-chain-status)
#    macOS/Linux:
#      mkdir -p ~/.dsh/profiles/node_modules/@xul-chain
#      ln -s "$(pwd)/packages/xul/tool-xul-chain-status" ~/.dsh/profiles/node_modules/@xul-chain/dsh-agent-tools

# 2) 挂载 patch（复制 patches/xul-agent-tools.patch.yml 到 profile）
mkdir -p "$DSH_HOME/profiles/web"
cp packages/xul/tool-xul-chain-status/patches/xul-agent-tools.patch.yml "$DSH_HOME/profiles/web/cordis.patch.yml"

# 3) 启动
pnpm run dsh web
```

也可不复制、启动时临时指定：
```sh
npx @deepseek-ai/dsh web --patch ./packages/xul/tool-xul-chain-status/patches/xul-agent-tools.patch.yml
```

---

## 三、配置 RPC / Chain ID

优先级（从高到低）：**env 变量 `XUL_RPC_URL`** > **patch 里的 `rpcUrl`** > **代码默认 `https://scan.xulchain.com/rpc`**。

patch 示例：
```yaml
- insert:
    - id: xul-agent-tools
      name: '@xul-chain/dsh-agent-tools'
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

- 本插件**不访问私钥、不签名**；`xul_send_raw_transaction` 只广播**已签名**交易（调用方须自己先签好）。
- 适合：agent 在执行链上操作前**验证环境**（chain id、余额、nonce）；在 dsh 会话里把**链上状态**作为模型上下文；广播交易（agent 产出已签名 raw tx → 调本工具上链，签名器 / AA Paymaster 由上游提供）。
- 它是 XUL 三个 AI 面（xul-ai 对话网关 / Agent Hub / 本插件）中**唯一真正能做链上读/广播**的 agent 层，定位为 **XUL Agent 接入底座**。

## 六、本地开发说明

本代码运行在 **deepseek-harness monorepo** 内（非独立 npm 包）。要编译它，本包目录须位于你机器克隆的 monorepo 内。已登记进 `tsconfig.host.json` 的 `references`，故 `build:lib` 会一并编译。

```sh
git clone --depth 1 https://github.com/wfnw2j4j8w-design/xul-chain-canonical.git
cd deepseek-harness   # 或你的 monorepo 根
pnpm install
pnpm run build
node packages/xul/tool-xul-chain-status/scripts/inject.mjs
pnpm run dsh web
```
