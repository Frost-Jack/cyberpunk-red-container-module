import { MODULE_ID, flagsOf, isContainer, canStore, indexInventory, isBusy, putInContainer, transferContainer } from "./containers.js";
import { renderInventory, renderGearSettings, reportError } from "./sheets.js";
import { registerPreferences } from "./preferences.js";

Hooks.once("init", () => {
  if (game.system.id !== "cyberpunk-red-core") return;
  registerPreferences();
  Hooks.on("renderActorSheet", renderInventory);
  Hooks.on("renderItemSheet", renderGearSettings);
});

Hooks.once("ready", () => {
  if (game.system.id !== "cyberpunk-red-core") return;
  game.modules.get(MODULE_ID).api = { isContainer, indexInventory, putInContainer, transferContainer };
  // Intercept before CPR's handler, which otherwise transfers only the dragged Gear item.
  const prototype = Object.getPrototypeOf(game.cpr.apps.CPRCharacterActorSheet.prototype);
  const original = prototype._cprOnItemDrop;
  prototype._cprOnItemDrop = async function(event) {
    const data = TextEditor.getDragEventData(event);
    const item = data.uuid ? await fromUuid(data.uuid) : null;
    const targetId = event.target.closest?.("[data-crc-container]")?.dataset.crcContainer ?? null;
    const actor = this.actor;
    const supported = ["character", "mook"].includes(actor.type);
    const source = item?.parent;
    if (!supported || !item || (!targetId && !isContainer(item) && !flagsOf(item).parent)) return original.call(this, event);
    try {
      if (isBusy(actor) || (source && isBusy(source))) throw new Error("busy");
      if (source?.uuid === actor.uuid) {
        await putInContainer(actor, item, targetId);
      } else if (source?.documentName === "Actor") {
        await transferContainer(source, actor, item, targetId);
      } else if (targetId && canStore(item)) {
        if (!actor.isOwner) throw new Error("permission");
        const imported = await Item.implementation.fromDropData(data);
        const copy = imported.toObject();
        delete copy._id;
        copy.flags ??= {};
        copy.flags[MODULE_ID] = { ...flagsOf(item), parent: targetId };
        await actor.createEmbeddedDocuments("Item", [copy], { CPRsplitStack: true, createInstalled: true });
      } else return original.call(this, event);
    } catch (error) { reportError(error); }
  };
});
