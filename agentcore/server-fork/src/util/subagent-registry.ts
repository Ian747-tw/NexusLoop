import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

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

export function loadRegistry(rootDir: string = process.cwd()): SubagentRegistry {
  if (_registry !== null) return _registry;
  const registryPath = path.join(rootDir, 'agentcore', 'subagents', 'registry.yaml');
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