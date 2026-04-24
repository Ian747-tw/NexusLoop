import { spawn } from 'child_process';
import type {
  CapsuleRequest,
  CapsuleResponse,
  CompactRequest,
  CompactResponse,
} from '../../bridge/protocol';

/**
 * requestCapsule
 * IPC to Python side: POST CapsuleRequest, receive CapsuleResponse.
 * The Python side routes to nxl_core.capsule.get_prefix (cycle start).
 */
export async function requestCapsule(req: CapsuleRequest): Promise<CapsuleResponse> {
  const response = await _ipcCall('capsule', req);
  return response as CapsuleResponse;
}

/**
 * requestCompact
 * IPC to Python side: POST CompactRequest, receive CompactResponse.
 * The Python side routes to nxl_core.capsule.compact.{soft_trim, hard_regen, clear_handoff}.
 */
export async function requestCompact(req: CompactRequest): Promise<CompactResponse> {
  const response = await _ipcCall('compact', req);
  return response as CompactResponse;
}

/**
 * _ipcCall — internal IPC helper.
 * Uses stdio JSON-lines like policy-client but a different message channel.
 */
async function _ipcCall(
  action: 'capsule' | 'compact',
  payload: object
): Promise<object> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-m', 'nxl_core.capsule.server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdoutData = '';
    child.stdout!.on('data', (data: Buffer) => {
      stdoutData += data.toString();
    });
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdoutData.trim()));
      } catch {
        reject(new Error(`IPC ${action} parse error`));
      }
    });
    child.on('error', reject);
    child.stdin!.write(JSON.stringify({ action, ...payload }) + '\n');
    child.stdin!.end();
  });
}
