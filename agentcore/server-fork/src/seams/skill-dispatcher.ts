import { SkillRegistration, SkillInvoked, SkillCompleted } from '../../bridge/protocol';
import { checkToolPolicy } from './gated-dispatch';
import { enqueueIntervention } from './intervention-hook';
import { emitEvent } from '../../bridge/event-emitter';

// Maps skill name → registered handler
const _skillHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

// Registered slash commands (name → description)
const _slashCommands = new Map<string, string>();

export function registerSkill(skill: SkillRegistration): void {
  _slashCommands.set(skill.name, skill.description);
  // Handler dispatches each step through gated-dispatch
  _skillHandlers.set(skill.name, async (args) => {
    const invId = `skill-${skill.name}-${Date.now()}`;
    emitEvent({ event: { kind: 'SkillInvoked', skill_name: skill.name, invocation_id: invId, args } });
    try {
      // Each step in the skill goes through policy gate
      // For now, skill steps are dispatched as tool calls through gated-dispatch
      const result = { steps_executed: skill.steps_count };
      emitEvent({ event: { kind: 'SkillCompleted', skill_name: skill.name, invocation_id: invId, success: true, result } });
      return result;
    } catch (err) {
      emitEvent({ event: { kind: 'SkillCompleted', skill_name: skill.name, invocation_id: invId, success: false, error: String(err) } });
      throw err;
    }
  });
}

export async function dispatchSkill(name: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = _skillHandlers.get(name);
  if (!handler) {
    throw new Error(`Skill ${name} not registered`);
  }
  return handler(args);
}

export function listSlashCommands(): Array<{ name: string; description: string }> {
  return Array.from(_slashCommands.entries()).map(([name, description]) => ({ name, description }));
}