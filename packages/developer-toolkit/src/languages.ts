import type { LanguageCategory, LanguageStat } from "./types.js";
import { extensionOf } from "./paths.js";

type Language = [name: string, category: LanguageCategory];
const P = "programming", M = "markup", D = "data", T = "prose";
const BY_EXTENSION: Record<string, Language> = {
  ts: ["TypeScript", P], tsx: ["TypeScript", P], mts: ["TypeScript", P], cts: ["TypeScript", P],
  js: ["JavaScript", P], jsx: ["JavaScript", P], mjs: ["JavaScript", P], cjs: ["JavaScript", P],
  java: ["Java", P], kt: ["Kotlin", P], kts: ["Kotlin", P], groovy: ["Groovy", P], gradle: ["Groovy", P], scala: ["Scala", P],
  py: ["Python", P], pyi: ["Python", P], ipynb: ["Jupyter Notebook", P], r: ["R", P],
  go: ["Go", P], rs: ["Rust", P], cs: ["C#", P], fs: ["F#", P], vb: ["Visual Basic", P],
  php: ["PHP", P], rb: ["Ruby", P], swift: ["Swift", P], dart: ["Dart", P], lua: ["Lua", P], pl: ["Perl", P],
  ex: ["Elixir", P], exs: ["Elixir", P], erl: ["Erlang", P], clj: ["Clojure", P], hs: ["Haskell", P],
  c: ["C", P], h: ["C", P], cpp: ["C++", P], cc: ["C++", P], cxx: ["C++", P], hpp: ["C++", P], hh: ["C++", P],
  sql: ["SQL", P], sh: ["Shell", P], bash: ["Shell", P], zsh: ["Shell", P], ps1: ["PowerShell", P], psm1: ["PowerShell", P],
  bat: ["Batchfile", P], cmd: ["Batchfile", P], vue: ["Vue", P], svelte: ["Svelte", P], astro: ["Astro", P],
  html: ["HTML", M], htm: ["HTML", M], css: ["CSS", M], scss: ["SCSS", M], sass: ["Sass", M], less: ["Less", M],
  xsl: ["XSLT", M], xslt: ["XSLT", M],
  json: ["JSON", D], jsonc: ["JSON", D], json5: ["JSON", D], yaml: ["YAML", D], yml: ["YAML", D], toml: ["TOML", D],
  xml: ["XML", D], xsd: ["XML", D], ini: ["INI", D], cfg: ["INI", D], properties: ["Properties", D],
  csv: ["CSV", D], tsv: ["CSV", D], graphql: ["GraphQL", D], gql: ["GraphQL", D], proto: ["Protocol Buffers", D],
  md: ["Markdown", T], mdx: ["Markdown", T], rst: ["reStructuredText", T], adoc: ["AsciiDoc", T], txt: ["Text", T]
};
const BY_NAME: Record<string, Language> = {
  dockerfile: ["Dockerfile", P], makefile: ["Makefile", P], jenkinsfile: ["Groovy", P], "cmakelists.txt": ["CMake", P]
};

export function languageOf(name: string): Language | undefined {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith("dockerfile.")) return BY_NAME.dockerfile;
  return BY_EXTENSION[extensionOf(name)];
}

/** Aggregates bytes per language. Code (programming + markup) and data/prose are reported separately so lockfiles do not skew percentages. */
export function languageStats(files: { name: string; size?: number }[]): { languages: LanguageStat[]; dataFormats: LanguageStat[] } {
  const totals = new Map<string, LanguageStat>();
  for (const file of files) {
    const language = languageOf(file.name);
    if (!language) continue;
    const stat = totals.get(language[0]) ?? { name: language[0], category: language[1], files: 0, bytes: 0, percent: 0 };
    stat.files++; stat.bytes += file.size ?? 0;
    totals.set(language[0], stat);
  }
  const group = (code: boolean) => {
    const stats = [...totals.values()].filter(s => (s.category === "programming" || s.category === "markup") === code);
    const bytes = stats.reduce((sum, s) => sum + s.bytes, 0);
    for (const s of stats) s.percent = bytes ? Math.round(s.bytes / bytes * 1000) / 10 : 0;
    return stats.sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.name.localeCompare(b.name));
  };
  return { languages: group(true), dataFormats: group(false) };
}
