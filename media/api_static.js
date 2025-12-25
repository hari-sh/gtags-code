const api = (function () {
    // Static data dictionary simulating tag lookups
    const data = {
        "__SYMBOL__": [
            { name: "main", file: "main.c", line: 10 },
            { name: "init", file: "init.c", line: 20 },
            { name: "utils", file: "utils.c", line: 5 }
        ],
        "main": [
            { name: "setup", file: "main.c", line: 15 },
            { name: "loop", file: "main.c", line: 30 }
        ],
        "init": [
            { name: "config", file: "init.c", line: 25 },
            { name: "validate", file: "init.c", line: 40 }
        ],
        "utils": [
            { name: "helper", file: "utils.c", line: 12 }
        ],
        "setup": [],
        "loop": [],
        "config": [],
        "validate": [],
        "helper": []
    };

    return {
        getTags: function (tagName) {
            console.log(`[StaticAPI] getTags called for: ${tagName}`);
            return new Promise((resolve) => {
                // Simulate network delay
                setTimeout(() => {
                    const result = data[tagName] || [];
                    console.log(`[StaticAPI] returning:`, result);
                    resolve(result);
                }, 200);
            });
        },

        postFileData: function (postData) {
            console.log("[StaticAPI] postFileData called with:", postData);
            // No-op for standalone
        }
    };
})();
