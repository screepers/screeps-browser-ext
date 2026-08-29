// ==UserScript==
// @name        Screeps Birthday viewer
// @namespace   https://screeps.com
// @version     0.1.4
// @description This adds a creep's birthday to the inspector
// @author      Traxus, various
// @run-at      document-ready
// @grant       none
// @require     https://screepers.github.io/screeps-browser-ext/screeps-browser-core.js?v=1788012368535
// @match       https://screeps.com/a/*
// @match       https://screeps.com/ptr/*
// @match       https://screeps.com/season/*
// @include     /^http://[^/]*?\.localhost:[^/]*?/\(.*?\)/.*?$/
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @updateURL   https://screepers.github.io/screeps-browser-ext/birthday-viewer.user.js?v=1788012368535
// @downloadURL https://screepers.github.io/screeps-browser-ext/birthday-viewer.user.js?v=1788012368535
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
}

/**
 * Derive a creation timestamp from a Mongo-style ObjectId.
 * @param {string} id
 */
function birthDateFromId(id) {
    if (typeof id !== "string" || id.length < 8) return null;
    const ms = parseInt(id.substr(0, 8), 16) * 1000;
    if (!Number.isFinite(ms)) return null;
    return new Date(ms);
}

/**
 * @param {{ _id?: string } | null | undefined} obj
 */
function injectBdayLabel(obj) {
    if (!obj?._id) return;

    const birthDate = birthDateFromId(obj._id);
    if (!birthDate) return;

    const target = $(".object-properties .aside-block-content")[0];
    if (!target) return;

    const elem = $('<div class="ng-binding ng-scope birthday-viewer"><label>Born: </label>' + formatDate(birthDate) + "</div>");
    const insertBefore = target.children.length > 1
        ? target.children[2]
        : target.children[0]?.children?.[2];

    if (insertBefore) {
        elem.insertBefore(insertBefore);
    } else {
        $(target).prepend(elem);
    }
}

// Entry point
ScreepsAdapter.ready(() => {
    ScreepsAdapter.onSelectionChange(({ object }) => {
        injectBdayLabel(/** @type {{ _id?: string } | null} */ (object));
    });
});
