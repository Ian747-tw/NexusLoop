import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // agentcore/server-fork/src/util/subagent-registry.ts
  // walk up: util -> src -> server-fork -> agentcore -> project root
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('project root not found (.git not located)');
}

const PROJECT_ROOT = findProjectRoot();

export interface SubagentConfig {
  description: string;
  isolated: boolean;
  purpose: string;
  [key: string]: unknown; // allows additional fields without breaking Record<string, SubagentConfig>
}

export interface SubagentRegistry {
  [name: string]: SubagentConfig;
}

let _registry: SubagentRegistry | null = null;

export function loadRegistry(): SubagentRegistry {
  if (_registry !== null) return _registry;
  const registryPath = path.join(PROJECT_ROOT, 'agentcore', 'subagents', 'registry.yaml');
  if (!fs.existsSync(registryPath)) {
    _registry = {};
    return _registry;
  }
  const raw = fs.readFileSync(registryPath, 'utf-8');
  _registry = parseYaml(raw) as SubagentRegistry;
  return _registry;
}

export function getConfig(subagentType: string): SubagentConfig | null {
  const reg = loadRegistry();
  return reg[subagentType] ?? null;
}

export function isIsolated(subagentType: string): boolean {
  const config = getConfig(subagentType);
  return config?.isolated === true;
}

export function isRegistered(subagentType: string): boolean {
  return getConfig(subagentType) !== null;
}

// Test helper
export function _resetForTesting(): void {
  _registry = null;
}