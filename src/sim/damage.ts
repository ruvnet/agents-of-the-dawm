/** Bounded, explainable player damage. Assist halves damage; never changes story state. */
import type { Ctx } from './ctx';
import { RULES, emit } from './ctx';

export function damagePlayer(c: Ctx, amount: number, source: string): void {
  const p = c.s.player;
  if (p.invulnerableTicks > 0 || p.health <= 0) return;
  const dealt = c.s.assist.halfDamage ? Math.ceil(amount / 2) : amount;
  p.health = Math.max(0, p.health - dealt);
  p.invulnerableTicks = RULES.invulnerableTicks;
  emit(c, 'PlayerDamaged', source, { amount: dealt, health: p.health });
}
