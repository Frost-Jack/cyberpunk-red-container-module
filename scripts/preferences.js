import { MODULE_ID } from "./containers.js";

const categories = ["weapon", "ammo", "armor", "cyberware", "drug", "gear", "clothing", "vehicle", "cyberdeck", "program", "itemUpgrade", "netarch"];
const positions = ["top", ...categories.map((type) => `after:${type}`), "bottom"];

export function getContainerPosition() {
  const position = game.user.getFlag(MODULE_ID, "containerPosition");
  return positions.includes(position) ? position : "after:armor";
}

export function placeContainerSection(inventory, section) {
  const position = getContainerPosition();
  if (position === "top") inventory.prepend(section);
  else if (position === "bottom") inventory.append(section);
  else {
    const category = inventory.querySelector(`#gearTab-${position.slice(6)}`)?.closest("div.collapsible");
    if (category?.parentElement === inventory) category.after(section);
    else inventory.append(section);
  }
}

export function registerPreferences() {
  class ContainerPreferences extends FormApplication {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "crc-preferences",
        title: game.i18n.localize("CRC.preferences.title"),
        template: `modules/${MODULE_ID}/templates/preferences.hbs`,
        width: 460,
        height: "auto",
        closeOnSubmit: true,
      });
    }

    getData() {
      const choices = {
        top: game.i18n.localize("CRC.preferences.top"),
      };
      for (const type of categories) {
        const category = game.i18n.localize(`CPR.global.itemTypes.${type === "netarch" ? "netArchitecture" : type}`);
        choices[`after:${type}`] = game.i18n.format("CRC.preferences.after", { category });
      }
      choices.bottom = game.i18n.localize("CRC.preferences.bottom");
      return { containerPosition: getContainerPosition(), positions: choices };
    }

    async _updateObject(event, data) {
      if (!positions.includes(data.containerPosition)) throw new Error("Invalid container position");
      await game.user.setFlag(MODULE_ID, "containerPosition", data.containerPosition);
    }
  }

  game.settings.registerMenu(MODULE_ID, "preferences", {
    name: "CRC.preferences.title",
    label: "CRC.preferences.open",
    hint: "CRC.preferences.hint",
    icon: "fas fa-box",
    type: ContainerPreferences,
    restricted: false,
  });
  Hooks.on("updateUser", (user, changes) => {
    if (user.id !== game.user.id || !changes.flags?.[MODULE_ID]) return;
    for (const app of Object.values(ui.windows)) {
      if (app.actor && app.rendered) app.render(false);
    }
  });
}
