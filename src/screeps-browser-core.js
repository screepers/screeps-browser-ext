window.DomHelper = window.DomHelper || {};
(function(DomHelper) {
    function waitForAngular() {
        return new Promise(resolve => {
            const check = () => {
                const injector = angular.element(document.body).injector();
                if (injector) {
                    resolve(injector);
                } else {
                    setTimeout(check, 20);
                }
            };
            check();
        });
    }
    DomHelper.addStyle = function (css) {
        let head = document.head;
        if (!head) return;

        let style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;

        head.appendChild(style);
    }

    DomHelper.generateCompiledElement = function(parent, content) {
        let $scope = parent.scope();
        let $compile = parent.injector().get("$compile");
        return $compile(content)($scope);
    }
})(DomHelper);

window.ScreepsAdapter = window.ScreepsAdapter || {};
(function(ScreepsAdapter) {
    function waitForAngular() {
        return new Promise(resolve => {
            const check = () => {
                const injector = angular.element(document.body).injector();
                if (injector) {
                    resolve(injector);
                } else {
                    setTimeout(check, 20);
                }
            };
            check();
        });
    }

    // Listen for changes to the main screeps view
    // Examples: roomEntered, scriptClick, consoleClick, worldMapEntered, simulationMainMenu, gameLobby
    ScreepsAdapter.onViewChange = function (callback) {

        waitForAngular().then(() => {
            let rootScope = angular.element(document.body).scope();
            if (!rootScope.viewChangeCallbacks) {
                let tutorial = angular.element(document.body).injector().get("Tutorial");
                console.log("Overriding Tutorial.trigger");

                // intercept events as they are passed to the tutorial popup manager
                tutorial._trigger = tutorial.trigger;
                tutorial.trigger = function(triggerName, unknownB) {
                    for (let i in rootScope.viewChangeCallbacks) {
                        rootScope.viewChangeCallbacks[i](triggerName);
                    }
                    tutorial._trigger(triggerName, unknownB);
                };

                rootScope.viewChangeCallbacks = [];
            }

            rootScope.viewChangeCallbacks.push(callback);
        });
    };

    ScreepsAdapter.onHashChange = function (callback) {
        waitForAngular().then(() => {
            const rootScope = angular.element(document.body).scope();
            if (!rootScope.hashChangeCallbacks) {
                rootScope.$watch(() => window.location.hash, function(newVal, oldVal) {
                    for (let i in rootScope.hashChangeCallbacks) {
                        rootScope.hashChangeCallbacks[i](window.location.hash);
                    }
                });
                
                rootScope.hashChangeCallbacks = [];
            }
            
            rootScope.hashChangeCallbacks.push(callback);
        });
    };

    ScreepsAdapter.onRoomChange = function (callback) {
        ScreepsAdapter.onHashChange((hash) => {
            let rootScope = angular.element(document.body).scope();
            let $routeParams = angular.element(document.body).injector().get("$routeParams");
            let room = $routeParams.room;
            if (room !== rootScope.lastRoom) {
                callback(room);
                rootScope.lastRoom = room;
            }
        });
    };

    // aliases to angular services
    Object.defineProperty(ScreepsAdapter, "User", {
        get: function() {
            delete this.User;
            Object.defineProperty(this, "User", {
                value: angular.element(document.body).scope().Me()
            });
            return this.User;
        },
        configurable: true
    });

    // Define a couple properties for quick access
    ["$timeout", "$routeSegment", "$location", "Api", "Connection", "Console", "MapUtils", "Socket"].forEach((key) => {
        Object.defineProperty(ScreepsAdapter, key, {
            get: function() {
                return angular.element(document.body).injector().get(key)
            },
            configurable: true
        });
    });
})(ScreepsAdapter);
