import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

// Read selected implementations from the installed system without importing its runtime.
export async function loadNativeInventory(dataRoot, Handlebars, localize) {
  const exports = {};
  runInNewContext(process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"], { exports, module: { exports } });
  const parse = (source) => exports.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  function find(node, predicate) {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const value of Object.values(node)) {
      const found = Array.isArray(value) ? value.map((child) => find(child, predicate)).find(Boolean) : find(value, predicate);
      if (found) return found;
    }
    return undefined;
  }
  const root = join(dataRoot, "systems/cyberpunk-red-core/modules");
  const helpers = await readFile(join(root, "system/register-helpers.js"), "utf8");
  const registration = find(parse(helpers), (node) => node.type === "CallExpression" && node.callee?.property?.name === "registerHelper" && node.arguments[0]?.value === "cprNestedInstalledGearTab");
  assert.ok(registration, "Native installed-item helper must exist");
  const callback = registration.arguments[1];
  Handlebars.registerHelper("cprNestedInstalledGearTab", runInNewContext(`(${helpers.slice(callback.start, callback.end)})`, { Handlebars, SystemUtils: { Localize: localize }, game: { system: { id: "cyberpunk-red-core" } } }));
  async function methods(path, names) {
    const source = await readFile(join(root, path), "utf8");
    const ast = parse(source);
    return names.map((name) => {
      const method = find(ast, (node) => node.type === "MethodDefinition" && node.key.name === name);
      assert.ok(method, `Native method ${name} must exist`);
      return source.slice(method.start, method.end);
    }).join("\n");
  }
  const utils = await methods("utils/cpr-systemUtils.js", ["GetEventDatum"]);
  const base = await methods("actor/sheet/cpr-actor-sheet.js", ["_toggleInstalledVisibility", "_renderItemCard", "_renderReadOnlyItemCard", "_getItemId", "_getObjProp", "_uninstallSingleItem", "_itemAction", "_updateOwnedItemProp", "_updateOwnedItem", "_onDragItemStart"]);
  const character = await methods("actor/sheet/cpr-character-sheet.js", ["_cycleEquipState", "_updateAmount"]);
  return `
const LOGGER={debug(){}};
class SystemUtils {${utils}
  static getDocTypesFromMixin(){return ['weapon','cyberdeck','cyberware','itemUpgrade']}
}
const CPRChat={RenderItemCard(item){window.nativeCards.push({id:item.id,chat:true})}};
const Rules={lawyer(){}};
class CPRActorSheet {${base}
  _deleteOwnedItem(item){return this.actor.deleteEmbeddedDocuments('Item',[item.id],{})}
  _splitItem(item){window.nativeActions.push({id:item.id,type:'split'})}
}
class NativeCharacterSheet extends CPRActorSheet {${character}}
window.nativeSheet=new NativeCharacterSheet();
window.nativeSheet.token=null;
`;
}
