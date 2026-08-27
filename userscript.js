
const USERSCRIPT_START_MARKER = "==UserScript==";
const USERSCRIPT_END_MARKER = "==/UserScript==";

const MULTI_VALUE_HEADERS = new Set([
    "author",
    "connect",
    "exclude",
    "exclude-match",
    "grant",
    "include",
    "match",
    "require",
    "resource",
    "tag",
]);

class Header {
    /** @type {string} */
    name;
    /** @type {string} */
    value;

    /**
     * @param {string} name
     * @param {string} value
     */
    constructor(name, value) {
        this.name = name;
        this.value = value;
    }
}

class HeaderList {
    /** @type {Header[]} */
    headers = [];

    /**
     * @param {string} name
     * @param {string} value
     */
    add(name, value) {
        this.headers.push(new Header(name, value));
    }

    /**
     * @param {string} name
     */
    #getHeaders(name) {
        return this.headers.filter(h => h.name === name);
    }

    /**
     * @param {string} name
     * @param {string} value
     */
    #append(name, value) {
        let last = -1;
        for (let i = 0; i < this.headers.length; i++) {
            if (this.headers[i].name === name) {
                last = i;
            }
        }
        const header = new Header(name, value);
        if (last === -1) {
            this.headers.push(header);
        } else {
            this.headers.splice(last + 1, 0, header);
        }
    }

    /**
     * @param {string} name
     * @param {string[]} values
     */
    #replaceAll(name, values) {
        let insertAt = -1;
        const kept = [];
        for (const header of this.headers) {
            if (header.name === name) {
                if (insertAt === -1) {
                    insertAt = kept.length;
                }
                continue;
            }
            kept.push(header);
        }
        const added = values.map(value => new Header(name, value));
        if (insertAt === -1) {
            this.headers = kept.concat(added);
        } else {
            kept.splice(insertAt, 0, ...added);
            this.headers = kept;
        }
    }

    /**
     * @param {string} name
     */
    get(name) {
        const headers = this.#getHeaders(name);
        if (headers.length !== 1) return null;
        return headers[0].value ?? null;
    }

    /**
     * @param {string} name
     * @returns {string[]}
     */
    getAll(name) {
        return this.#getHeaders(name).map(h => h.value);
    }

    /**
     * Set a header. A string replaces a single-value header (or adds it if missing)
     * and appends to a multi-value header (`@match`, `@include`, `@require`, …).
     * An array replaces every occurrence of that header, keeping the original position.
     *
     * @param {string} name
     * @param {string | string[]} value
     * @param {number} [index]
     */
    set(name, value, index) {
        if (Array.isArray(value)) {
            this.#replaceAll(name, value);
            return;
        }

        const headers = this.#getHeaders(name);
        if (index !== undefined) {
            if (index < 0 || index >= headers.length) {
                throw new Error(`index out of bounds for multi-header set`);
            }
            headers[index].value = value;
            return;
        }

        if (headers.length === 0) {
            this.add(name, value);
            return;
        }
        if (MULTI_VALUE_HEADERS.has(name)) {
            this.#append(name, value);
            return;
        }
        headers[0].value = value;
    }

    /**
     * @param {object} [opts]
     * @param {number} [opts.indentSize]
     */
    output(opts) {
        const { indentSize = 2 } = opts ?? {};
        const prefix = "// ";
        const lines = [];

        lines.push(`${prefix}${USERSCRIPT_START_MARKER}`);

        const longest = Math.max(...this.headers.map(h => h.name.length));
        const columnWidth = Math.ceil((longest + 1) / indentSize) * indentSize;

        for (const header of this.headers) {
            const key = `@${header.name}`.padEnd(columnWidth + 1);
            lines.push(`${prefix}${key}${header.value}`);
        }

        lines.push(`${prefix}${USERSCRIPT_END_MARKER}`);

        return lines.join("\n") + "\n";
    }
}

export class Userscript {
    /** @type {HeaderList} */
    #headers;
    #script;

    /**
     *
     * @param {string} contents
     */
    constructor(contents) {
        this.#headers = new HeaderList();
        const end = contents.indexOf(USERSCRIPT_END_MARKER);
        if (end === -1) {
            console.info("marker end not found");
            this.#script = contents;
            return;
        }
        const nextNewline = contents.indexOf("\n", end);
        if (nextNewline === -1) {
            console.info("next newline not found");
            this.#script = contents;
            return;
        }
        const headers = contents.slice(0, nextNewline);
        this.#script = contents.slice(nextNewline);
        this._parseHeaders(headers);
    }

    /**
     * @param {string} headerBlock
     */
    _parseHeaders(headerBlock) {
        let match;
        let currentIndex = 0;

        while ((match = /^\/\/\s+@(?<name>[-A-Za-z]*)\s+(?<value>.*)$/gmd.exec(headerBlock.slice(currentIndex))) !== null) {
            const { name, value } = match.groups ?? {};
            const [, endIndex] = match.indices?.[0] ?? [0, 0];
            this.#headers.add(name, value);
            currentIndex += endIndex;
        }
    }

    get headers() {
        const self = this;
        return {
            /** @param {string} name  */
            get(name) {
                return self.#headers.get(name);
            },
            /**
             * @param {string} name
             * @returns {string[]}
             */
            getAll(name) {
                return self.#headers.getAll(name);
            },
            /**
             * @param {string} name
             * @param {string} value
             */
            add(name, value) {
                self.#headers.add(name, value);
            },
            /**
             * @param {string} name
             * @param {string | string[]} value
             * @param {number} [index]
             */
            set(name, value, index) {
                self.#headers.set(name, value, index);
            }
        };
    }

    headerBlock() {
        return this.#headers.output();
    }

    contents() {
        return this.#script;
    }

    output() {
        return this.headerBlock() + "\n" + this.#script;
    }
}
