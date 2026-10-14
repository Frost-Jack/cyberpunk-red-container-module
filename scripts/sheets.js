import { MODULE_ID, flagsOf, isContainer, indexInventory, isBusy } from "./containers.js";
import { placeContainerSection } from "./preferences.js";

const t = (key) => game.i18n.localize(`CRC.${key}`);
const rootOf = (html) => html instanceof HTMLElement ? html : html[0];
export function reportError(error) {
  console.error(`${MODULE_ID} |`, error);
  const key = `CRC.errors.${error.message}`;
  ui.notifications.error(game.i18n.has(key) ? game.i18n.localize(key) : t("errors.failed"));
}

function iconButton(icon, title, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "crc-toggle";
  button.title = title;
  button.setAttribute("aria-label", title);
  const glyph = document.createElement("i");
  glyph.className = `fas fa-${icon}`;
  glyph.setAttribute("aria-hidden", "true");
  button.append(glyph);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve().then(() => action(button)).catch(reportError);
  });
  return button;
}

function prepareRow(row, item) {
  const name = row.querySelector(":scope > .item-name > .item-edit");
  if (!name) return;
  name.title = item.name;
  // Give the name its own shrinking element while preserving the native link and thumbnail.
  for (const node of Array.from(name.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
    const label = document.createElement("span");
    label.className = "crc-name-text";
    node.replaceWith(label);
    label.append(node);
  }
}

export function renderInventory(sheet, html) {
  const actor = sheet.actor;
  if (!["character", "mook"].includes(actor.type)) return;
  const root = rootOf(html);
  const inventory = root.querySelector(".gear-tab-data > .items-list");
  if (!inventory || inventory.querySelector(".crc-section")) return;
  const index = indexInventory(actor.items);
  const section = document.createElement("div");
  section.className = "crc-section collapsible";
  const header = document.createElement("li");
  header.className = "items-header flexrow";
  const label = document.createElement("span");
  label.className = "item-name gear-name gear-section-header";
  label.textContent = t("containers");
  header.append(label);
  const list = document.createElement("ol");
  list.className = "items-list crc-list";
  const user = game.user;
  const sheetKey = actor.uuid.replaceAll(".", "-");
  list.hidden = !!user.getFlag(MODULE_ID, "collapsedSections")?.[sheetKey];
  const glyph = document.createElement("i");
  const updateHeader = () => {
    label.setAttribute("aria-expanded", String(!list.hidden));
    glyph.className = list.hidden ? "fas fa-plus collapse-icon" : "fas fa-minus expand-icon";
    glyph.setAttribute("aria-hidden", "true");
  };
  label.classList.add("crc-section-toggle");
  label.setAttribute("role", "button");
  label.tabIndex = 0;
  label.title = t("toggleSection");
  label.append(document.createTextNode(" "), glyph);
  updateHeader();
  const toggleSection = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const previous = list.hidden;
    list.hidden = !previous;
    updateHeader();
    try { await user.setFlag(MODULE_ID, `collapsedSections.${sheetKey}`, list.hidden); }
    catch (error) { list.hidden = previous; updateHeader(); reportError(error); }
  };
  label.addEventListener("click", toggleSection);
  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") toggleSection(event);
  });
  section.append(header, list);
  placeContainerSection(inventory, section);

  const rows = new Map();
  for (const row of inventory.querySelectorAll("li.item[data-item-id]")) {
    if (!row.parentElement.closest("li.item")) rows.set(row.dataset.itemId, row);
  }
  const lists = new Map();
  for (const [id] of index.containers) {
    const row = rows.get(id);
    if (!row) continue;
    prepareRow(row, index.byId.get(id));
    row.classList.add("crc-container");
    row.dataset.crcContainer = id;
    const name = row.querySelector(":scope > .item-name");
    const children = document.createElement("ol");
    children.className = "items-list crc-contents";
    children.hidden = !!flagsOf(index.byId.get(id)).collapsed;
    lists.set(id, children);
    const toggle = iconButton(children.hidden ? "chevron-right" : "chevron-down", t("toggle"), async (button) => {
      children.hidden = !children.hidden;
      button.firstElementChild.className = `fas fa-chevron-${children.hidden ? "right" : "down"}`;
      button.setAttribute("aria-expanded", String(!children.hidden));
      if (actor.isOwner) await index.byId.get(id).setFlag(MODULE_ID, "collapsed", children.hidden);
    });
    toggle.setAttribute("aria-expanded", String(!children.hidden));
    name?.prepend(toggle);
    const count = document.createElement("span");
    count.className = "crc-count";
    count.textContent = game.i18n.format("CRC.itemsIncluded", { count: index.children.get(id)?.length ?? 0 });
    count.title = t("contents");
    const data = row.querySelector(":scope > .gear-data");
    if (data) {
      const description = document.createElement("span");
      description.className = "crc-description";
      description.append(...data.childNodes);
      data.classList.add("crc-container-data");
      data.append(count, description);
    }
    row.append(children);
    row.classList.remove("hide");
    list.append(row);
  }
  // Move original rows, preserving CPR editing, quantity, equipment, and drag listeners.
  for (const [id, parent] of index.parents) {
    const row = rows.get(id);
    const children = lists.get(parent);
    if (!row || !children) continue;
    prepareRow(row, index.byId.get(id));
    row.classList.remove("hide");
    row.classList.add("crc-contained");
    children.append(row);
    // CPR binds dragstart to every item row; prevent a parent from overwriting this payload.
    row.addEventListener("dragstart", (event) => event.stopPropagation());
  }
  for (const row of section.querySelectorAll(".sub-list li.item[data-item-id]")) {
    row.addEventListener("dragstart", (event) => event.stopPropagation());
  }
  if (actor.isOwner) {
    inventory.addEventListener("dragover", (event) => {
      const row = event.target.closest("[data-crc-container]");
      if (!row) return;
      event.preventDefault();
      row.classList.add("crc-dragover");
    });
    inventory.addEventListener("dragleave", (event) => {
      const row = event.target.closest("[data-crc-container]");
      if (row && !row.contains(event.relatedTarget)) row.classList.remove("crc-dragover");
    });
    inventory.addEventListener("drop", () => {
      for (const row of inventory.querySelectorAll(".crc-dragover")) row.classList.remove("crc-dragover");
    });
  }
}

export function renderGearSettings(sheet, html) {
  const item = sheet.item;
  if (item.type !== "gear") return;
  const root = rootOf(html);
  const settings = root.querySelector(".item-settings-tab .items-list");
  if (!settings || settings.querySelector(".crc-setting")) return;
  settings.classList.add("crc-gear-settings");
  const row = document.createElement("li");
  row.className = "crc-setting";
  const title = document.createElement("h3");
  title.className = "crc-settings-title";
  title.textContent = t("container");
  const label = document.createElement("label");
  label.className = "crc-setting-label";
  label.append(document.createTextNode(t("isContainer")));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = isContainer(item);
  input.disabled = !sheet.isEditable;
  input.addEventListener("change", () => {
    Promise.resolve().then(async () => {
      if (item.parent && isBusy(item.parent)) throw new Error("busy");
      const updates = [{ _id: item.id, [`flags.${MODULE_ID}.container`]: input.checked }];
      if (!input.checked && item.parent) {
        for (const child of indexInventory(item.parent.items).children.get(item.id) ?? []) {
          updates.push({ _id: child.id, [`flags.${MODULE_ID}.parent`]: null });
        }
      }
      if (item.parent) await item.parent.updateEmbeddedDocuments("Item", updates);
      else await item.setFlag(MODULE_ID, "container", input.checked);
    }).catch((error) => { input.checked = isContainer(item); reportError(error); });
  });
  label.append(input);
  row.append(title, label);
  settings.append(row);
}
