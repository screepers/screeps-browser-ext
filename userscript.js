
const USERSCRIPT_START_MARKER = '==UserScript==';
const USERSCRIPT_END_MARKER = '==/UserScript==';

class Header {
    /** @type {string} */
    name;
    /** @type {string} */
    value;
    index = 0;

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
        this.headers.push(new Header(name, value))
    }

    /**
     * @param {string} name
     */
    #getHeaders(name) {
        return this.headers.filter(h => h.name === name) ?? [];
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
     */
    getAll(name) {
        const headers = this.#getHeaders(name);
        const all = headers.map((h, idx) => { h.index = idx; return h; });
        return all;
    }

    /**
     * @param {string} name
     * @param {string} value
     * @param {number} [index]
     */
    set(name, value, index = 0) {
        let headers = this.#getHeaders(name);
        if (headers.length === 0) {
            return;
        }
        if (headers.length === 1) {
            headers[0].value = value;
            return;
        }
        if (index === undefined) {
            throw new Error(`no index given for multi-header set`);
        } else if (index < 0 || index >= headers.length) {
            throw new Error(`index out of bounds for multi-header set`);
        }
        headers[index].value = value;
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
      console.info('marker end not found');
      this.#script = contents;
      return;
    }
    const nextNewline = contents.indexOf("\n", end);
    if (nextNewline === -1) {
      console.info('next newline not found');
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
      const [_startIndex, endIndex] = match.indices?.[0] ?? [0, 0];
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
         * @returns {[value: string, index: number][]}
         */
        getAll(name) {
            return self.#headers.getAll(name)?.map(h => [h.value, h.index]) ?? [];
        },
        /**
         * @param {string} name
         * @param {string} value
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
