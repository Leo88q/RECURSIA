// CI guard against drift between the hand-written SDK and the Anchor IDL
// (checklist #26): same discriminators, account counts and signer/writable flags.
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { DEFAULT_PARAMS, RecursiaIx } from "../src/index.js";

const idl = JSON.parse(readFileSync(process.argv[2], "utf8"));
const x = new RecursiaIx(new PublicKey(idl.address));
const k = () => Keypair.generate().publicKey;
const a = k(), b = k(), c = k();
const built: Record<string, TransactionInstruction> = {
  initialize: x.initialize(a, b, DEFAULT_PARAMS),
  fund_reward_pool: x.fundRewardPool(a, 1n),
  fund_sponsor_pool: x.fundSponsorPool(a, 1n),
  season_submit: x.seasonSubmit(a),
  claim_season_prize: x.claimSeasonPrize(a, 0),
  tournament_join: x.tournamentJoin(a, 1n, 0),
  tournament_submit: x.tournamentSubmit(a, 1n, 0),
  tournament_settle: x.tournamentSettle(1n, 0),
  claim_tournament_prize: x.claimTournamentPrize(a, 1n, 0, 0),
  propose: x.propose(a, { kind: "SetAdmin", admin: b }),
  cancel: x.cancel(a),
  execute: x.execute(a, 1n, b),
  set_pause: x.setPause(a, true),
  advance_epoch: x.advanceEpoch(),
  register_module: x.registerModule(a, 0n, 8, 12, 100, "Life"),
  claim_module_royalties: x.claimModuleRoyalties(a, b),
  create_root_world: x.createRootWorld(a, 0n, b, 0, "W", 0n).ix,
  create_child_world: x.createChildWorld(a, b, 1, c, 0, "W", 0n).ix,
  fund_world: x.fundWorld(a, b, 1n),
  tick: x.tick(a, b, c, k()),
  claim_world_epoch: x.claimWorldEpoch(a),
  breach: x.breach(a, b),
  claim_architect: x.claimArchitect(a, b),
  acquire: x.acquire(a, b, 1, c, 1n, 1n, 1n),
  set_price: x.setPrice(a, b, 1, 1n),
  top_up: x.topUp(a, b, 1, 1n),
  withdraw_deposit: x.withdrawDeposit(a, b, 1, 1n),
  collect: x.collect(a, b, 1),
  plant: x.plant(a, b, 1, 1n),
  settle: x.settle(a, 1, b),
  withdraw: x.withdraw(a, 1n),
  start_rebellion: x.startRebellion(a, b, 1),
  vote_rebellion: x.voteRebellion(a, b, 1),
  execute_rebellion: x.executeRebellion(a, b, c),
  create_permit: x.createPermit(a, b, 3, c, 1n, 1n, 1n),
  fund_permit: x.fundPermit(a, b, 1n),
  withdraw_permit: x.withdrawPermit(a, b, 1n),
  revoke_permit: x.revokePermit(a, b),
  agent_plant: x.agentPlant(a, b, c, 1, 1n),
  agent_acquire: x.agentAcquire(a, b, c, 1, k(), 1n, 1n, 1n),
  quantum_commit: x.quantumCommit(a, b, 1, new Uint8Array(32).fill(1), { world: c, index: 2 }),
  quantum_observe: x.quantumObserve(a, b, 1, k()),
  quantum_collapse: x.quantumCollapse(a, b, 1, 1n, 2n, 5_000, new Uint8Array(32), { world: c, index: 2 }),
  quantum_decohere: x.quantumDecohere(a, b, 1, c),
  create_neutral_world: x.createNeutralWorld(a, 0n, b, "N", 0n).ix,
  swap_offer: x.swapOffer(a, b, 1, 2, 5_000, 1n),
  swap_accept: x.swapAccept(a, b, 1, 2),
  swap_resolve: x.swapResolve(a, b, 1, 2, c, k(), k()),
  swap_cancel: x.swapCancel(a, b, 1, 2, c),
};

/** Byte size of an IDL type when it is fixed-size (null = variable / unknown). */
function fixedSize(t: unknown): number | null {
  const prim: Record<string, number> = { u8: 1, i8: 1, bool: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };
  if (typeof t === "string") return prim[t] ?? null;
  const o = t as { array?: [unknown, number] };
  if (o && Array.isArray(o.array)) { const e = fixedSize(o.array[0]); return e === null ? null : e * o.array[1]; }
  return null;
}

let errors = 0;
const fail = (m: string) => { errors++; console.error("✗", m); };
for (const ix of idl.instructions) {
  const mine = built[ix.name];
  if (!mine) { fail(`SDK missing instruction ${ix.name}`); continue; }
  const disc = Buffer.from(mine.data.subarray(0, 8)).toString("hex");
  if (disc !== Buffer.from(ix.discriminator).toString("hex")) fail(`${ix.name}: discriminator mismatch`);
  const sizes = (ix.args ?? []).map((x: { type: unknown }) => fixedSize(x.type));
  if (sizes.every((v: number | null) => v !== null)) {
    const want = sizes.reduce((acc: number, v: number) => acc + v, 0);
    if (mine.data.length - 8 !== want) fail(`${ix.name}: args are ${mine.data.length - 8} bytes, IDL expects ${want}`);
  }
  if (ix.accounts.length !== mine.keys.length) { fail(`${ix.name}: ${mine.keys.length} accounts, IDL has ${ix.accounts.length}`); continue; }
  ix.accounts.forEach((acc: { name: string; writable?: boolean; signer?: boolean; optional?: boolean }, i: number) => {
    const m = mine.keys[i];
    if (!!acc.signer !== m.isSigner) fail(`${ix.name}.${acc.name}: signer flag mismatch`);
    // optional accounts passed as None are read-only program id — only check when present
    if (!!acc.writable !== m.isWritable && !(acc.optional && m.pubkey.equals(x.programId))) fail(`${ix.name}.${acc.name}: writable flag mismatch (idl=${!!acc.writable})`);
  });
}
for (const name of Object.keys(built)) if (!idl.instructions.find((i: { name: string }) => i.name === name)) fail(`IDL missing ${name}`);
if (errors) process.exit(1);
console.log(`IDL check OK: ${idl.instructions.length} instructions match the SDK`);
