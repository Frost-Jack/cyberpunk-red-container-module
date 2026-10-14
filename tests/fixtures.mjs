import { MODULE_ID } from "../scripts/containers.js";

export class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
}

export class FakeItem {
  constructor(data, actor = null) {
    this.data = structuredClone(data);
    this.parent = actor;
    this.sheet = { render() {} };
  }
  get id() { return this.data._id; }
  get uuid() { return `${this.parent?.uuid ?? ""}.Item.${this.id}`; }
  get name() { return this.data.name; }
  get type() { return this.data.type; }
  get system() { return this.data.system; }
  get flags() { return this.data.flags; }
  get _stats() { return this.data._stats; }
  toObject() { return structuredClone(this.data); }
  async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
  async update(changes) {
    for (const [path, value] of Object.entries(changes)) {
      const keys = path.split(".");
      let target = this.data;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = value;
    }
    return this;
  }
}

export class FakeActor {
  constructor(id, data = []) {
    this.uuid = `Actor.${id}`;
    this.type = "character";
    this.documentName = "Actor";
    this.isOwner = true;
    this.system = {};
    this.items = new Collection(data.map((raw) => [raw._id, new FakeItem(raw, this)]));
    this.calls = [];
  }
  async createEmbeddedDocuments(type, data, options) {
    this.calls.push({ action: "create", options, count: data.length });
    if (this.beforeCreate) await this.beforeCreate(data);
    const docs = data.slice(0, this.createLimit ?? data.length).map((raw) => new FakeItem(raw, this));
    for (const doc of docs) this.items.set(doc.id, doc);
    return docs;
  }
  async deleteEmbeddedDocuments(type, ids, options) {
    this.calls.push({ action: "delete", options, count: ids.length });
    if (this.beforeDelete) await this.beforeDelete(ids);
    const deleted = [];
    for (const id of ids.slice(0, this.deleteLimit ?? ids.length)) {
      const item = this.items.get(id);
      if (!item) continue;
      deleted.push(item);
      this.items.delete(id);
      globalThis.Hooks.callAll("deleteItem", item, options);
      if (this.throwAfterDelete === deleted.length) throw new Error("connection");
    }
    return deleted;
  }
  async updateEmbeddedDocuments(type, updates) {
    for (const { _id, ...data } of updates) await this.items.get(_id).update(data);
  }
}

export class FakeUser {
  constructor(id) { this.id = id; this.flags = {}; }
  can() { return true; }
  getFlag(scope, key) {
    return key.split(".").reduce((value, part) => value?.[part], this.flags[scope]);
  }
  async setFlag(scope, key, value) {
    let target = this.flags[scope] ??= {};
    const parts = key.split(".");
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    target[parts.at(-1)] = value;
    globalThis.Hooks.callAll("updateUser", this, { flags: { [scope]: this.flags[scope] } });
  }
}

export function raw(id, type = "gear", parent = null, container = false, system = {}) {
  return { _id: id, name: id, type, flags: { [MODULE_ID]: { parent, container } }, system: { amount: 1, ...system } };
}
export function sample() {
  return new FakeActor("source", [
    raw("bag", "gear", null, true), raw("gun", "weapon", "bag", false, { installedItems: { list: ["upgrade", "loaded"] }, magazine: { value: 6, max: 10 } }),
    raw("upgrade", "itemUpgrade"), raw("loaded", "ammo", null, false, { amount: 0 }),
    raw("armor", "armor", "bag"), raw("ammo", "ammo", "bag", false, { amount: 40 }),
    raw("pouch", "gear", "bag", true), raw("drug", "drug", "pouch"), raw("outside", "gear")
  ]);
}

let sequence = 0;
globalThis.foundry = { utils: { randomID: () => `new${String(++sequence).padStart(13, "0")}` } };
const callbacks = new Map();
let hookId = 0;
globalThis.Hooks = {
  on(name, fn) { const id = ++hookId; callbacks.set(id, {name,fn}); return id; },
  off(name, id) { callbacks.delete(id); },
  callAll(name, ...args) { for (const hook of callbacks.values()) if (hook.name === name) hook.fn(...args); },
  get size() { return callbacks.size; }
};
