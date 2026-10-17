/* eslint-disable no-console */
import {
  TAP_GATE_IDLE,
  tapGateClear,
  tapGateOwnsClick,
  tapGatePress,
  tapGateRelease,
  type TapGate,
} from "@/lib/tapGate";

let bad = 0;
const ok = (msg: string) => console.log(`ok: ${msg}`);
const fail = (msg: string) => {
  bad += 1;
  console.log(`FAIL: ${msg}`);
};
const expect = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

const tap = (isTap = true): TapGate => tapGateRelease(tapGatePress(), isTap);
const click = (gate: TapGate, detail = 1): { allowed: boolean; gate: TapGate } => tapGateOwnsClick(gate, detail);

{
  const done = tap();
  expect(click(done).allowed, "the completing tap's own click writes");

  const stray = click(TAP_GATE_IDLE);
  expect(!stray.allowed, "a click with no tap of its own on the control is refused");
  expect(stray.gate.armed === false, "…and it leaves the control idle");

  expect(click(tap(stray.gate)).allowed, "a real tap on that control still writes");
}

{
  const first = click(tap());
  expect(first.allowed, "a tap writes once");
  expect(!click(first.gate).allowed, "a second click cannot reuse that tap");
}

{
  expect(!click(tap(false)).allowed, "the click trailing a grab or drag is refused");
}

{
  expect(click(TAP_GATE_IDLE, 0).allowed, "a pointerless activation (detail 0) is honored");
  expect(click(tapGatePress(), 0).allowed, "…even while a pointer gesture is in flight");
}

{
  expect(!click(tapGatePress()).allowed, "a click while the pointer is still down is refused");
  expect(!click(tapGateRelease(TAP_GATE_IDLE, true)).allowed, "a release with no press here is refused");
  expect(!click(tapGateClear()).allowed, "a cancelled gesture writes nothing");
}

{
  tap();
  expect(!click(tapGatePress(), 1).allowed, "a stale arm is dropped by the next pointerdown");
  const armed = tap();
  const kb = click(armed, 0);
  expect(kb.allowed && kb.gate.armed === true, "a pointerless activation does not spend the arm");
  expect(click(kb.gate).allowed, "…so the tap's own click still writes after it");
}

console.log(bad === 0 ? "tap gate: rule checks passed" : `tap gate: ${bad} check(s) FAILED`);
if (bad > 0) process.exit(1);
