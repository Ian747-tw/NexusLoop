import { spawn } from 'child_process';

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'deny_non_negotiable'; rule_id: string; reason: string }
  | { kind: 'ask'; verb: string; payload: unknown }
  | { kind: 'narrow'; narrowed_args: Record<string, unknown>; reason: string };

export class PolicyClient {
  private python: ReturnType<typeof spawn> | null = null;
  private pending = new Map<string, (d: PolicyDecision) => void>();
  private timeoutMs = 5000;

  start(): void {
    const python = spawn('python', ['-m', 'nxl_core.policy.server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.python = python;
    python.stdout.on('data', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        resolve(msg.decision);
        this.pending.delete(msg.id);
      }
    });
  }

  async check(req: { id: string; name: string; args: Record<string, unknown> }): Promise<PolicyDecision> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new Error('policy check timeout'));
      }, this.timeoutMs);
      const python = this.python;
      if (!python) {
        clearTimeout(timer);
        reject(new Error('policy client not started'));
        return;
      }
      this.pending.set(req.id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
      python.stdin!.write(JSON.stringify(req) + '\n');
    });
  }

  stop(): void {
    this.python?.kill();
    this.python = null;
  }
}
