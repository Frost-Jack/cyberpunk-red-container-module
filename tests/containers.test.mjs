import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, isContainer, indexInventory, descendants, putInContainer, planTransfer, transferContainer, isBusy } from "../scripts/containers.js";
import { FakeActor, FakeItem, raw, sample } from "./fixtures.mjs";

test("Carryall recognition, translated source and explicit override", () => {
  for (const name of ["Carryall", "Дорожная сумка", " CARRYALL "]) {
    assert.equal(isContainer(new FakeItem({ name, type: "gear", system: {} })), true);
  }
  assert.equal(isContainer(new FakeItem({ name: "Renamed", type: "gear", _stats: { compendiumSource: "Compendium.cyberpunk-red-core.core_gear.Item.y2a4HDhIl7FlJyD7" } })), true);
  assert.equal(isContainer(new FakeItem({ ...raw("Carryall"), flags: { [MODULE_ID]: { container: false } } })), false);
  assert.equal(isContainer(new FakeItem({ name: "Carryall", type: "weapon" })), false);
});

test("mixed types, nested contents and orphan links", () => {
  const actor = sample();
  const index = indexInventory(actor.items);
  assert.deepEqual(new Set(descendants(index, "bag").map((item) => item.id)), new Set(["gun", "armor", "ammo", "pouch", "drug"]));
  actor.items.delete("bag");
  const orphaned = indexInventory(actor.items);
  assert.equal(orphaned.parents.has("gun"), false);
  assert.equal(orphaned.parents.get("drug"), "pouch");
});

test("cycles and invalid parents cannot hide items or hang traversal", () => {
  const actor = new FakeActor("cycles", [raw("a", "gear", "b", true), raw("b", "gear", "a", true), raw("x", "ammo", "a"), raw("orphan", "gear", "missing")]);
  const index = indexInventory(actor.items);
  assert.equal(index.parents.has("a"), false);
  assert.equal(index.parents.has("b"), false);
  assert.equal(index.parents.has("orphan"), false);
  assert.equal(descendants(index, "a").length, 1);
});

test("index does not call CPR's quadratic isInstalled getter", () => {
  const actor = sample();
  for (const item of actor.items) Object.defineProperty(item.system, "isInstalled", { get() { throw new Error("slow getter"); } });
  assert.equal(indexInventory(actor.items).parents.get("gun"), "bag");
});

test("put in, take out, cycle and permission checks", async () => {
  const actor = sample();
  await putInContainer(actor, actor.items.get("outside"), "bag");
  assert.equal(indexInventory(actor.items).parents.get("outside"), "bag");
  await assert.rejects(putInContainer(actor, actor.items.get("bag"), "pouch"), /cycle/);
  await putInContainer(actor, actor.items.get("outside"));
  assert.equal(indexInventory(actor.items).parents.has("outside"), false);
  actor.isOwner = false;
  await assert.rejects(putInContainer(actor, actor.items.get("outside"), "bag"), /permission/);
});

test("containers can be moved between containers with their whole nested tree intact", async () => {
  const actor = sample();
  const destination = new FakeItem(raw("destination", "gear", null, true), actor);
  actor.items.set(destination.id, destination);
  const pouch = actor.items.get("pouch");
  const drug = actor.items.get("drug");
  await putInContainer(actor, pouch, destination.id);
  let index = indexInventory(actor.items);
  assert.equal(index.parents.get(pouch.id), destination.id);
  assert.equal(index.parents.get(drug.id), pouch.id);
  assert.deepEqual(new Set(descendants(index, destination.id).map((item) => item.id)), new Set([pouch.id, drug.id]));
  await putInContainer(actor, pouch);
  index = indexInventory(actor.items);
  assert.equal(index.parents.has(pouch.id), false);
  assert.equal(index.parents.get(drug.id), pouch.id);
  assert.equal(actor.items.get(pouch.id), pouch);
  assert.equal(actor.items.get(drug.id), drug);
  assert.equal(actor.items.size, 10);
  assert.equal(actor.calls.length, 0);
});

test("three-level container nesting rejects self and ancestor drops without changing inventory", async () => {
  const actor = sample();
  const inner = new FakeItem(raw("inner", "gear", "pouch", true), actor);
  actor.items.set(inner.id, inner);
  const before = [...actor.items].map((item) => item.toObject());
  await assert.rejects(putInContainer(actor, actor.items.get("bag"), inner.id), /cycle/);
  await assert.rejects(putInContainer(actor, actor.items.get("pouch"), inner.id), /cycle/);
  await assert.rejects(putInContainer(actor, inner, inner.id), /cycle/);
  assert.deepEqual([...actor.items].map((item) => item.toObject()), before);
});

test("whole transfer preserves types, amounts, nesting, installations and magazine", async () => {
  const source = sample();
  const target = new FakeActor("target", [raw("existingAmmo", "ammo", null, false, { amount: 9 })]);
  source.items.get("gun").data.effects = [{ _id: "effect", origin: source.items.get("upgrade").uuid }];
  const bag = await transferContainer(source, target, source.items.get("bag"));
  assert.deepEqual([...source.items.keys()], ["outside"]);
  assert.equal(target.items.size, 9);
  assert.equal(bag.type, "gear");
  const gun = [...target.items].find((item) => item.name === "gun");
  assert.equal(gun.system.magazine.value, 6);
  assert.equal(gun.system.installedItems.list.length, 2);
  assert.ok(gun.system.installedItems.list.every((id) => target.items.has(id)));
  const index = indexInventory(target.items);
  assert.equal(index.parents.get(gun.id), bag.id);
  const pouch = [...target.items].find((item) => item.name === "pouch");
  const drug = [...target.items].find((item) => item.name === "drug");
  assert.equal(index.parents.get(drug.id), pouch.id);
  assert.equal([...target.items].find((item) => item.name === "ammo").system.amount, 40);
  assert.equal(target.items.get("existingAmmo").system.amount, 9);
  assert.equal(gun.data.effects[0].origin, [...target.items].find((item) => item.name === "upgrade").uuid);
  assert.equal(source.calls.length, 1);
  assert.equal(target.calls.length, 1);
  assert.equal(target.calls[0].options.cprIsMigrating, true);
  assert.equal(isBusy(source), false);
});

test("shared nonzero loaded ammo stays at source and copied ammo has zero reserve", async () => {
  const source = sample();
  source.items.get("loaded").system.amount = 30;
  const target = new FakeActor("target");
  await transferContainer(source, target, source.items.get("bag"));
  assert.equal(source.items.get("loaded").system.amount, 30);
  assert.equal([...target.items].find((item) => item.name === "loaded").system.amount, 0);
});

test("shared installation across container boundary is rejected before writing", async () => {
  const source = sample();
  source.items.get("outside").system.installedItems = { list: ["ammo"] };
  const target = new FakeActor("target");
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /sharedInstallation/);
  assert.equal(source.items.size, 9);
  assert.equal(target.calls.length, 0);
});

test("missing installed item is rejected without any writes", async () => {
  const source = sample();
  source.items.delete("upgrade");
  const target = new FakeActor("target");
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /brokenInstallation/);
  assert.equal(target.items.size, 0);
});

test("partial destination creation rolls back without deleting source or existing target items", async () => {
  const source = sample();
  const target = new FakeActor("target", [raw("existing")]);
  target.createLimit = 3;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /incomplete/);
  assert.equal(source.items.size, 9);
  assert.deepEqual([...target.items.keys()], ["existing"]);
  assert.equal(isBusy(target), false);
});

test("partial source deletion restores source before cleaning destination", async () => {
  const source = sample();
  const before = [...source.items].map((item) => item.toObject()).sort((a, b) => a._id.localeCompare(b._id));
  const target = new FakeActor("target");
  source.deleteLimit = 2;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /incomplete/);
  assert.deepEqual([...source.items].map((item) => item.toObject()).sort((a, b) => a._id.localeCompare(b._id)), before);
  assert.equal(target.items.size, 0);
});

test("destination copies are retained when source restoration fails", async () => {
  const source = sample();
  const target = new FakeActor("target");
  source.deleteLimit = 2;
  source.createLimit = 0;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /recovery/);
  assert.equal(target.items.size, 8);
  assert.equal(isBusy(source), false);
});

test("concurrent changes cancel transfer and retain new source values", async () => {
  const source = sample();
  const target = new FakeActor("target");
  target.beforeCreate = async () => { source.items.get("ammo").system.amount = 39; };
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /changed/);
  assert.equal(source.items.get("ammo").system.amount, 39);
  assert.equal(target.items.size, 0);
});

test("another local transfer is blocked while one is pending", async () => {
  const source = sample();
  const target = new FakeActor("target");
  let release;
  target.beforeCreate = () => new Promise((resolve) => { release = resolve; });
  const first = transferContainer(source, target, source.items.get("bag"));
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /busy/);
  await assert.rejects(putInContainer(source, source.items.get("outside"), "bag"), /busy/);
  release();
  await first;
});

test("external deletion during creation is not resurrected by rollback", async () => {
  const source = sample();
  const target = new FakeActor("target");
  target.beforeCreate = async () => { source.items.delete("armor"); };
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /changed/);
  assert.equal(source.items.has("armor"), false);
  assert.equal(source.items.size, 8);
  assert.equal(target.items.size, 0);
});

test("exception after a partial create cleans up only the new destination documents", async () => {
  const source = sample();
  const target = new FakeActor("target", [raw("existing")]);
  target.beforeCreate = async (data) => {
    target.items.set(data[0]._id, new FakeItem(data[0], target));
    throw new Error("connection");
  };
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /connection/);
  assert.equal(source.items.size, 9);
  assert.deepEqual([...target.items.keys()], ["existing"]);
});

test("cleanup veto reports recovery instead of claiming rollback succeeded", async () => {
  const source = sample();
  const target = new FakeActor("target");
  target.createLimit = 2;
  target.deleteLimit = 0;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /recovery/);
  assert.equal(source.items.size, 9);
  assert.equal(target.items.size, 2);
});

test("partial deletion followed by an exception restores only this operation's deletions", async () => {
  const source = sample();
  const target = new FakeActor("target");
  source.throwAfterDelete = 2;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /connection/);
  assert.equal(source.items.size, 9);
  assert.equal(target.items.size, 0);
  assert.equal(Hooks.size, 0);
});

test("deletion by a different operation is not counted as successful delivery", async () => {
  const source = sample();
  const target = new FakeActor("target");
  source.beforeDelete = async (ids) => {
    // Simulate another client's transfer winning after our last snapshot check.
    for (const id of ids) source.items.delete(id);
  };
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /incomplete/);
  assert.equal(source.items.size, 1);
  assert.equal(target.items.size, 0);
  assert.equal(Hooks.size, 0);
});

test("ownership is required on both actors, including synthetic token actor identities", async () => {
  const source = sample();
  const target = new FakeActor("target");
  target.isOwner = false;
  await assert.rejects(transferContainer(source, target, source.items.get("bag")), /permission/);
  target.isOwner = true;
  target.uuid = "Scene.scene.Token.token.Actor.source";
  await transferContainer(source, target, source.items.get("bag"));
  assert.equal(source.items.size, 1);
});

test("module-off data remains native CPR items with every original type and quantity", () => {
  const source = sample();
  const before = [...source.items].map((item) => item.toObject());
  indexInventory(source.items);
  assert.deepEqual([...source.items].map((item) => item.toObject()), before);
  assert.deepEqual(before.filter((item) => item.flags[MODULE_ID].parent).map((item) => item.type).sort(), ["ammo", "armor", "drug", "gear", "weapon"]);
  assert.equal(before.find((item) => item._id === "ammo").system.amount, 40);
});

test("transfer into another container remaps root parent to the target inventory", async () => {
  const source = sample();
  const target = new FakeActor("target", [raw("targetBag", "gear", null, true)]);
  const bag = await transferContainer(source, target, source.items.get("bag"), "targetBag");
  assert.equal(indexInventory(target.items).parents.get(bag.id), "targetBag");
});

test("stale install-tree flags cannot spawn extra installed copies", () => {
  const source = sample();
  source.items.get("gun").flags.cprInstallTree = [raw("ghost")];
  const plan = planTransfer(source, source.items.get("bag"), null, foundry.utils.randomID);
  assert.equal(plan.data.find((item) => item.name === "gun").flags.cprInstallTree, undefined);
  assert.equal(plan.data.length, 8);
});
