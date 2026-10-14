export const MODULE_ID = "cyberpunk-red-container-module";
const TYPES = new Set(["gear", "weapon", "ammo", "armor", "clothing", "drug", "cyberware", "cyberdeck", "program", "itemUpgrade", "vehicle", "netarch"]);
const CARRYALL = "Compendium.cyberpunk-red-core.core_gear.Item.y2a4HDhIl7FlJyD7";
export const flagsOf = (item) => item.flags?.[MODULE_ID] ?? {};
export const canStore = (item) => TYPES.has(item.type) && !item.system?.core && (item.type === "ammo" || !item.system?.isInstalled);

export function isContainer(item) {
  if (item.type !== "gear") return false;
  const enabled = flagsOf(item).container;
  if (typeof enabled === "boolean") return enabled;
  const source = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  return source === CARRYALL || source === CARRYALL.replace(".Item.", ".") ||
    ["carryall", "дорожная сумка"].includes(item.name?.trim().toLowerCase());
}

// All links are actor-local. Broken links and cycles fall back to ordinary inventory.
export function indexInventory(items) {
  const byId = new Map(Array.from(items, (item) => [item.id, item]));
  // CPR's isInstalled getter scans the whole actor; build this lookup once per render.
  const installed = new Set();
  for (const item of byId.values()) {
    for (const id of item.system?.installedItems?.list ?? []) installed.add(id);
  }
  const actor = byId.values().next().value?.parent;
  for (const id of actor?.system?.installedItems?.list ?? []) installed.add(id);
  const storable = (item) => TYPES.has(item.type) && !item.system?.core && (item.type === "ammo" || !installed.has(item.id));
  const containers = new Map([...byId].filter(([, item]) => isContainer(item) && storable(item)));
  const parents = new Map();
  for (const item of byId.values()) {
    const parent = flagsOf(item).parent;
    if (storable(item) && containers.has(parent) && parent !== item.id) parents.set(item.id, parent);
  }
  const done = new Set();
  for (const id of parents.keys()) {
    const path = new Set();
    let current = id;
    while (parents.has(current) && !done.has(current) && !path.has(current)) {
      path.add(current);
      current = parents.get(current);
    }
    if (path.has(current)) for (const node of path) parents.delete(node);
    for (const node of path) done.add(node);
  }
  const children = new Map();
  for (const [id, parent] of parents) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(byId.get(id));
  }
  return { byId, containers, parents, children };
}

export function descendants(index, id) {
  const result = [];
  const pending = [...(index.children.get(id) ?? [])];
  while (pending.length) {
    const item = pending.pop();
    result.push(item);
    pending.push(...(index.children.get(item.id) ?? []));
  }
  return result;
}

export async function putInContainer(actor, item, parentId = null) {
  if (isBusy(actor)) throw new Error("busy");
  if (!actor.isOwner || item.parent?.uuid !== actor.uuid || !canStore(item)) throw new Error("permission");
  const index = indexInventory(actor.items);
  if (parentId && (!index.containers.has(parentId) || parentId === item.id ||
    descendants(index, item.id).some((child) => child.id === parentId))) throw new Error("cycle");
  return item.update({ [`flags.${MODULE_ID}.parent`]: parentId });
}

export function planTransfer(source, root, parentId, randomID) {
  const index = indexInventory(source.items);
  const direct = [root, ...descendants(index, root.id)];
  const selected = new Map(direct.map((item) => [item.id, item]));
  const remove = new Set(selected.keys());
  const pending = [...direct];
  while (pending.length) {
    const item = pending.pop();
    for (const id of item.system?.installedItems?.list ?? []) {
      if (selected.has(id)) continue;
      const child = source.items.get(id);
      if (!child) throw new Error("brokenInstallation");
      selected.set(id, child);
      if (child.type !== "ammo" || child.system.amount === 0) remove.add(id);
      pending.push(child);
    }
  }
  // Shared loaded-ammo stacks may stay behind; other shared installations must be detached first.
  for (const item of source.items) {
    if (remove.has(item.id)) continue;
    if ((item.system?.installedItems?.list ?? []).some((id) => remove.has(id))) throw new Error("sharedInstallation");
  }
  const ids = new Map([...selected.keys()].map((id) => [id, randomID()]));
  const data = [...selected.values()].map((item) => {
    const copy = item.toObject();
    copy._id = ids.get(item.id);
    copy.flags ??= {};
    copy.flags[MODULE_ID] = { ...flagsOf(item), parent: item.id === root.id ? parentId : ids.get(index.parents.get(item.id)) ?? null };
    delete copy.flags.cprInstallTree;
    if (copy.flags["cyberpunk-red-core"]) delete copy.flags["cyberpunk-red-core"].cprInstallTree;
    if (copy.system.installedItems) copy.system.installedItems.list = copy.system.installedItems.list.map((id) => ids.get(id));
    if (item.type === "ammo" && !remove.has(item.id)) copy.system.amount = 0;
    for (const effect of copy.effects ?? []) delete effect._id;
    return copy;
  });
  return { data, remove: [...remove], selected: [...selected.values()], ids };
}

const busy = new Set();
export const isBusy = (actor) => busy.has(actor.uuid);

export async function transferContainer(source, target, root, parentId = null) {
  if (!source.isOwner || !target.isOwner || !["character", "mook"].includes(source.type) ||
    !["character", "mook"].includes(target.type) || source.uuid === target.uuid ||
    source.items.get(root.id) !== root || !canStore(root)) throw new Error("permission");
  if (isBusy(source) || isBusy(target)) throw new Error("busy");
  if (parentId && !indexInventory(target.items).containers.has(parentId)) throw new Error("cycle");
  busy.add(source.uuid);
  busy.add(target.uuid);
  let plan;
  let snapshots;
  const removed = new Set();
  let deleteHook;
  try {
    plan = planTransfer(source, root, parentId, () => foundry.utils.randomID());
    snapshots = new Map(plan.selected.map((item) => [item.id, item.toObject()]));
    const origins = new Map(plan.selected.map((item) => [item.uuid, `${target.uuid}.Item.${plan.ids.get(item.id)}`]));
    for (const data of plan.data) {
      for (const effect of data.effects ?? []) {
        if (origins.has(effect.origin)) effect.origin = origins.get(effect.origin);
      }
    }
    // Bypass CPR stacking and recursive installation creation: this batch already includes both.
    await target.createEmbeddedDocuments("Item", plan.data, { keepId: true, cprIsMigrating: true });
    if (!plan.data.every((data) => target.items.has(data._id))) throw new Error("incomplete");
    for (const [id, snapshot] of snapshots) {
      if (JSON.stringify(source.items.get(id)?.toObject()) !== JSON.stringify(snapshot)) throw new Error("changed");
    }
    const operationId = foundry.utils.randomID();
    deleteHook = Hooks.on("deleteItem", (item, options) => {
      if (item.parent?.uuid === source.uuid && options[MODULE_ID] === operationId) removed.add(item.id);
    });
    const deleted = await source.deleteEmbeddedDocuments("Item", plan.remove, { cprIsMigrating: true, [MODULE_ID]: operationId });
    for (const item of deleted) removed.add(item.id);
    if (removed.size !== plan.remove.length || plan.remove.some((id) => source.items.has(id))) throw new Error("incomplete");
    return target.items.get(plan.ids.get(root.id));
  } catch (error) {
    if (plan && snapshots) {
      // Restore any partially deleted source before removing the destination copies.
      const missing = [...removed].filter((id) => !source.items.has(id));
      if (missing.length) {
        try {
          await source.createEmbeddedDocuments("Item", missing.map((id) => snapshots.get(id)), { keepId: true, cprIsMigrating: true });
        } catch (cause) { throw new Error("recovery", { cause }); }
        if (missing.some((id) => !source.items.has(id))) throw new Error("recovery");
      }
      const copies = plan.data.map((data) => data._id).filter((id) => target.items.has(id));
      if (copies.length) {
        try { await target.deleteEmbeddedDocuments("Item", copies, { cprIsMigrating: true }); }
        catch (cause) { throw new Error("recovery", { cause }); }
      }
      if (copies.some((id) => target.items.has(id))) throw new Error("recovery");
    }
    throw error;
  } finally {
    if (deleteHook !== undefined) Hooks.off("deleteItem", deleteHook);
    busy.delete(source.uuid);
    busy.delete(target.uuid);
  }
}
