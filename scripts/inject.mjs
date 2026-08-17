#!/usr/bin/env node
/**
 * XUL Agent Tools — one-click injector for the dsh web profile.
 *
 * Replaces the manual junction + patch steps so a partner can onboard in one command:
 *   1. symlinks the plugin into $DSH_HOME/profiles/node_modules/@xul-chain/dsh-agent-tools
 *   2. writes / merges the cordis.patch.yml that mounts the plugin into the web profile
 *
 * Cross-platform: Windows uses a directory junction, POSIX uses a symlink.
 * No external dependencies — Node builtins only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, readlinkSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(__dirname, '..') // packages/xul/tool-xul-chain-status
const packageName = '@xul-chain/dsh-agent-tools'
const pluginId = 'xul-agent-tools'

const dshHome = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const nmDir = join(dshHome, 'profiles', 'node_modules')
const scopeDir = join(nmDir, '@xul-chain')
const linkPath = join(scopeDir, 'dsh-agent-tools')
const webDir = join(dshHome, 'profiles', 'web')
const patchPath = join(webDir, 'cordis.patch.yml')

const PATCH_BLOCK = `- insert:
    - id: ${pluginId}
      name: '${packageName}'
      config:
        rpcUrl: 'https://scan.xulchain.com/rpc'
        chainId: 12310
        # consensusRpcUrl: 'http://your-beacon-node:3500'   # 仅 xul_validators 需要；XUL eth RPC 不暴露验证人
`

function isLinkStale(p) {
  if (!existsSync(p)) return true
  try {
    return readlinkSync(p) !== pluginDir
  } catch {
    // exists but is a real directory/file (not a symlink) — treat as stale
    return true
  }
}

function makeLink() {
  mkdirSync(scopeDir, { recursive: true })
  if (existsSync(linkPath)) {
    if (!isLinkStale(linkPath)) {
      console.log(`• link already correct: ${linkPath}`)
      return
    }
    rmSync(linkPath, { recursive: true, force: true })
  }
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(pluginDir, linkPath, type)
  console.log(`✓ linked ${packageName} -> ${pluginDir} (${type})`)
}

function writePatch() {
  mkdirSync(webDir, { recursive: true })
  if (existsSync(patchPath)) {
    const cur = readFileSync(patchPath, 'utf8')
    if (cur.includes(pluginId)) {
      console.log(`• patch already has ${pluginId}, skipped`)
      return
    }
    const sep = cur.endsWith('\n') ? '' : '\n'
    writeFileSync(patchPath, cur + sep + PATCH_BLOCK, 'utf8')
    console.log(`✓ appended ${pluginId} to existing ${patchPath}`)
    return
  }
  writeFileSync(patchPath, PATCH_BLOCK, 'utf8')
  console.log(`✓ wrote ${patchPath}`)
}

console.log('XUL Agent Tools injector')
console.log(`  DSH_HOME = ${dshHome}`)
console.log(`  plugin   = ${pluginDir}`)
console.log('')
makeLink()
writePatch()
console.log('')
console.log('Done. Now run:')
console.log('  pnpm run dsh web      (from the deepseek-harness monorepo)')
console.log('  or: npx @deepseek-ai/dsh web')
console.log('Open http://127.0.0.1:3080 — the xul_* tools will be available.')
