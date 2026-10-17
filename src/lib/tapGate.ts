export type TapGate = { down: boolean; armed: boolean };

export const TAP_GATE_IDLE: TapGate = { down: false, armed: false };

const TAP_GATE_PRESSED: TapGate = { down: true, armed: false };

export function tapGatePress(): TapGate {
  return TAP_GATE_PRESSED;
}

export function tapGateRelease(g: TapGate, isTap: boolean): TapGate {
  return { down: false, armed: isTap && g.down };
}

export function tapGateClear(): TapGate {
  return TAP_GATE_IDLE;
}

export function tapGateOwnsClick(g: TapGate, clickDetail: number): { allowed: boolean; gate: TapGate } {
  if (clickDetail === 0) return { allowed: true, gate: g };
  return g.armed ? { allowed: true, gate: TAP_GATE_IDLE } : { allowed: false, gate: g };
}
