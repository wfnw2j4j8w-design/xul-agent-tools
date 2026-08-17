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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "xul-agent-tools";
export declare const inject: string[];
/** Deployment configuration for the XUL Chain tool pack. */
export interface Config {
    /** JSON-RPC endpoint of an XUL Chain full node. Default: https://scan.xulchain.com/rpc (XUL public RPC, per docs.html). Can be overridden at runtime via the XUL_RPC_URL env var. */
    rpcUrl?: string;
    /** Chain ID to advertise to the model and validate responses. Default: 12310 (XUL Chain, 0x3016). */
    chainId?: number;
    /** Beacon/consensus REST base for reading the validator set (BeaconKit: /eth/v1). XUL's eth JSON-RPC does NOT expose validators, so this must point at the beacon node REST (e.g. http://host:3500). If unset, derived as `${rpcUrl}/../eth/v1` and will error until corrected. */
    consensusRpcUrl?: string;
}
/** Default XUL Chain RPC endpoint — the documented public RPC (Scan explorer endpoint, Chain ID 12310 / 0x3016). Override with the XUL_RPC_URL env var or the `rpcUrl` config. */
export declare const DEFAULT_RPC_URL = "https://scan.xulchain.com/rpc";
/** Schemastery configuration exposed to deployments and patch files. */
export declare const Config: z<Schemastery.ObjectS<{
    rpcUrl: z<string, string>;
    chainId: z<number, number>;
    consensusRpcUrl: z<string, string>;
}>, Schemastery.ObjectT<{
    rpcUrl: z<string, string>;
    chainId: z<number, number>;
    consensusRpcUrl: z<string, string>;
}>>;
/**
 * Register all XUL Chain tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's RPC endpoint and chain identity.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map