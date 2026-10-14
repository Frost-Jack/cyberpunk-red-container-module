import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/containers.js";
import { getContainerPosition, registerPreferences } from "../scripts/preferences.js";
import { FakeUser } from "./fixtures.mjs";

test("position defaults to after Armor and ignores obsolete values", async () => {
  globalThis.game = { user: new FakeUser("player") };
  assert.equal(getContainerPosition(), "after:armor");
  await game.user.setFlag(MODULE_ID, "containerPosition", "invalid");
  assert.equal(getContainerPosition(), "after:armor");
});

test("positions belong to users rather than browsers or actor documents", async () => {
  const first = new FakeUser("first");
  const second = new FakeUser("second");
  globalThis.game = { user: first };
  await first.setFlag(MODULE_ID, "containerPosition", "after:gear");
  assert.equal(getContainerPosition(), "after:gear");
  game.user = second;
  assert.equal(getContainerPosition(), "after:armor");
  await second.setFlag(MODULE_ID, "containerPosition", "top");
  game.user = first;
  assert.equal(getContainerPosition(), "after:gear");
  const anotherClient = new FakeUser("first");
  anotherClient.flags = structuredClone(first.flags);
  game.user = anotherClient;
  assert.equal(getContainerPosition(), "after:gear");
});

test("menu is accessible to players and saves valid positions on the current user", async () => {
  let menu;
  globalThis.FormApplication = class { static get defaultOptions() { return {}; } };
  foundry.utils.mergeObject = (base, values) => ({ ...base, ...values });
  globalThis.game = {
    user: new FakeUser("player"),
    settings: { registerMenu(scope, key, value) { menu = value; } },
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${data.category}` },
  };
  globalThis.ui = { windows: {} };
  registerPreferences();
  assert.equal(menu.restricted, false);
  const form = new menu.type();
  assert.equal(form.getData().containerPosition, "after:armor");
  assert.equal(Object.keys(form.getData().positions).length, 14);
  assert.equal(menu.type.defaultOptions.template, `modules/${MODULE_ID}/templates/preferences.hbs`);
  await form._updateObject(null, { containerPosition: "bottom" });
  assert.equal(getContainerPosition(), "bottom");
  await assert.rejects(form._updateObject(null, { containerPosition: "wrong" }), /Invalid/);
  assert.equal(getContainerPosition(), "bottom");
});

test("only personal module preference updates refresh open actor sheets", async () => {
  let renders = 0;
  const actorWindow = { actor: {}, rendered: true, render() { renders++; } };
  const otherWindow = { rendered: true, render() { throw new Error("unrelated window"); } };
  ui.windows = { actorWindow, otherWindow };
  Hooks.callAll("updateUser", new FakeUser("different"), { flags: { [MODULE_ID]: {} } });
  Hooks.callAll("updateUser", game.user, { name: "Player" });
  assert.equal(renders, 0);
  await game.user.setFlag(MODULE_ID, "containerPosition", "top");
  assert.equal(renders, 1);
  ui.windows = {};
});

test("section collapse state is isolated by player and actor UUID", async () => {
  const first = new FakeUser("first");
  const second = new FakeUser("second");
  await first.setFlag(MODULE_ID, "collapsedSections.Actor-source", true);
  assert.equal(first.getFlag(MODULE_ID, "collapsedSections")["Actor-source"], true);
  assert.equal(first.getFlag(MODULE_ID, "collapsedSections")?.["Scene-scene-Token-token-Actor-source"], undefined);
  assert.equal(second.getFlag(MODULE_ID, "collapsedSections"), undefined);
});
