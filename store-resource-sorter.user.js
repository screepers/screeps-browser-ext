// ==UserScript==
// @name        Store Resource Sorter
// @namespace   https://screeps.com/
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost:*/(*)/#!/*
// @icon        // @grant       none
// @version     0.1
// @author      -
// @description Better sorting for the resource list in the inspector
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1773232591774
// @downloadUrl https://screepers.github.io/screeps-browser-ext/store-resource-sorter.js?v=1773232591774
// ==/UserScript==




const myOrder = ["energy","power","ops","O","H","Z","L","U","K","X","G","OH","ZK","UL","KH","KH2O","XKH2O","KO","KHO2","XKHO2","UH","UH2O","XUH2O","UO","UHO2","XUHO2","LH","LH2O","XLH2O","LO","LHO2","XLHO2","ZH","ZH2O","XZH2O","ZO","ZHO2","XZHO2","GH","GH2O","XGH2O","GO","GHO2","XGHO2","battery","oxidant","reductant","zynthium_bar","lemergium_bar","utrium_bar","keanium_bar","purifier","ghodium_melt","composite","crystal","liquid"];

/**
 * @param {{ store: Record<string, number>}} obj
 */
function sortResources(obj) {
    if (!obj?.store) return;

    /** @type {Record<string, number>} */
    const newStore = {};
    for (const resource of myOrder) {
        if (obj.store[resource]) {
            newStore[resource] = obj.store[resource];
        }
    }
    for (let resource in obj.store) {
        if (!myOrder.includes(resource)) {
            newStore[resource] = obj.store[resource];
        }
    }
    obj.store = newStore;
}

ScreepsAdapter.ready(async () => {
    console.warn("Store Resources Sorter: Loaded");

    ScreepsAdapter.onSelectionChange(async (obj) => {
        sortResources(obj?.object);
    });
});
