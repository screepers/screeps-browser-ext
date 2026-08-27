// ==UserScript==
// @name        Store Resource Sorter
// @namespace   https://screeps.com/
// @grant       none
// @version     0.1.3
// @author      -
// @description Better sorting for the resource list in the inspector
// @run-at      document-ready
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1787872416684
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/store-resource-sorter.user.js?v=1787872416684
// @downloadURL https://screepers.github.io/screeps-browser-ext/store-resource-sorter.user.js?v=1787872416684
// ==/UserScript==




const myOrder = ["energy","power","ops","O","H","Z","L","U","K","X","G","OH","ZK","UL","KH","KH2O","XKH2O","KO","KHO2","XKHO2","UH","UH2O","XUH2O","UO","UHO2","XUHO2","LH","LH2O","XLH2O","LO","LHO2","XLHO2","ZH","ZH2O","XZH2O","ZO","ZHO2","XZHO2","GH","GH2O","XGH2O","GO","GHO2","XGHO2","battery","oxidant","reductant","zynthium_bar","lemergium_bar","utrium_bar","keanium_bar","purifier","ghodium_melt","composite","crystal","liquid"];

/**
 * @param {{ store: Record<string, number>} | null | undefined} obj
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

ScreepsAdapter.ready(() => {
    console.warn("Store Resources Sorter: Loaded");

    // Must run during the selection digest, before the inspector renders store keys.
    ScreepsAdapter.onSelectionChange(({ object }) => {
        sortResources(/** @type {{ store: Record<string, number> } | null} */ (object));
    }, { immediate: true });
});

