import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { sample } from "./fixtures.mjs";
import { loadNativeInventory } from "./cpr-native.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(here, "..");
const dataRoot = resolve(moduleRoot, "../..");
const appRoot = process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const runtime = process.env.CODEX_NODE_MODULES ?? "C:/Users/trokh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(import.meta.url);
const { chromium } = require(join(runtime, "playwright"));
const Handlebars = require(join(appRoot, "node_modules/handlebars"));
Handlebars.parse(await readFile(join(moduleRoot, "templates/preferences.hbs"), "utf8"));
const templateRoot = join(dataRoot, "systems/cyberpunk-red-core/templates");
const localize = (key) => key.split(".").at(-1);
Handlebars.registerHelper("localize", localize);
Handlebars.registerHelper("helperMissing", () => "");
Handlebars.registerHelper("cprCompare", (a, op, b) => op === "===" ? a === b : op === "!==" ? a !== b : op === ">" ? a > b : !!a && !!b);
Handlebars.registerHelper("cprListContains", (list, value) => (typeof list === "string" ? list.split(",") : list ?? []).includes(value));
Handlebars.registerHelper("cprNumberFormat", (n) => n);
Handlebars.registerHelper("cprSanitizeText", (text) => text);
Handlebars.registerHelper("cprHasTemplate", (type, mixin) => mixin === "equippable" || mixin === "stackable" && ["gear", "drug", "ammo"].includes(type));
Handlebars.registerHelper("cprApplyUpgrade", (item, value) => value);
Handlebars.registerHelper("cprIsUpgradable", (item) => item.type === "weapon");
const nativeImplementation = await loadNativeInventory(dataRoot, Handlebars, localize);
for (const file of await readdir(join(templateRoot, "actor/mixin/actions"))) {
  if (file.endsWith(".hbs")) Handlebars.registerPartial(`systems/cyberpunk-red-core/templates/actor/mixin/actions/${file}`, await readFile(join(templateRoot, "actor/mixin/actions", file), "utf8"));
}
const actor = sample();
const groups = new Map();
function templateItem(item) {
  const data = item.toObject();
  data.id = data._id;
  data.actor = { flags: {} };
  data.system.hasInstalled = !!data.system.installedItems?.list.length;
  data.getInstalledItems = () => (data.system.installedItems?.list ?? []).map((id) => templateItem(actor.items.get(id)));
  if (data.type === "weapon") Object.assign(data.system, { isRanged: true, hasAmmoLoaded: true, isUpgraded: true, equipped: "carried" });
  return data;
}
for (const item of actor.items) {
  if (["loaded", "upgrade"].includes(item.id)) continue;
  const path = join(templateRoot, `actor/character/right-pane/tabs/gear/cpr-${item.type}-content.hbs`);
  const data = templateItem(item);
  data.system.description = { value: `${data.type} description` };
  data.img = "/systems/cyberpunk-red-core/icons/pause.png";
  const html = Handlebars.compile(await readFile(path, "utf8"))({ item: data, actor: { itemTypes: {} }, sheet: { options: { collapsedSections: [] } } });
  groups.set(item.type, `${groups.get(item.type) ?? ""}${html}`);
}
const markup = ["weapon", "ammo", "armor", "cyberware", "drug", "gear", "clothing", "vehicle", "cyberdeck", "program", "itemUpgrade", "netarch"].map((type) => `<div class="collapsible"><li class="items-header flexrow collapsible"><span class="item-name gear-name gear-section-header" id="gearTab-${type}">${type.charAt(0).toUpperCase() + type.slice(1)} <i class="fas fa-minus expand-icon"></i></span></li><ol class="items-list">${groups.get(type) ?? ""}</ol></div>`).join("");
const harness = `<!doctype html><html data-cpr-theme="default"><head><meta charset="utf-8">
<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/fonts/fontawesome/css/all.min.css"><link rel="stylesheet" href="/systems/cyberpunk-red-core/main.css"><link rel="stylesheet" href="/styles/module.css">
<style>body {margin:0;padding:16px;background:var(--cpr-background-box);color:var(--cpr-text-normal)} main {max-width:900px;margin:auto} .flexrow {display:flex;flex-wrap:nowrap} .flexrow > * {flex:1} .items-list {list-style:none;padding:0;margin:0} .sheet {font-family:var(--cpr-font-primary),sans-serif} button {cursor:pointer} .item-settings-tab {margin-top:20px} .item-settings-section {list-style:none} </style></head>
<body><main class="sheet actor cyberpunk-red-core"><div class="gear-tab"><div class="gear-tab-data"><ol class="items-list">${markup}</ol></div></div>
<div class="item-settings-tab"><div class="item-settings-section"><div class="item-settings-grid"><ol class="items-list"><li class="item flexrow"><span>Category</span><span>Premium</span></li><li class="item flexrow"><span>Price</span><span>100</span></li></ol></div></div></div>
<div id="create"><form><input name="name"><select name="type"><option value="gear">Gear</option><option value="weapon">Weapon</option></select></form></div></main>
<script src="/jquery.js"></script><script type="module">
import { sample, FakeActor, FakeUser, raw } from '/tests/fixtures.mjs';
import { MODULE_ID } from '/scripts/containers.js';
import * as sheets from '/scripts/sheets.js';
const language = await (await fetch('/languages/ru.json')).json();
const localize = (key) => key.split('.').reduce((obj, key) => obj?.[key], language) ?? key;
window.game = { system:{id:'cyberpunk-red-core'}, i18n: { localize, has:(key)=>localize(key)!==key, format:(key,data)=>localize(key).replace(/\{(\\w+)\}/g,(_,name)=>data[name]) }, modules:new Map([[MODULE_ID,{}]]), user:new FakeUser('player1'), settings:{registerMenu(scope,key,menu){window.preferenceMenu=menu}} };
window.ui = {windows:{},notifications:{error:(msg)=>{window.lastError=msg}}};
window.FormApplication = class {static get defaultOptions(){return {}}};
foundry.utils.mergeObject=(base,values)=>({...base,...values});
foundry.utils.setProperty=(object,path,value)=>{const parts=path.split('.');let target=object;for(const part of parts.slice(0,-1)) target=target[part]??={};target[parts.at(-1)]=value;};
window.actor = sample();
window.targetActor = new FakeActor('target');
window.fixtures = {FakeActor, FakeUser, raw};
window.nativeEdits = 0;
window.nativeActions = [];
window.nativeDrags = [];
window.nativeCards = [];
${nativeImplementation}
function hydrateActor() {
  actor.flags??={};
  actor.getFlag=(scope,key)=>actor.flags[scope]?.[key];
  actor.setFlag=async(scope,key,value)=>{(actor.flags[scope]??={})[key]=value;};
  actor.getOwnedItem=(id)=>actor.items.get(id);
  actor.getEmbeddedDocument=(type,id)=>actor.items.get(id);
  actor._id=actor.uuid.split('.').at(-1);
  actor.canHoldWeapon=()=>true;
  for(const item of actor.items){
    item.toJSON=()=>item.toObject();
    item.setItemAmount=(value)=>{item.system.amount=Number(value);};
    item.sheet.render=(force,options)=>{nativeEdits++;nativeCards.push({id:item.id,editable:options.editable});};
    item.sheet._manageInstalledItems=async(type)=>nativeActions.push({id:item.id,type:'manage-'+type});
    item.toggleFavorite=()=>{item.system.favorite=!item.system.favorite;};
    item.snort=()=>{item.system.amount--;};
    item.doAction=(actor,attributes)=>nativeActions.push({id:item.id,type:attributes['data-action']?.value});
    item.getInstalledItems=()=> (item.system.installedItems?.list??[]).map((id)=>actor.items.get(id));
    item.recursiveGetAllInstalledItems=()=>item.getInstalledItems();
    item.uninstall=async(options)=>{nativeActions.push({id:item.id,type:'uninstall',parent:options?.providedContainers?.[0]?.id});};
  }
  nativeSheet.actor=actor;
}
hydrateActor();
window.Hooks = {
  callbacks: {}, once(name, callback) {this.callbacks[name]=callback},
  on(name, callback) {this.callbacks[name]=callback;return name},
  off(name) {delete this.callbacks[name]},
  callAll(name,...args) {this.callbacks[name]?.(...args)}
};
class BaseSheet { async _cprOnItemDrop() {window.fallback = (window.fallback??0)+1;} }
class CharacterSheet extends BaseSheet {}
window.game.cpr = {apps:{CPRCharacterActorSheet:CharacterSheet}};
window.CharacterSheet = CharacterSheet;
window.TextEditor = {getDragEventData:(event)=>JSON.parse(event.dataTransfer.getData('text/plain'))};
window.fromUuid = async (uuid) => [...window.actor.items, ...window.targetActor.items].find((item)=>item.uuid===uuid);
await import('/scripts/module.js');
Hooks.callbacks.init();
Hooks.callbacks.ready();
function bindNativeRows() {
hydrateActor();
for (const row of document.querySelectorAll('.gear-tab-data li.item[data-item-id]')) {
  if (!actor.items.has(row.dataset.itemId)) { row.remove(); continue; }
  row.addEventListener('dragstart', (event) => {
    window.nativeDrags.push(row.dataset.itemId);
    nativeSheet._onDragItemStart(event);
  });
  const amount=row.querySelector('.gear-amount-input');
  if (amount) {
    amount.value=actor.items.get(row.dataset.itemId).system.amount;
    amount.addEventListener('change',(event)=>nativeSheet._updateAmount(event));
  }
}
const bindings={'.item-edit':'_renderItemCard','.item-view':'_renderReadOnlyItemCard','.item-action':'_itemAction','.toggle-installed-visibility':'_toggleInstalledVisibility','.uninstall-single-item':'_uninstallSingleItem','.equip':'_cycleEquipState'};
for(const [selector,method] of Object.entries(bindings)) {
  for(const element of document.querySelectorAll('.gear-tab-data '+selector)) element.addEventListener('click',(event)=>nativeSheet[method](event));
}
for(const wrapper of document.querySelectorAll('[data-items-wrapper-for-parent]')){
  const expanded=!!actor.getFlag(game.system.id,'showInstalled')?.[wrapper.dataset.itemsWrapperForParent];
  wrapper.classList.toggle('item-hidden',!expanded);
  wrapper.closest('li.item').querySelector('.toggle-installed-visibility i')?.classList.toggle('fa-flip-vertical',!expanded);
}
}
window.sheets = sheets;
window.bindNativeRows = bindNativeRows;
window.baseMarkup = document.querySelector('.gear-tab-data').innerHTML;
window.nativeRows = [...document.querySelectorAll('.gear-tab-data li.item[data-item-id]')];
window.beforeRender = JSON.stringify([...actor.items].map((item)=>item.toObject()));
bindNativeRows();
sheets.renderInventory({actor}, document.querySelector('main'));
sheets.renderGearSettings({item:actor.items.get('bag'),isEditable:true}, document.querySelector('main'));
window.refreshInventory = () => {
  document.querySelector('.gear-tab-data').innerHTML=baseMarkup;
  bindNativeRows();
  sheets.renderInventory({actor},document.querySelector('main'));
};
ui.windows.main={actor,rendered:true,render:()=>refreshInventory()};
window.dropItem = async (id,selector) => {
  const sheet = new CharacterSheet();
  sheet.actor=actor;
  const event=new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()});
  event.dataTransfer.setData('text/plain',JSON.stringify({type:'Item',uuid:actor.items.get(id).uuid}));
  document.querySelector(selector).dispatchEvent(event);
  await sheet._cprOnItemDrop(event);
};
window.testReady = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(harness); return; }
    const root = path.startsWith("/systems/") ? dataRoot : path.startsWith("/fonts/") ? join(appRoot, "public") : moduleRoot;
    const file = path === "/core.css" ? join(appRoot, "public/css/style.css") : path === "/jquery.js" ? join(appRoot, "node_modules/jquery/dist/jquery.js") : resolve(root, `.${path}`);
    if (!["/core.css", "/jquery.js"].includes(path) && !file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) throw new Error("path");
    const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" }[extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.testReady);
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('.crc-list > [data-item-id="bag"]').count(), 1);
  assert.equal(await page.locator('[data-item-id="bag"] > .crc-contents > [data-item-id="gun"]').count(), 1);
  assert.equal(await page.locator('[data-item-id="pouch"] > .crc-contents > [data-item-id="drug"]').count(), 1);
  assert.equal(await page.locator('li.item[data-item-id]').count(), 9);
  await page.locator('.crc-section-toggle').hover();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.crc-section-toggle')).cursor === getComputedStyle(document.querySelector('#gearTab-armor')).cursor),true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.crc-section-toggle i')).fontSize === getComputedStyle(document.querySelector('#gearTab-armor i')).fontSize),true);
  assert.equal(await page.evaluate(() => document.querySelector('.crc-section').nextElementSibling.querySelector('#gearTab-cyberware') !== null), true);
  assert.equal(await page.evaluate(() => document.querySelector('.crc-section').previousElementSibling.querySelector('#gearTab-armor') !== null), true);
  assert.equal(await page.locator('.crc-section > .items-header button').count(), 0);
  assert.equal(await page.locator('#create select option').count(), 2);
  assert.equal(await page.evaluate(() => 'createContainer' in game.modules.get('cyberpunk-red-container-module').api), false);
  assert.equal(await page.evaluate(() => 'renderDialog' in Hooks.callbacks || 'renderItemDirectory' in Hooks.callbacks), false);
  assert.equal(await page.evaluate(() => document.querySelector('.item-settings-tab .items-list').lastElementChild.matches('.crc-setting')), true);
  assert.equal(await page.evaluate(() => document.querySelector('.crc-setting').getBoundingClientRect().width > document.querySelector('main').getBoundingClientRect().width * 0.95), true);
  assert.equal(await page.evaluate(() => nativeRows.every((row) => row.isConnected)), true);
  assert.equal(await page.evaluate(() => JSON.stringify([...actor.items].map((item)=>item.toObject())) === beforeRender), true);
  const extraViews = await page.evaluate(() => {
    const {FakeActor}=fixtures;
    const observer=new FakeActor('observer',[...actor.items].map((item)=>item.toObject()));
    observer.isOwner=false;
    const view=document.createElement('div');
    view.innerHTML='<div class="gear-tab-data">'+baseMarkup+'</div>';
    sheets.renderInventory({actor:observer},view);
    sheets.renderInventory({actor:observer},view);
    const flag=observer.items.get('bag').flags['cyberpunk-red-container-module'];
    const before=JSON.stringify(flag);
    view.querySelector('[data-item-id="bag"] > .item-name > button[aria-expanded]').click();
    const filter=document.createElement('div');
    filter.innerHTML='<div class="gear-tab-data">'+baseMarkup+'</div>';
    filter.querySelector('[data-item-id="bag"]').remove();
    sheets.renderInventory({actor},filter);
    return {sections:view.querySelectorAll('.crc-section').length,create:view.querySelectorAll('.crc-section > .items-header button').length,observerUnchanged:JSON.stringify(flag)===before,filteredRows:filter.querySelectorAll('li.item[data-item-id]').length,gunStillPresent:!!filter.querySelector('[data-item-id="gun"]')};
  });
  assert.deepEqual(extraViews,{sections:1,create:0,observerUnchanged:true,filteredRows:8,gunStillPresent:true});
  const positionsChecked = await page.evaluate(async () => {
    if (preferenceMenu.restricted) throw new Error('Player cannot access preferences');
    const form=new preferenceMenu.type();
    const options=Object.keys(form.getData().positions);
    for (const position of options) {
      await form._updateObject(null,{containerPosition:position});
      const section=document.querySelector('.crc-section');
      if (position==='top' && section.previousElementSibling) throw new Error('Top placement');
      if (position==='bottom' && section.nextElementSibling) throw new Error('Bottom placement');
      if (position.startsWith('after:') && !section.previousElementSibling?.querySelector('#gearTab-'+position.slice(6))) throw new Error('Wrong placement: '+position);
    }
    await form._updateObject(null,{containerPosition:'after:armor'});
    return options.length;
  });
  assert.equal(positionsChecked,14);
  await page.locator('[data-item-id="bag"] > .item-name > button[aria-expanded]').click();
  await page.locator('.crc-section-toggle').click();
  assert.equal(await page.locator('.crc-list').isVisible(),false);
  assert.equal(await page.locator('.crc-section-toggle .fa-plus').count(),1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.crc-section-toggle i')).fontSize === getComputedStyle(document.querySelector('#gearTab-armor i')).fontSize),true);
  assert.equal(await page.locator('#gearTab-gear').isVisible(),true);
  await page.evaluate(() => refreshInventory());
  assert.equal(await page.locator('.crc-list').isVisible(),false);
  await page.locator('.crc-section-toggle').press('Enter');
  assert.equal(await page.locator('.crc-list').isVisible(),true);
  assert.equal(await page.locator('li.item[data-item-id="gun"]').isVisible(),false);
  await page.locator('[data-item-id="bag"] > .item-name > button[aria-expanded]').click();
  await page.locator('.crc-section-toggle').press('Space');
  assert.equal(await page.locator('.crc-list').isVisible(),false);
  const isolated = await page.evaluate(async () => {
    const first=game.user;
    const form=new preferenceMenu.type();
    await form._updateObject(null,{containerPosition:'after:gear'});
    game.user=new fixtures.FakeUser('player2');
    refreshInventory();
    const defaults=form.getData().containerPosition==='after:armor' && !document.querySelector('.crc-list').hidden;
    await form._updateObject(null,{containerPosition:'top'});
    const secondAtTop=!document.querySelector('.crc-section').previousElementSibling;
    game.user=first;
    refreshInventory();
    const firstUnchanged=form.getData().containerPosition==='after:gear' && document.querySelector('.crc-list').hidden;
    await form._updateObject(null,{containerPosition:'after:armor'});
    return {defaults,secondAtTop,firstUnchanged};
  });
  assert.deepEqual(isolated,{defaults:true,secondAtTop:true,firstUnchanged:true});
  await page.locator('.crc-section-toggle').click();
  assert.equal(await page.locator('.crc-list').isVisible(),true);
  assert.equal(await page.evaluate(() => actor.items.size),9);
  assert.equal(await page.evaluate(() => actor.calls.length),0);
  await page.locator('[data-item-id="gun"] > .item-name > .item-edit').click();
  assert.equal(await page.evaluate(() => nativeEdits), 1);
  assert.deepEqual(await page.evaluate(() => nativeCards.at(-1)),{id:'gun',editable:true});
  const installedToggle=page.locator('[data-item-id="gun"] > .item-name > .toggle-installed-visibility');
  const installedList=page.locator('[data-items-wrapper-for-parent="gun"]');
  assert.equal(await installedList.evaluate((el)=>el.classList.contains('item-hidden')),true);
  await installedToggle.click();
  await page.waitForFunction(()=>actor.getFlag(game.system.id,'showInstalled')?.gun===true);
  assert.equal(await page.locator('.crc-section [data-item-id="loaded"] .item-view').isVisible(),true);
  assert.equal(await page.locator('.crc-section [data-item-id="upgrade"] .item-view').isVisible(),true);
  await page.locator('[data-item-id="loaded"] > .item-view').click();
  assert.deepEqual(await page.evaluate(()=>nativeCards.at(-1)),{id:'loaded',editable:false});
  await page.locator('[data-item-id="upgrade"] > .item-view').click({modifiers:['Control']});
  assert.deepEqual(await page.evaluate(()=>nativeCards.at(-1)),{id:'upgrade',chat:true});
  await page.locator('[data-item-id="upgrade"] .uninstall-single-item').click();
  assert.deepEqual(await page.evaluate(()=>nativeActions.at(-1)),{id:'upgrade',type:'uninstall',parent:'gun'});
  const installedDrag=await page.evaluate(()=>{
    nativeDrags.length=0;
    const event=new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()});
    document.querySelector('[data-item-id="loaded"]').dispatchEvent(event);
    return {calls:[...nativeDrags],uuid:JSON.parse(event.dataTransfer.getData('text/plain')).uuid};
  });
  assert.deepEqual(installedDrag,{calls:['loaded'],uuid:'Actor.source.Item.loaded'});
  for(const action of ['reload-ammo','select-ammo']) {
    await page.locator('[data-item-id="gun"] > .gear-actions .item-action[data-action="'+action+'"]').click();
    assert.deepEqual(await page.evaluate(()=>nativeActions.at(-1)),{id:'gun',type:action});
  }
  await page.locator('[data-item-id="gun"] .item-action[data-action-type="manage-upgrades"]').click();
  assert.deepEqual(await page.evaluate(()=>nativeActions.at(-1)),{id:'gun',type:'manage-itemUpgrade'});
  for(let cycle=0;cycle<3;cycle++) await page.locator('[data-item-id="gun"] > .gear-actions .equip').click();
  assert.deepEqual(await page.evaluate(()=>({gun:actor.items.get('gun').system.equipped,loaded:actor.items.get('loaded').system.equipped,bag:actor.items.get('bag').system.equipped??null})),{gun:'owned',loaded:'owned',bag:null});
  await installedToggle.click();
  await page.waitForFunction(()=>actor.getFlag(game.system.id,'showInstalled')?.gun===false);
  await installedToggle.click();
  await page.waitForFunction(()=>actor.getFlag(game.system.id,'showInstalled')?.gun===true);
  await page.evaluate(()=>refreshInventory());
  assert.equal(await installedList.evaluate((el)=>el.classList.contains('item-hidden')),false);
  await page.evaluate(()=>{nativeDrags.length=0;});
  const dragged = await page.evaluate(() => {
    const event = new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() });
    document.querySelector('[data-item-id="drug"]').dispatchEvent(event);
    return { calls:nativeDrags, uuid:JSON.parse(event.dataTransfer.getData('text/plain')).uuid };
  });
  assert.deepEqual(dragged.calls, ["drug"]);
  assert.equal(dragged.uuid, "Actor.source.Item.drug");
  const toggle = page.locator('[data-item-id="bag"] > .item-name > button[aria-expanded]');
  await toggle.click();
  assert.equal(await page.locator('li.item[data-item-id="gun"]').isVisible(), false);
  await toggle.click();
  assert.equal(await page.locator('li.item[data-item-id="gun"]').isVisible(), true);
  assert.equal(await page.locator('[data-item-id="bag"] > .gear-data .crc-count').innerText(), "Предметы: 4");
  assert.equal(await page.locator('.crc-contents button:not(.crc-toggle)').count(), 0);
  assert.notEqual(await page.locator('.crc-toggle i').first().evaluate((el) => getComputedStyle(el, '::before').content), "none");
  const out = join(moduleRoot, "tests/artifacts");
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: join(out, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 560, height: 850 });
  await page.screenshot({ path: join(out, "narrow.png"), fullPage: true });
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.crc-contents')].some((el) => el.getBoundingClientRect().right > document.querySelector('main').getBoundingClientRect().right + 1));
  assert.equal(overflow, false);
  const overlaps = await page.evaluate(() => [...document.querySelectorAll('.crc-list > .item, .crc-contents > .item')].some((row) => {
    const cells = [...row.children].filter((el) => !el.matches('ol,.sub-list'));
    return cells.some((el, i) => i > 0 && el.getBoundingClientRect().left < cells[i-1].getBoundingClientRect().right - 1);
  }));
  assert.equal(overlaps, false);
  assert.equal(await page.locator('.crc-count').first().evaluate((el) => getComputedStyle(el).fontFamily.includes('Jost')), true);
  const longName = await page.evaluate(() => {
    const el=document.querySelector('[data-item-id="gun"] .crc-name-text');
    const previous=el.textContent;
    el.textContent='Militech Extremely Long Custom Heavy Pistol Name With Additional Modifications';
    const row=el.closest('li.item');
    const fits=el.getBoundingClientRect().right <= row.querySelector(':scope > .gear-amount').getBoundingClientRect().left;
    el.textContent=previous;
    return fits;
  });
  assert.equal(longName, true);
  const nesting = await page.evaluate(async () => {
    const originals=[...actor.items];
    await dropItem('pouch','#gearTab-gear');
    refreshInventory();
    const atRoot=document.querySelector('.crc-list > [data-item-id="pouch"]') !== null;
    const drugStayed=actor.items.get('drug').flags['cyberpunk-red-container-module'].parent === 'pouch';
    await dropItem('pouch','[data-item-id="bag"] > .item-name');
    refreshInventory();
    const nested=document.querySelector('[data-item-id="bag"] > .crc-contents > [data-item-id="pouch"] > .crc-contents > [data-item-id="drug"]') !== null;
    nativeDrags.length=0;
    const drag=new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()});
    document.querySelector('[data-item-id="pouch"]').dispatchEvent(drag);
    const draggedId=JSON.parse(drag.dataTransfer.getData('text/plain')).uuid;
    const before=JSON.stringify(originals.map((item)=>item.toObject()));
    await dropItem('bag','[data-item-id="pouch"] > .item-name');
    const cycleBlocked=!!window.lastError;
    window.lastError=undefined;
    await dropItem('bag','[data-item-id="bag"] > .item-name');
    const selfBlocked=!!window.lastError;
    window.lastError=undefined;
    return {atRoot,drugStayed,nested,draggedId,dragCalls:[...nativeDrags],cycleBlocked,selfBlocked,unchanged:JSON.stringify(originals.map((item)=>item.toObject()))===before,sameDocuments:originals.every((item)=>actor.items.get(item.id)===item),writes:actor.calls.length};
  });
  assert.deepEqual(nesting,{atRoot:true,drugStayed:true,nested:true,draggedId:'Actor.source.Item.pouch',dragCalls:['pouch'],cycleBlocked:true,selfBlocked:true,unchanged:true,sameDocuments:true,writes:0});
  await page.locator('[data-item-id="bag"] > .crc-contents > [data-item-id="pouch"] > .item-name > button').click();
  assert.equal(await page.locator('li.item[data-item-id="drug"]').isVisible(), false);
  assert.equal(await page.locator('li.item[data-item-id="gun"]').isVisible(), true);
  await page.locator('[data-item-id="pouch"] > .item-name > button').click();
  assert.equal(await page.locator('li.item[data-item-id="drug"]').isVisible(), true);
  await page.locator('[data-item-id="ammo"] .gear-amount-input').fill('39');
  await page.locator('[data-item-id="ammo"] .gear-amount-input').dispatchEvent('change');
  await page.locator('[data-item-id="gun"] .item-action[data-action-type="favorite"]').click();
  await page.locator('[data-item-id="drug"] .item-action[data-action-type="snort"]').click();
  assert.deepEqual(await page.evaluate(() => ({ammo:actor.items.get('ammo').system.amount,drug:actor.items.get('drug').system.amount,gunFavorite:actor.items.get('gun').system.favorite,bagFavorite:!!actor.items.get('bag').system.favorite,magazine:actor.items.get('gun').system.magazine.value})),{ammo:39,drug:0,gunFavorite:true,bagFavorite:false,magazine:6});
  await page.evaluate(async () => {
    const sheet = new CharacterSheet();
    sheet.actor = actor;
    const event = new DragEvent('drop', {bubbles:true, dataTransfer:new DataTransfer()});
    event.dataTransfer.setData('text/plain',JSON.stringify({type:'Item',uuid:actor.items.get('outside').uuid}));
    document.querySelector('[data-item-id="bag"] > .item-name').dispatchEvent(event);
    await sheet._cprOnItemDrop(event);
  });
  assert.equal(await page.evaluate(() => actor.items.get('outside').flags['cyberpunk-red-container-module'].parent), "bag");
  await page.evaluate(() => dropItem('armor','#gearTab-gear'));
  await page.waitForFunction(() => actor.items.get('armor').flags['cyberpunk-red-container-module'].parent === null);
  await page.locator('[data-item-id="armor"] .item-action[data-action-type="delete"]').click();
  await page.waitForFunction(() => !actor.items.has('armor'));
  assert.equal(await page.evaluate(() => actor.items.has('bag') && actor.items.has('pouch') && actor.items.has('gun')), true);
  await page.locator('.crc-setting input').uncheck();
  await page.waitForFunction(() => actor.items.get('bag').flags['cyberpunk-red-container-module'].container === false);
  assert.equal(await page.evaluate(() => actor.items.get('gun').flags['cyberpunk-red-container-module'].parent), null);
  // A fresh native render with the module disabled is exactly the system's original markup.
  await page.evaluate(() => { document.querySelector('.gear-tab-data').innerHTML = baseMarkup; bindNativeRows(); });
  assert.equal(await page.locator('.crc-section').count(), 0);
  assert.equal(await page.locator('li.item[data-item-id]').count(), 8);
  await page.evaluate(async () => {
    const {sample}=await import('/tests/fixtures.mjs');
    window.actor=sample();
    const sheet = new CharacterSheet();
    sheet.actor = targetActor;
    const event = new DragEvent('drop', {bubbles:true, dataTransfer:new DataTransfer()});
    event.dataTransfer.setData('text/plain',JSON.stringify({type:'Item',uuid:actor.items.get('bag').uuid}));
    document.querySelector('.gear-tab-data').dispatchEvent(event);
    await sheet._cprOnItemDrop(event);
  });
  assert.equal(await page.evaluate(() => actor.items.size), 1);
  assert.equal(await page.evaluate(() => targetActor.items.size), 8);
  assert.deepEqual(await page.evaluate(() => {
    const byName=(name)=>[...targetActor.items].find((item)=>item.name===name);
    const bag=byName('bag'),pouch=byName('pouch'),drug=byName('drug');
    return {pouchParent:pouch.flags['cyberpunk-red-container-module'].parent===bag.id,drugParent:drug.flags['cyberpunk-red-container-module'].parent===pouch.id,sourceOnly:[...actor.items].map((item)=>item.name)};
  }),{pouchParent:true,drugParent:true,sourceOnly:['outside']});
  assert.equal(await page.evaluate(() => window.lastError), undefined);
  const renderTimes = await page.evaluate(() => {
    const results = [];
    for (const count of [100,1000]) {
      const {FakeActor,raw} = fixtures;
      const data = [raw('benchBag','gear',null,true)];
      for (let i=1;i<count;i++) data.push(raw('item'+i,'gear','benchBag'));
      const actor = new FakeActor('bench',data);
      const times=[];
      for (let run=0;run<10;run++) {
        const root=document.createElement('div');
        root.innerHTML='<div class="gear-tab-data"><ol class="items-list">'+data.map((item)=>'<li class="item flexrow" data-item-id="'+item._id+'"><div class="item-name">'+item.name+'</div><div class="gear-amount"></div><div class="gear-data"></div><div class="gear-actions"></div></li>').join('')+'</ol></div>';
        const start=performance.now();
        sheets.renderInventory({actor},root);
        times.push(performance.now()-start);
      }
      times.sort((a,b)=>a-b);
      results.push({items:count,medianMs:+times[5].toFixed(2),maxMs:+times[9].toFixed(2)});
    }
    return results;
  });
  assert.deepEqual(errors, []);
  console.log('Detached DOM enhancement timing (excludes native render, layout and paint): '+JSON.stringify(renderTimes));
  console.log("Browser checks passed: native installed ammo/upgrades disclosure and persistence, sheet/chat/uninstall dispatch, reload/ammo selection, upgrade management, equipment cycling, amount edits, installed-item drag, matching section icon size, personal placement/collapse, nested containers, whole-tree transfer, module-off markup and responsive screenshots.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
