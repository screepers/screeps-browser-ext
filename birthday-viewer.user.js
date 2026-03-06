// ==UserScript==
// @name        Screeps Birthday viewer
// @namespace   https://screeps.com
// @version     0.1.1
// @description This adds a creep's birthday to the inspector
// @author      Traxus, various
// @run-at      document-ready
// @grant       none
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @match       http://*.localhost:*/(*)/#!/*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1772834456225
// @downloadUrl https://screepers.github.io/screeps-browser-ext/gui-extender.js?v=1772834456225
// ==/UserScript==



// Original from https://github.com/screepers/screeps-snippets/blob/master/src/client-abuse/JavaScript/util.inject.Birthday.js

log("TamperMonkey - Loaded Birthday Viewer");

/**
 * @param  {...any} args
 */
function log(...args) {
    console.warn(...args);
}

/**
 * @param {Date} d
 */
function formatDate(d) {
    return ("0" + d.getUTCHours()).slice(-2)+":"+("0" + d.getUTCMinutes()).slice(-2)+":"+("0" + d.getUTCSeconds()).slice(-2) + " " +
        ("0" + (d.getUTCMonth()+1)).slice(-2)+"/"+("0" + d.getUTCDate()).slice(-2)+"/"+d.getUTCFullYear() + " UTC";
};

function showBdayInternal() {
    let gameEl = angular.element($('section.game'));
    let roomEl = angular.element($('section.room'));
    let $rootScope = gameEl.injector().get('$rootScope');
    let $compile = gameEl.injector().get('$compile');
    let target = $('.object-properties .aside-block-content')[0];
    let elem = $('<div class="ng-binding ng-scope"><label>BirthDate: </label>' + formatDate(new Date(parseInt(roomEl.scope().Room.selectedObject._id.substr(0,8), 16)*1000)) + '</div>');
    $compile(elem)($rootScope);
    if(target.children.length > 1) {
        elem.insertBefore(target.children[2]);
    } else {
        elem.insertBefore(target.children[0].children[2]);
    }
}

// Entry point
ScreepsAdapter.ready(() => {
    ScreepsAdapter.onViewChange((view) => {
        ScreepsAdapter.$timeout(() => {
            if (view == 'view' && $('.object-properties .aside-block-content')[0]) {
                showBdayInternal();
            }
        }, 100);
    });
});
