// ==UserScript==
// @name        Screeps improved console history
// @namespace   https://screeps.com/
// @match       https://screeps.com/a/*
// @match       http://*.localhost:*/(*)/#!/*
// @grant       none
// @version     1.0
// @author      -
// @description Gives super-powers to the Console; history that survives across tabs and view changes, a couple @-variables linked to the viewer's state, etc.
// @run-at      document-ready
// @icon        https://www.google.com/s2/favicons?sz=64&domain=screeps.com
// @downloadURL https://gist.github.com/tiennou/405f811e294efbf237725c9b27475898/raw/improved-console-history.user.js
// @require     https://ajax.googleapis.com/ajax/libs/jquery/1.8.3/jquery.min.js
// @require     https://github.com/Esryok/screeps-browser-ext/raw/master/screeps-browser-core.js
// ==/UserScript==

/**
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns
 */
function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

// Polls every 50 milliseconds for a given condition
async function waitFor(condition, pollInterval = 50, timeoutAfter) {
    // Track the start time for timeout purposes
    const startTime = Date.now();

    while (true) {
        // Check for timeout, bail if too much time passed
        if(typeof(timeoutAfter) === 'number' && Date.now() > startTime + timeoutAfter) {
            throw 'Condition not met before timeout';
        }

        // Check for conditon immediately
        const result = await condition();

        // If the condition is met...
        if(result) {
            // Return the result....
            return result;
        }

        // Otherwise wait and check after pollInterval
        await new Promise(r => setTimeout(r, pollInterval));
    }
}

(() => {
    const HISTORY_STORAGE_KEY = "screeps.console-history";
    const MAX_HISTORY_SIZE = 100;
    /** The line we're at in the history */
    let historyIdx = -1;
    /** The thing we were currently typing */
    let buffer = "";

    function loadHistory() {
        const history = /** @type {string[] | undefined} */ (JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]"));
        console.warn(`History loaded, ${history.length} entries found`);
        window.screepsHistory = history; // TODO: remove, debugging only
        return history;
    }
    window.loadHistory = loadHistory;

    function saveHistory(history) {
        console.warn(`Saving history`, history);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }

    function clearHistory() {
        historyIdx = -1;
        buffer = "";
        saveHistory([]);
        console.warn(`History cleared`);
    }
    window.clearHistory = clearHistory;

    function getCurrentRoom() {
        return angular.element(document.querySelector('.room.ng-scope')).scope().Room;
    }

    function getGame() {
        return angular.element(document.querySelector('.game.ng-scope')).scope().Game;
    }

    function selectedObject() {
        const obj = getCurrentRoom().selectedObject;
        if (!obj) throw new Error("No object selected!");
        return obj;
    }

    function getConnection() {
        const injector = angular.element(document.body).injector();
        return injector.get("Connection");
    }

    const Range = ace.require("ace/range").Range;

    function addMarker(start, end) {
        console.warn(`addMarker: ${start}-${end}`);
        aceEditor.getSession().addMarker(new Range(1, start, 1, end), "subst-error-highlight", "text", true);
    }

    function clearMarkers() {
        const session = aceEditor.getSession();
        const markers = session.getMarkers(true);
        for (const markerId in markers) {
            if (markers[markerId].clazz === "subst-error-highlight") {
                session.removeMarker(markerId);
            }
        }
        console.warn(`clearMarkers`);
    }

    /**
     * @param {string} line
     * @returns
     */
    function substituteVariables(line) {
        const variables = {
            "(?<![\w\"'])@r(?![\w\"])": () => `"${getCurrentRoom().roomName}"`,
            "(?<![\w\"'])@s(?![\w\"])": () => `"${getCurrentRoom().shardName}"`,
            "(?<![\w\"'])@i(?![\w\"])": () => `"${selectedObject()._id}"`,
            "(?<![\w\"'])@p(?![\w\"])": () => {
                const obj = selectedObject();
                return `${obj.x}, ${obj.y}, "${obj.room}"`
            },
        }

        let hasError = false;
        for (const v in variables) {
            const regex = new RegExp(v, "g")
            try {
                let replacement = variables[v]();
                line = line.replaceAll(regex, replacement);
            } catch (e) {
                for (const match of [...line.matchAll(regex)]) {
                    addMarker(match.index, match.index + match[0].length);
                    hasError = true
                }
            }
        }
        if (hasError) {
            throw new Error("Substitution error");
        }
        console.warn(`final line: ${line}`);
        return line;
    }

    function executeCommand(line) {
        console.warn(`Executing "${line}"`);
        const game = getGame();
        getConnection().sendConsoleCommand(line, game.player);
    }

    /**
     * @param {string} line
     */
    function appendCommand(line) {
        console.warn(`appending command: ${line}`);
        const history = loadHistory();

        // If same as a saved line, yank it so it moves to the top of the stack
        const dupIdx = history.findIndex(l => l === line);
        if (dupIdx !== -1) {
            console.warn(`Found dup at #${dupIdx}, removing…`);
            history.splice(dupIdx, 1);
        }

        console.warn(`Adding "${line}" to the history`);
        history.unshift(line);
        if (history.length > MAX_HISTORY_SIZE) console.warn(`Too many entries ${history.length - MAX_HISTORY_SIZE}, pruning…`);
        while (history.length > MAX_HISTORY_SIZE)
            history.pop();

        saveHistory(history);
        historyIdx = -1; // Put us back down at the top of the stack
    }

    let timer;
    const setup = () => {
        const consoleEl = document.querySelector('.console.ng-scope'); // "Top.Game.Console"
        if (!consoleEl) {
            timer = setTimeout(setup, 500);
            return
        }
        const consoleScope = angular.element(consoleEl).scope();
        const gameConsole = consoleScope.Console;

        // Stop us from overriding multiple times
        if (gameConsole.extendedHistory) {
            return;
        }
        gameConsole.extendedHistory = true;

        window.gameConsole = gameConsole; // TODO: debugging

        const aceEditor = ace.edit(angular.element('.ace_editor')[1])
        window.aceEditor = aceEditor; // TODO: debugging

        console.warn(`Overriding Console methods`);
        const _sendCommand = gameConsole.sendCommand;
        gameConsole.sendCommand = function() {
            let line = aceEditor.getValue();
            line = line.replace(/\r?\n/g, " ").trim();
            // We substitute first then add to the history so we handle substitution errors first
            const realLine = substituteVariables(line); // FIXME: this might throw. Could be nice to have a way of reporting the issue
            appendCommand(line);
            executeCommand(realLine);
        }

        const _keydown = gameConsole.keydown;
        gameConsole.keydown = function(e) {
            console.warn(`keydown:`, e);
            if (e.keyCode === 38 || e.keyCode === 40) {
                clearMarkers();
                const isPrev = e.keyCode === 38;
                const history = loadHistory();
                if (!history.length) return;
                const lastIdx = historyIdx;
                if (isPrev) {
                    historyIdx = clamp(++historyIdx, -1, history.length - 1);
                } else {
                    historyIdx = clamp(--historyIdx, -1, history.length - 1);
                }

                const value = aceEditor.getValue();
                if (!isPrev && lastIdx === -1 && value === buffer) {
                    // We're at the "editing" entry but it was already restored; clear
                    console.warn("clearing buffer");
                    buffer = "";
                    aceEditor.setValue(buffer);
                    return;
                } else if (!isPrev && lastIdx === 0) {
                    // We're entering the "editing" entry; load it
                    console.warn("restoring buffer");
                    aceEditor.setValue(buffer);
                    return;
                } else if (isPrev && lastIdx === -1) {
                    // We're leaving the "editing" entry; save that
                    console.warn("saving buffer");
                    buffer = aceEditor.getValue();
                }

                const entry = history[historyIdx];
                console.warn(`history entry #${historyIdx}: ${entry ?? '<typing>'}`);
                aceEditor.setValue(entry, 1); // set and place cursor at the end
                return;
            } else if (e.keyCode === 13) {
                this.sendCommand();
                aceEditor.setValue("");
                clearMarkers();
                return;
            }
            _keydown.call(this, e); // Let the game do its thing
        }
        clearTimeout(timer);
    };

    document.addEventListener("readystatechange", async () => {
        await waitFor(() => angular.element(document.body).scope() !== undefined);
        DomHelper.addStyle(`.ace_marker-layer .subst-error-highlight {
            position: absolute;
            background-color: rgba(255, 0, 0, 0.2);
            z-index: 20;
        }`);
        ScreepsAdapter.onViewChange((triggerName) => {
            if (triggerName !== 'roomEntered') {
                return;
            }
            setup();
        });
    });
})();
