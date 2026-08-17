/**
 * XUL Chain tools — model-facing dsh plugin for EVM-compatible XUL Chain operations.
 *
 * Provides the canonical dsh tool-authoring contract:
 *  - register through `ctx.tools.register(defineTool(...))` (effect-based, auto-disposes)
 *  - `parameters` drives the schema the model sees; `defineTool` validates args before execute
 *  - `execute(args, exec)` honors `exec.signal` and returns one canonical JSON value
 *  - `output.render` owns model-facing prose; `presentCall` is a pure function of args
 *
 * Tools exposed:
 *  - xul_chain_status          blockNumber / gasPrice / chainId
 *  - xul_get_balance           native XUL balance
 *  - xul_get_transaction_count address nonce
 *  - xul_estimate_gas          gas estimation for a tx
 *  - xul_call_contract         generic eth_call
 *  - xul_erc20_balance         ERC-20 balanceOf + decimals
 *  - xul_get_block             block metadata
 *  - xul_validators           active validator set (Beacon/consensus REST)
 *  - xul_send_raw_transaction broadcast a signed tx (eth_sendRawTransaction)
 *
 * @module @xul-chain/dsh-agent-tools
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'xul-agent-tools';
export const inject = ['tools'];
/** Default XUL Chain RPC endpoint — the documented public RPC (Scan explorer endpoint, Chain ID 12310 / 0x3016). Override with the XUL_RPC_URL env var or the `rpcUrl` config. */
export const DEFAULT_RPC_URL = 'https://scan.xulchain.com/rpc';
/** Schemastery configuration exposed to deployments and patch files. */
export const Config = z.object({
    rpcUrl: z.string().role('url').default(DEFAULT_RPC_URL),
    chainId: z.number().default(12310),
    consensusRpcUrl: z.string().role('url').default(''),
});
/** Runtime hex / bigint helpers. */
const isHex = (s) => typeof s === 'string' && s.startsWith('0x');
const hexToBigInt = (hex) => {
    if (typeof hex === 'bigint')
        return hex;
    if (typeof hex === 'number')
        return BigInt(hex);
    if (isHex(hex))
        return BigInt(hex);
    throw new Error(`expected hex quantity, got ${JSON.stringify(hex)}`);
};
const hexToDec = (hex) => hexToBigInt(hex).toString(10);
const weiToXul = (wei) => {
    const value = typeof wei === 'bigint' ? wei : hexToBigInt(wei);
    const divisor = 10n ** 18n;
    const int = value / divisor;
    const frac = value % divisor;
    const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
    return fracStr ? `${int}.${fracStr}` : int.toString();
};
const strip0x = (hex) => hex.toLowerCase().startsWith('0x') ? hex.slice(2) : hex;
const pad32 = (hex) => strip0x(hex).padStart(64, '0');
/** Known ERC-20 function selectors. No external crypto dependency. */
const ERC20_SELECTORS = {
    balanceOf: '0x70a08231',
    decimals: '0x313ce567',
    symbol: '0x95d89b41',
    totalSupply: '0x18160ddd',
};
/** Minimal JSON-RPC client with batch-friendly single calls and abort support. */
class RpcClient {
    url;
    chainId;
    constructor(url, chainId) {
        this.url = url;
        this.chainId = chainId;
    }
    async call(method, params, signal) {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal,
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (!res.ok)
            throw new Error(`XUL RPC HTTP ${res.status} from ${this.url}`);
        const body = (await res.json());
        if (body.error) {
            throw new Error(`XUL RPC error ${body.error.code ?? 'N/A'}: ${body.error.message}`);
        }
        return body.result;
    }
    async assertChainId(signal) {
        const id = await this.call('eth_chainId', [], signal);
        const reported = Number(hexToBigInt(id));
        if (reported !== this.chainId) {
            throw new Error(`XUL chain ID mismatch: configured ${this.chainId} (0x${this.chainId.toString(16)}), node reported ${reported} (0x${reported.toString(16)})`);
        }
    }
}
/** Model-facing description fragments. */
const CHAIN_HINT = 'XUL Chain (Chain ID configurable, default 12310)';
/**
 * Register all XUL Chain tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's RPC endpoint and chain identity.
 */
export function apply(ctx, config) {
    const rpcUrl = config.rpcUrl ?? process.env.XUL_RPC_URL ?? DEFAULT_RPC_URL;
    const chainId = config.chainId ?? 12310;
    const rpc = new RpcClient(rpcUrl, chainId);
    const consensusRpcUrl = (config.consensusRpcUrl
        || rpcUrl.replace(/\/rpc$/, '').replace(/\/$/, '') + '/eth/v1');
    ctx.tools.register(defineTool({
        name: 'xul_chain_status',
        description: `Query live status of ${CHAIN_HINT}: latest block number, gas price, and chain id. Use before on-chain actions to confirm the node is reachable and on the expected chain.`,
        parameters: {
            fields: {
                type: 'array',
                description: "Which fields to return. Omit or pass ['all'] for everything. Allowed: 'blockNumber' | 'gasPrice' | 'chainId'.",
                items: {
                    type: 'string',
                    enum: ['all', 'blockNumber', 'gasPrice', 'chainId'],
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    chainId: { type: 'string', required: true },
                    blockNumber: { type: 'string', required: true },
                    gasPriceWei: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `XUL Chain ${value.chainId}: block #${value.blockNumber}, gasPrice ${value.gasPriceWei} wei`,
                }],
        },
        async execute(args, exec) {
            const want = new Set(args.fields?.length ? args.fields : ['all']);
            const needAll = want.has('all');
            const calls = [];
            if (needAll || want.has('blockNumber'))
                calls.push(['blockNumber', 'eth_blockNumber', []]);
            if (needAll || want.has('gasPrice'))
                calls.push(['gasPrice', 'eth_gasPrice', []]);
            if (needAll || want.has('chainId'))
                calls.push(['chainId', 'eth_chainId', []]);
            const raw = await Promise.all(calls.map(([, method, params]) => rpc.call(method, params, exec.signal)));
            return {
                chainId: hexToDec(raw[calls.findIndex(c => c[1] === 'eth_chainId')]),
                blockNumber: hexToDec(raw[calls.findIndex(c => c[1] === 'eth_blockNumber')]),
                gasPriceWei: hexToDec(raw[calls.findIndex(c => c[1] === 'eth_gasPrice')]),
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Query XUL Chain status',
            kind: 'search',
            rawInput: args.fields ?? ['all'],
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_get_balance',
        description: `Get the native XUL balance of an EVM address on ${CHAIN_HINT}. Returns both wei and XUL-denominated values.`,
        parameters: {
            address: {
                type: 'string',
                required: true,
                description: 'EVM address to query (0x...).',
            },
            blockTag: {
                type: 'string',
                description: "Block tag or hex number. Default: 'latest'.",
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    address: { type: 'string', required: true },
                    blockTag: { type: 'string', required: true },
                    balanceWei: { type: 'string', required: true },
                    balanceXul: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${value.address} holds ${value.balanceXul} XUL (${value.balanceWei} wei) at ${value.blockTag}.`,
                }],
        },
        async execute(args, exec) {
            const blockTag = args.blockTag ?? 'latest';
            const balance = await rpc.call('eth_getBalance', [args.address, blockTag], exec.signal);
            return {
                address: args.address,
                blockTag,
                balanceWei: hexToDec(balance),
                balanceXul: weiToXul(balance),
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Get XUL balance',
            kind: 'search',
            rawInput: args.address,
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_get_transaction_count',
        description: `Get the transaction count (nonce) of an EVM address on ${CHAIN_HINT}.`,
        parameters: {
            address: {
                type: 'string',
                required: true,
                description: 'EVM address to query (0x...).',
            },
            blockTag: {
                type: 'string',
                description: "Block tag or hex number. Default: 'latest'.",
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    address: { type: 'string', required: true },
                    blockTag: { type: 'string', required: true },
                    nonce: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${value.address} nonce: ${value.nonce} at ${value.blockTag}.`,
                }],
        },
        async execute(args, exec) {
            const blockTag = args.blockTag ?? 'latest';
            const count = await rpc.call('eth_getTransactionCount', [args.address, blockTag], exec.signal);
            return {
                address: args.address,
                blockTag,
                nonce: hexToDec(count),
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Get transaction count',
            kind: 'search',
            rawInput: args.address,
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_estimate_gas',
        description: `Estimate gas for a transaction on ${CHAIN_HINT}. Does not submit the transaction.`,
        parameters: {
            to: {
                type: 'string',
                required: true,
                description: 'Destination EVM address (0x...).',
            },
            from: {
                type: 'string',
                description: 'Sender EVM address (optional but often required by nodes).',
            },
            value: {
                type: 'string',
                description: 'Value to send in wei as decimal string or 0x hex. Default: 0.',
            },
            data: {
                type: 'string',
                description: 'Transaction data as 0x hex (for contract interactions).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    gasEstimate: { type: 'string', required: true },
                    gasEstimateDecimal: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Estimated gas: ${value.gasEstimateDecimal} units (${value.gasEstimate}).`,
                }],
        },
        async execute(args, exec) {
            const tx = { to: args.to };
            if (args.from)
                tx.from = args.from;
            if (args.value)
                tx.value = isHex(args.value) ? args.value : `0x${BigInt(args.value).toString(16)}`;
            if (args.data)
                tx.data = args.data;
            const estimate = await rpc.call('eth_estimateGas', [tx], exec.signal);
            return {
                gasEstimate: estimate,
                gasEstimateDecimal: hexToDec(estimate),
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Estimate gas',
            kind: 'search',
            rawInput: { to: args.to, value: args.value, hasData: !!args.data },
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_call_contract',
        description: `Call a contract on ${CHAIN_HINT} with eth_call. Use for reading raw storage or calling view functions for which no dedicated tool exists.`,
        parameters: {
            to: {
                type: 'string',
                required: true,
                description: 'Contract address (0x...).',
            },
            data: {
                type: 'string',
                required: true,
                description: 'Call data as 0x hex (4-byte selector + encoded args).',
            },
            blockTag: {
                type: 'string',
                description: "Block tag or hex number. Default: 'latest'.",
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    to: { type: 'string', required: true },
                    data: { type: 'string', required: true },
                    result: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `eth_call to ${value.to} returned ${value.result}.`,
                }],
        },
        async execute(args, exec) {
            const blockTag = args.blockTag ?? 'latest';
            const result = await rpc.call('eth_call', [{ to: args.to, data: args.data }, blockTag], exec.signal);
            return {
                to: args.to,
                data: args.data,
                result: result,
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Call contract',
            kind: 'search',
            rawInput: { to: args.to, selector: args.data.slice(0, 10) },
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_erc20_balance',
        description: `Read an ERC-20 token balance on ${CHAIN_HINT}. Calls balanceOf(address) and optionally decimals() to return both raw and human-readable amounts.`,
        parameters: {
            tokenAddress: {
                type: 'string',
                required: true,
                description: 'ERC-20 token contract address (0x...).',
            },
            holderAddress: {
                type: 'string',
                required: true,
                description: 'Address holding the tokens (0x...).',
            },
            withDecimals: {
                type: 'boolean',
                description: 'Also query decimals() to format the balance. Default: true.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    tokenAddress: { type: 'string', required: true },
                    holderAddress: { type: 'string', required: true },
                    balanceRaw: { type: 'string', required: true },
                    balanceFormatted: { type: 'string', required: true },
                    decimals: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${value.holderAddress} holds ${value.balanceFormatted} of token ${value.tokenAddress} (decimals: ${value.decimals}, raw: ${value.balanceRaw}).`,
                }],
        },
        async execute(args, exec) {
            const balanceData = `${ERC20_SELECTORS.balanceOf}${pad32(args.holderAddress)}`;
            const [balanceHex, decimalsHex] = await Promise.all([
                rpc.call('eth_call', [{ to: args.tokenAddress, data: balanceData }, 'latest'], exec.signal),
                (args.withDecimals ?? true)
                    ? rpc.call('eth_call', [{ to: args.tokenAddress, data: ERC20_SELECTORS.decimals }, 'latest'], exec.signal).catch(() => '0x12')
                    : Promise.resolve('0x12'),
            ]);
            const decimals = Number(hexToBigInt(decimalsHex));
            const raw = hexToBigInt(balanceHex);
            const divisor = 10n ** BigInt(decimals);
            const int = raw / divisor;
            const frac = raw % divisor;
            const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
            const formatted = fracStr ? `${int}.${fracStr}` : int.toString();
            return {
                tokenAddress: args.tokenAddress,
                holderAddress: args.holderAddress,
                balanceRaw: raw.toString(10),
                balanceFormatted: formatted,
                decimals,
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Get ERC-20 balance',
            kind: 'search',
            rawInput: { token: args.tokenAddress, holder: args.holderAddress },
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_get_block',
        description: `Fetch metadata of a block on ${CHAIN_HINT} by tag or number. Does not include full transaction payloads unless requested.`,
        parameters: {
            blockTag: {
                type: 'string',
                description: "Block tag ('latest' | 'earliest' | 'pending') or hex number. Default: 'latest'.",
            },
            includeTransactions: {
                type: 'boolean',
                description: 'Whether to include full transaction objects (not just hashes). Default: false.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    number: { type: 'string', required: true },
                    hash: { type: 'string', required: true },
                    timestamp: { type: 'string', required: true },
                    gasLimit: { type: 'string', required: true },
                    gasUsed: { type: 'string', required: true },
                    txCount: { type: 'integer', required: true },
                    parentHash: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Block #${value.number} (${value.hash}): ${value.txCount} txs, gas ${value.gasUsed}/${value.gasLimit}, timestamp ${value.timestamp}.`,
                }],
        },
        async execute(args, exec) {
            const blockTag = args.blockTag ?? 'latest';
            const fullTx = args.includeTransactions ?? false;
            const block = (await rpc.call('eth_getBlockByNumber', [blockTag, fullTx], exec.signal));
            if (!block)
                throw new Error(`block ${blockTag} not found`);
            return {
                number: hexToDec(block.number ?? '0x0'),
                hash: block.hash ?? '0x',
                timestamp: hexToDec(block.timestamp ?? '0x0'),
                gasLimit: hexToDec(block.gasLimit ?? '0x0'),
                gasUsed: hexToDec(block.gasUsed ?? '0x0'),
                txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
                parentHash: block.parentHash ?? '0x',
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Get XUL block',
            kind: 'search',
            rawInput: args.blockTag ?? 'latest',
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_validators',
        description: `Read the active validator set of ${CHAIN_HINT} from the Beacon/consensus REST API (BeaconKit: /eth/v1/beacon/states/head/validators). The XUL eth JSON-RPC endpoint (scan.xulchain.com/rpc) does NOT expose validators, so this requires a consensusRpcUrl pointing at the beacon node REST (e.g. http://host:3500). Returns validator count, indices, pubkeys, balances and statuses.`,
        parameters: {
            stateId: {
                type: 'string',
                description: "Beacon state id. Default: 'head'.",
            },
            status: {
                type: 'string',
                description: "Filter by validator status (e.g. 'active', 'pending', 'exited'). Default: all.",
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    endpoint: { type: 'string', required: true },
                    count: { type: 'integer', required: true },
                    validators: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `${value.count} validators @ ${value.endpoint}: ${value.validators.slice(0, 3).join(', ')}${value.count > 3 ? ' …' : ''}`,
                }],
        },
        async execute(args, exec) {
            const stateId = args.stateId ?? 'head';
            const url = `${consensusRpcUrl}/beacon/states/${encodeURIComponent(stateId)}/validators`;
            const res = await fetch(url, { method: 'GET', signal: exec.signal, headers: { accept: 'application/json' } });
            if (!res.ok) {
                throw new Error(`XUL validators HTTP ${res.status} from ${url}. The XUL eth JSON-RPC (scan.xulchain.com/rpc) does not expose validators — set consensusRpcUrl to your beacon node REST (e.g. http://host:3500).`);
            }
            const body = (await res.json());
            const all = body.data ?? [];
            const filtered = args.status ? all.filter(v => v.status === args.status) : all;
            return {
                endpoint: url,
                count: filtered.length,
                validators: filtered.map(v => `${v.index}:${v.validator.pubkey.slice(0, 12)}… (${v.status})`),
            };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Read XUL validators',
            kind: 'search',
            rawInput: args.stateId ?? 'head',
        }),
    }));
    ctx.tools.register(defineTool({
        name: 'xul_send_raw_transaction',
        description: `Broadcast a signed transaction to ${CHAIN_HINT} via eth_sendRawTransaction. Takes a fully-signed raw tx hex (0x...). Returns the tx hash. Does NOT sign anything — the caller must supply a signed transaction.`,
        parameters: {
            rawTransaction: {
                type: 'string',
                required: true,
                description: 'Fully-signed transaction as 0x hex (RLP-encoded).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    txHash: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Broadcasted tx ${value.txHash}. Track it on the XUL explorer.`,
                }],
        },
        async execute(args, exec) {
            const txHash = await rpc.call('eth_sendRawTransaction', [args.rawTransaction], exec.signal);
            return { txHash: txHash };
        },
        presentCall: args => ({
            card: 'generic',
            title: 'Broadcast signed XUL tx',
            kind: 'execute',
            rawInput: `${args.rawTransaction.slice(0, 18)}… (${args.rawTransaction.length - 2} bytes)`,
        }),
    }));
}
//# sourceMappingURL=index.js.map