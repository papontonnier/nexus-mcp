import type { ConfigFile, Dependency, Detection, ManifestType } from "./types.js";
import type { ManifestSignals } from "./manifests.js";
import { isSensitiveFile } from "./paths.js";

type Rule = [name: string, category: string];
const NPM: Record<string, Rule> = {
  react: ["React", "frontend"], next: ["Next.js", "fullstack"], vue: ["Vue", "frontend"], nuxt: ["Nuxt", "fullstack"],
  "@angular/core": ["Angular", "frontend"], svelte: ["Svelte", "frontend"], "@sveltejs/kit": ["SvelteKit", "fullstack"],
  "solid-js": ["Solid", "frontend"], preact: ["Preact", "frontend"], astro: ["Astro", "fullstack"], "@remix-run/react": ["Remix", "fullstack"],
  express: ["Express", "backend"], fastify: ["Fastify", "backend"], "@nestjs/core": ["NestJS", "backend"], koa: ["Koa", "backend"],
  hono: ["Hono", "backend"], "@hapi/hapi": ["hapi", "backend"], electron: ["Electron", "desktop"],
  "react-native": ["React Native", "mobile"], expo: ["Expo", "mobile"],
  "@modelcontextprotocol/sdk": ["MCP SDK", "ai"], "@anthropic-ai/sdk": ["Anthropic SDK", "ai"], openai: ["OpenAI SDK", "ai"], langchain: ["LangChain", "ai"],
  graphql: ["GraphQL", "api"], "@apollo/server": ["Apollo Server", "api"], "@trpc/server": ["tRPC", "api"], zod: ["Zod", "validation"],
  prisma: ["Prisma", "data"], "@prisma/client": ["Prisma", "data"], typeorm: ["TypeORM", "data"], sequelize: ["Sequelize", "data"],
  mongoose: ["Mongoose", "data"], "drizzle-orm": ["Drizzle ORM", "data"], knex: ["Knex", "data"], pg: ["PostgreSQL client", "data"],
  mysql2: ["MySQL client", "data"], "better-sqlite3": ["SQLite", "data"],
  tailwindcss: ["Tailwind CSS", "styling"], "styled-components": ["styled-components", "styling"], sass: ["Sass", "styling"],
  "lucide-react": ["Lucide", "ui"], "@mui/material": ["Material UI", "ui"], antd: ["Ant Design", "ui"],
  vite: ["Vite", "build"], webpack: ["webpack", "build"], rollup: ["Rollup", "build"], esbuild: ["esbuild", "build"],
  parcel: ["Parcel", "build"], turbo: ["Turborepo", "build"], nx: ["Nx", "build"], typescript: ["TypeScript", "language"], tsx: ["tsx", "tooling"],
  jest: ["Jest", "testing"], vitest: ["Vitest", "testing"], mocha: ["Mocha", "testing"], "@playwright/test": ["Playwright", "testing"],
  playwright: ["Playwright", "testing"], cypress: ["Cypress", "testing"], "@testing-library/react": ["Testing Library", "testing"],
  eslint: ["ESLint", "quality"], prettier: ["Prettier", "quality"], "@biomejs/biome": ["Biome", "quality"]
};
const JVM: [RegExp, ...Rule][] = [
  [/^org\.springframework\.boot:/, "Spring Boot", "backend"], [/^org\.springframework(?!\.boot)[\w.]*:/, "Spring Framework", "backend"],
  [/^io\.quarkus/, "Quarkus", "backend"], [/^io\.micronaut/, "Micronaut", "backend"], [/^jakarta\.(?:ws|servlet|persistence|platform)/, "Jakarta EE", "backend"],
  [/^org\.apache\.camel/, "Apache Camel", "integration"], [/^org\.apache\.kafka:|:spring-kafka$/, "Apache Kafka", "integration"],
  [/^org\.hibernate/, "Hibernate", "data"], [/^org\.flywaydb:/, "Flyway", "data"], [/^org\.liquibase:/, "Liquibase", "data"],
  [/^org\.postgresql:/, "PostgreSQL driver", "data"], [/^com\.h2database:/, "H2", "data"], [/^org\.apache\.poi:/, "Apache POI", "data"],
  [/^com\.fasterxml\.jackson/, "Jackson", "serialization"], [/^org\.projectlombok:/, "Lombok", "tooling"],
  [/^org\.junit|^junit:/, "JUnit", "testing"], [/^org\.mockito:/, "Mockito", "testing"], [/^org\.testcontainers:/, "Testcontainers", "testing"],
  [/^org\.jetbrains\.kotlin:/, "Kotlin", "language"]
];
const PYPI: Record<string, Rule> = {
  django: ["Django", "backend"], flask: ["Flask", "backend"], fastapi: ["FastAPI", "backend"], starlette: ["Starlette", "backend"],
  djangorestframework: ["Django REST framework", "api"], celery: ["Celery", "integration"], sqlalchemy: ["SQLAlchemy", "data"],
  pandas: ["pandas", "data"], numpy: ["NumPy", "data"], polars: ["Polars", "data"], openpyxl: ["openpyxl", "data"], jupyter: ["Jupyter", "data"],
  "scikit-learn": ["scikit-learn", "ai"], mcp: ["MCP SDK", "ai"], anthropic: ["Anthropic SDK", "ai"], openai: ["OpenAI SDK", "ai"], langchain: ["LangChain", "ai"],
  pydantic: ["Pydantic", "validation"], streamlit: ["Streamlit", "frontend"], pytest: ["pytest", "testing"],
  ruff: ["Ruff", "quality"], black: ["Black", "quality"], mypy: ["mypy", "quality"]
};
const CATEGORY_ORDER = ["fullstack", "frontend", "backend", "mobile", "desktop", "ai", "api", "integration", "data", "validation", "serialization", "styling", "ui", "build", "testing", "quality", "language", "tooling"];

class Detections {
  private readonly found = new Map<string, Detection>();
  add(name: string, category: string, evidence: string) {
    const detection = this.found.get(name) ?? { name, category, evidence: [] };
    if (detection.evidence.length < 5 && !detection.evidence.includes(evidence)) detection.evidence.push(evidence);
    this.found.set(name, detection);
  }
  list(): Detection[] {
    const rank = (category: string) => { const index = CATEGORY_ORDER.indexOf(category); return index < 0 ? CATEGORY_ORDER.length : index; };
    return [...this.found.values()].sort((a, b) => rank(a.category) - rank(b.category));
  }
}
const normalizePython = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

export function detectFrameworks(dependencies: Dependency[], configPaths: string[] = []): Detection[] {
  const found = new Detections();
  for (const dependency of dependencies) {
    const evidence = `${dependency.manifest}: ${dependency.name}`;
    if (dependency.ecosystem === "npm") { const rule = NPM[dependency.name]; if (rule) found.add(rule[0], rule[1], evidence); }
    else if (dependency.ecosystem === "pypi") { const rule = PYPI[normalizePython(dependency.name)]; if (rule) found.add(rule[0], rule[1], evidence); }
    else for (const [pattern, name, category] of JVM) if (pattern.test(dependency.name)) found.add(name, category, evidence);
  }
  const CONFIG_FRAMEWORKS: [RegExp, ...Rule][] = [
    [/(^|\/)next\.config\.\w+$/i, "Next.js", "fullstack"], [/(^|\/)nuxt\.config\.\w+$/i, "Nuxt", "fullstack"], [/(^|\/)angular\.json$/i, "Angular", "frontend"],
    [/(^|\/)svelte\.config\.\w+$/i, "Svelte", "frontend"], [/(^|\/)astro\.config\.\w+$/i, "Astro", "fullstack"]
  ];
  for (const file of configPaths) for (const [pattern, name, category] of CONFIG_FRAMEWORKS) if (pattern.test(file)) found.add(name, category, file);
  return found.list();
}

const CONFIG_RULES: [RegExp, string][] = [
  [/(^|\/)tsconfig(\.[\w-]+)?\.json$/i, "TypeScript"], [/(^|\/)jsconfig\.json$/i, "JavaScript"],
  [/(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.\w+|biome\.jsonc?|\.flake8|ruff\.toml|mypy\.ini|checkstyle\.xml)$/i, "Linting"],
  [/(^|\/)(\.prettierrc(\.\w+)?|prettier\.config\.\w+)$/i, "Formatting"],
  [/(^|\/)(jest|vitest|playwright|cypress)\.config\.\w+$|(^|\/)(pytest\.ini|tox\.ini)$/i, "Testing"],
  [/(^|\/)(vite|webpack|rollup|tsup|babel|postcss|tailwind|next|nuxt|svelte|astro|remix)\.config\.\w+$|(^|\/)(\.babelrc|angular\.json|makefile|cmakelists\.txt)$/i, "Build & tooling"],
  [/(^|\/)(settings\.gradle(\.kts)?|gradle\.properties|gradle\/libs\.versions\.toml|gradle\/wrapper\/gradle-wrapper\.properties|\.mvn\/wrapper\/maven-wrapper\.properties|\.mvn\/maven\.config)$/i, "Build & tooling"],
  [/(^|\/)(setup\.cfg|setup\.py|pipfile)$/i, "Python packaging"],
  [/(^|\/)(pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/i, "Workspace"],
  [/(^|\/)(\.nvmrc|\.node-version|\.python-version|\.tool-versions|\.sdkmanrc|\.java-version)$/i, "Runtime"],
  [/(^|\/)(dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile|\.dockerignore|(docker-)?compose(\.[\w-]+)?\.ya?ml)$/i, "Container"],
  [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)(\.gitlab-ci\.yml|jenkinsfile|azure-pipelines\.ya?ml|bitbucket-pipelines\.yml|\.travis\.yml)$|(^|\/)\.circleci\/config\.yml$/i, "CI/CD"],
  [/(^|\/)(application|bootstrap)(-[\w-]+)?\.(properties|ya?ml)$|(^|\/)(logback(-spring)?\.xml|log4j2?\.(xml|properties))$/i, "Application"],
  [/(^|\/)(openapi|swagger)\.(json|ya?ml)$/i, "API specification"],
  [/(^|\/)(\.editorconfig|\.vscode\/[^/]+\.json)$/i, "Editor"],
  [/(^|\/)(\.gitignore|\.gitattributes|\.gitmodules)$/i, "Git"],
  [/(^|\/)(\.npmrc|\.yarnrc(\.yml)?|\.pypirc)$/i, "Package manager"],
  [/(^|\/)\.env(rc|\.[\w.-]+)?$/i, "Environment"]
];
const BUILD_RULES: [RegExp, string][] = [
  [/(^|\/)(pom\.xml|mvnw(\.cmd)?)$/i, "Maven"], [/(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradlew(\.bat)?)$/i, "Gradle"],
  [/(^|\/)vite\.config\.\w+$/i, "Vite"], [/(^|\/)webpack\.config\.\w+$/i, "webpack"], [/(^|\/)rollup\.config\.\w+$/i, "Rollup"],
  [/(^|\/)tsup\.config\.\w+$/i, "tsup"], [/(^|\/)tsconfig(\.[\w-]+)?\.json$/i, "TypeScript compiler"], [/(^|\/)turbo\.json$/i, "Turborepo"],
  [/(^|\/)nx\.json$/i, "Nx"], [/(^|\/)makefile$/i, "Make"], [/(^|\/)cmakelists\.txt$/i, "CMake"],
  [/(^|\/)(dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i, "Docker"], [/(^|\/)setup\.py$/i, "setuptools"],
  [/(^|\/)cargo\.toml$/i, "Cargo"], [/(^|\/)go\.mod$/i, "Go toolchain"], [/\.(csproj|fsproj|vbproj|sln)$/i, "MSBuild"]
];
const PACKAGE_MANAGER_RULES: [RegExp, string][] = [
  [/(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml)$/i, "pnpm"], [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/i, "npm"],
  [/(^|\/)(yarn\.lock|\.yarnrc\.yml)$/i, "Yarn"], [/(^|\/)bun\.lockb?$/i, "Bun"],
  [/(^|\/)pom\.xml$/i, "Maven"], [/(^|\/)build\.gradle(\.kts)?$/i, "Gradle"],
  [/(^|\/)requirements[\w.-]*\.txt$/i, "pip"], [/(^|\/)poetry\.lock$/i, "Poetry"], [/(^|\/)uv\.lock$/i, "uv"],
  [/(^|\/)pdm\.lock$/i, "PDM"], [/(^|\/)pipfile(\.lock)?$/i, "Pipenv"], [/(^|\/)cargo\.toml$/i, "Cargo"],
  [/(^|\/)go\.mod$/i, "Go modules"], [/(^|\/)composer\.json$/i, "Composer"], [/(^|\/)gemfile$/i, "Bundler"], [/\.(csproj|fsproj)$/i, "NuGet"]
];
const BUILD_BACKENDS: [RegExp, string][] = [
  [/^hatchling/, "Hatch"], [/^poetry/, "Poetry"], [/^setuptools/, "setuptools"], [/^flit/, "Flit"], [/^pdm/, "PDM"], [/^maturin/, "maturin"]
];
const JS_MANAGERS = ["pnpm", "npm", "Yarn", "Bun"];

export type ManifestInfo = { path: string; type: ManifestType; signals: ManifestSignals };
export type StackDetection = { configFiles: ConfigFile[]; buildTools: Detection[]; packageManagers: Detection[]; monorepo: boolean };

export function detectStack(paths: string[], manifests: ManifestInfo[], maxConfigFiles = 200): StackDetection {
  const configFiles: ConfigFile[] = [];
  const buildTools = new Detections(), packageManagers = new Detections();
  for (const file of paths) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    const rule = CONFIG_RULES.find(([pattern]) => pattern.test(file));
    if (rule && configFiles.length < maxConfigFiles) configFiles.push({ path: file, kind: rule[1], sensitive: isSensitiveFile(name) });
    for (const [pattern, tool] of BUILD_RULES) if (pattern.test(file)) buildTools.add(tool, "build", file);
    for (const [pattern, manager] of PACKAGE_MANAGER_RULES) if (pattern.test(file)) packageManagers.add(manager, "package-manager", file);
  }
  for (const manifest of manifests) {
    const { signals } = manifest;
    const declared = /^(pnpm|npm|yarn|bun)@/i.exec(signals.packageManager ?? "")?.[1].toLowerCase();
    if (declared) packageManagers.add(JS_MANAGERS.find(m => m.toLowerCase() === declared)!, "package-manager", `${manifest.path}#packageManager`);
    if (signals.poetry) packageManagers.add("Poetry", "package-manager", `${manifest.path}#tool.poetry`);
    if (signals.uv) packageManagers.add("uv", "package-manager", `${manifest.path}#tool.uv`);
    const backend = BUILD_BACKENDS.find(([pattern]) => pattern.test(signals.buildBackend ?? ""));
    if (backend) buildTools.add(backend[1], "build", `${manifest.path}#build-system`);
  }
  const managers = packageManagers.list();
  const firstPackageJson = manifests.find(m => m.type === "package.json");
  if (firstPackageJson && !managers.some(m => JS_MANAGERS.includes(m.name))) {
    packageManagers.add("npm", "package-manager", `${firstPackageJson.path} (no lockfile found)`);
  }
  const directories = new Map<string, Set<string>>();
  for (const manifest of manifests) {
    const set = directories.get(manifest.type) ?? new Set<string>();
    directories.set(manifest.type, set.add(manifest.path.slice(0, Math.max(0, manifest.path.lastIndexOf("/")))));
  }
  const monorepo = paths.some(p => /(^|\/)(pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/i.test(p))
    || manifests.some(m => m.signals.workspaces || (m.signals.modules ?? 0) > 0)
    || [...directories.values()].some(set => set.size > 1);
  return { configFiles, buildTools: buildTools.list(), packageManagers: packageManagers.list(), monorepo };
}

const join = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const HEADLINE_CATEGORIES = new Set(["fullstack", "frontend", "backend", "mobile", "desktop", "ai", "api", "integration", "data"]);

/** One deterministic sentence describing the stack (no AI involved). */
export function describeProject(input: { language?: string; monorepo: boolean; frameworks: Detection[]; packageManagers: Detection[]; buildTools: Detection[] }): string {
  const frameworks = input.frameworks.filter(f => HEADLINE_CATEGORIES.has(f.category)).slice(0, 4).map(f => f.name);
  const managers = input.packageManagers.slice(0, 2).map(m => m.name);
  const builders = input.buildTools.filter(b => !managers.includes(b.name)).slice(0, 2).map(b => b.name);
  let sentence = `${input.language ?? "Unclassified"} ${input.monorepo ? "monorepo" : "project"}`;
  if (frameworks.length) sentence += ` using ${join(frameworks)}`;
  const tail = [managers.length ? `managed with ${join(managers)}` : "", builders.length ? `built with ${join(builders)}` : ""].filter(Boolean);
  return sentence + (tail.length ? `, ${tail.join(", ")}` : "") + ".";
}
