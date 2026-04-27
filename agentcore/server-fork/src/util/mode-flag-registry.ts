/**
 * mode-flag-registry.ts — loads and queries the mode-flag registry.
 *
 * Mirrors the subagent-registry.ts pattern: YAML config file, cached load,
 * helpers for checking if a flag is registered and its default verdict.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  // agentcore/server-fork/src/util/mode-flag-registry.ts
  // walk up: util -> src -> server-fork -> agentcore -> project root
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('project root not found (.git not located)');
}

const PROJECT_ROOT = findProjectRoot();

export interface ModeFlagConfig {
  description: string;
  default_verdict: 'allow' | 'deny';
  [key: string]: unknown;
}

export interface ModeFlagRegistry {
  [flag_name: string]: ModeFlagConfig;
}

let _registry: ModeFlagRegistry | null = null;

export function loadRegistry(): ModeFlagRegistry {
  if (_registry !== null) return _registry;
  const registryPath = path.join(PROJECT_ROOT, 'agentcore', 'mode-flags', 'registry.yaml');
  if (!fs.existsSync(registryPath)) {
    _registry = {};
    return _registry;
  }
  const raw = fs.readFileSync(registryPath, 'utf-8');
  _registry = parseYaml(raw) as ModeFlagRegistry;
  return _registry;
}

export function getFlagConfig(flagName: string): ModeFlagConfig | null {
  const reg = loadRegistry();
  return reg[flagName] ?? null;
}

export function isRegisteredFlag(flagName: string): boolean {
  return getFlagConfig(flagName) !== null;
}

export function getDefaultVerdict(flagName: string): 'allow' | 'deny' | null {
  const config = getFlagConfig(flagName);
  return config?.default_verdict ?? null;
}

// Test helper
export function _resetForTesting(): void {
  _registry = null;
}
