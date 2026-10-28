// Minimal TOML reader covering what Python manifests use: tables, arrays of tables, dotted keys,
// strings, numbers, booleans, arrays and inline tables. Tables have a null prototype so keys such as
// "__proto__" in an untrusted file cannot pollute Object.prototype.
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export type TomlTable = { [key: string]: TomlValue };

const newTable = () => Object.create(null) as TomlTable;
const isTable = (value: unknown): value is TomlTable => !!value && typeof value === "object" && !Array.isArray(value);
const BARE_KEY = /[A-Za-z0-9_-]+/y;
const SCALAR = /[^\s,\]}#]+/y;
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" };

class Reader {
  private pos = 0;
  private nesting = 0;
  constructor(private readonly s: string) {}

  private fail(message: string): never {
    throw new Error(`${message} (line ${this.s.slice(0, this.pos).split("\n").length})`);
  }
  private peek(offset = 0) { return this.s[this.pos + offset]; }
  private skipInline() { while (this.peek() === " " || this.peek() === "\t") this.pos++; }
  private skipComment() { if (this.peek() === "#") while (this.pos < this.s.length && this.peek() !== "\n") this.pos++; }
  private skipBlank() {
    for (;;) {
      this.skipInline(); this.skipComment();
      if (this.peek() === "\n" || this.peek() === "\r") this.pos++; else return;
    }
  }
  private endOfLine() {
    this.skipInline(); this.skipComment();
    if (this.peek() === "\r") this.pos++;
    if (this.pos < this.s.length && this.peek() !== "\n") this.fail("Expected end of line");
    this.pos++;
  }

  document(): TomlTable {
    const root = newTable();
    let current = root;
    for (;;) {
      this.skipBlank();
      if (this.pos >= this.s.length) return root;
      if (this.peek() === "[") {
        const array = this.peek(1) === "[", close = array ? "]]" : "]";
        this.pos += close.length;
        const keys = this.key();
        if (!this.s.startsWith(close, this.pos)) this.fail("Unterminated table header");
        this.pos += close.length;
        current = array ? this.appendTable(root, keys) : this.table(root, keys);
      } else {
        const keys = this.key();
        if (this.peek() !== "=") this.fail("Expected '='");
        this.pos++; this.skipInline();
        this.assign(current, keys, this.value());
      }
      this.endOfLine();
    }
  }

  private key(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipInline();
      const c = this.peek();
      if (c === '"') keys.push(this.basicString());
      else if (c === "'") keys.push(this.literalString());
      else {
        BARE_KEY.lastIndex = this.pos;
        const match = BARE_KEY.exec(this.s);
        if (!match) this.fail("Invalid key");
        keys.push(match[0]); this.pos += match[0].length;
      }
      this.skipInline();
      if (this.peek() !== ".") return keys;
      this.pos++;
    }
  }

  private descend(table: TomlTable, key: string): TomlTable {
    let value = Object.hasOwn(table, key) ? table[key] : (table[key] = newTable());
    if (Array.isArray(value)) value = value[value.length - 1];
    if (!isTable(value)) this.fail(`Key "${key}" is not a table`);
    return value;
  }
  private table(root: TomlTable, keys: string[]) { return keys.reduce((table, key) => this.descend(table, key), root); }
  private appendTable(root: TomlTable, keys: string[]): TomlTable {
    const parent = this.table(root, keys.slice(0, -1)), last = keys[keys.length - 1];
    const list = Object.hasOwn(parent, last) ? parent[last] : (parent[last] = []);
    if (!Array.isArray(list)) this.fail(`Key "${last}" is not an array of tables`);
    const table = newTable();
    list.push(table);
    return table;
  }
  private assign(table: TomlTable, keys: string[], value: TomlValue) {
    this.table(table, keys.slice(0, -1))[keys[keys.length - 1]] = value;
  }

  private value(): TomlValue {
    const c = this.peek();
    if (c === '"') return this.s.startsWith('"""', this.pos) ? this.multiline('"""') : this.basicString();
    if (c === "'") return this.s.startsWith("'''", this.pos) ? this.multiline("'''") : this.literalString();
    if (c === "[" || c === "{") {
      if (++this.nesting > 32) this.fail("Nesting too deep");
      const value = c === "[" ? this.array() : this.inlineTable();
      this.nesting--;
      return value;
    }
    SCALAR.lastIndex = this.pos;
    const match = SCALAR.exec(this.s);
    if (!match) this.fail("Expected a value");
    this.pos += match[0].length;
    const raw = match[0];
    if (raw === "true" || raw === "false") return raw === "true";
    const number = Number(raw.replace(/_/g, ""));
    return /^[+-]?[\d_]+(?:\.[\d_]+)?(?:[eE][+-]?\d+)?$/.test(raw) && Number.isFinite(number) ? number : raw;
  }
  private basicString(): string {
    let out = "";
    this.pos++;
    for (;;) {
      const c = this.s[this.pos++];
      if (c === undefined || c === "\n") this.fail("Unterminated string");
      if (c === '"') return out;
      if (c !== "\\") { out += c; continue; }
      const e = this.s[this.pos++];
      if (e === "u" || e === "U") {
        const length = e === "u" ? 4 : 8, hex = this.s.slice(this.pos, this.pos + length);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) this.fail("Invalid unicode escape");
        out += String.fromCodePoint(parseInt(hex, 16)); this.pos += length;
      } else if (e in ESCAPES) out += ESCAPES[e];
      else this.fail("Invalid escape");
    }
  }
  private literalString(): string {
    const end = this.s.indexOf("'", this.pos + 1);
    if (end < 0 || this.s.slice(this.pos, end).includes("\n")) this.fail("Unterminated string");
    const out = this.s.slice(this.pos + 1, end);
    this.pos = end + 1;
    return out;
  }
  private multiline(delimiter: string): string {
    const end = this.s.indexOf(delimiter, this.pos + 3);
    if (end < 0) this.fail("Unterminated multi-line string");
    let out = this.s.slice(this.pos + 3, end).replace(/^\r?\n/, "");
    this.pos = end + 3;
    if (delimiter === '"""') out = out.replace(/\\\r?\n\s*/g, "").replace(/\\(["\\ntrbf])/g, (_, e: string) => ESCAPES[e]);
    return out;
  }
  private array(): TomlValue[] {
    const items: TomlValue[] = [];
    this.pos++;
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") { this.pos++; return items; }
      items.push(this.value());
      this.skipBlank();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() === "]") { this.pos++; return items; }
      else this.fail("Expected ',' or ']'");
    }
  }
  private inlineTable(): TomlTable {
    const table = newTable();
    this.pos++;
    for (;;) {
      this.skipBlank();
      if (this.peek() === "}") { this.pos++; return table; }
      const keys = this.key();
      if (this.peek() !== "=") this.fail("Expected '='");
      this.pos++; this.skipInline();
      this.assign(table, keys, this.value());
      this.skipBlank();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() === "}") { this.pos++; return table; }
      else this.fail("Expected ',' or '}'");
    }
  }
}

export function parseToml(text: string): TomlTable {
  return new Reader(text.replace(/^\uFEFF/, "")).document();
}
export { isTable };
