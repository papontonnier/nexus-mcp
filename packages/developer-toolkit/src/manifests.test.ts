import test from "node:test";
import assert from "node:assert/strict";
import { manifestTypeOf, parseGradle, parseManifest, parsePackageJson, parsePomXml, parsePyproject, parseRequirements } from "./manifests.js";
import { parseToml } from "./toml.js";

const pick = (deps: { name: string; version: string | null; scope: string }[]) => deps.map(d => [d.name, d.version, d.scope]);

test("recognizes supported manifest file names", () => {
  assert.equal(manifestTypeOf("package.json"), "package.json");
  assert.equal(manifestTypeOf("build.gradle.kts"), "build.gradle.kts");
  assert.equal(manifestTypeOf("requirements-dev.txt"), "requirements.txt");
  assert.equal(manifestTypeOf("dev-requirements.txt"), "requirements.txt");
  assert.equal(manifestTypeOf("package-lock.json"), undefined);
  assert.equal(manifestTypeOf("notes.txt"), undefined);
});

test("package.json: scopes, package manager and redacted URLs", () => {
  const parsed = parsePackageJson(JSON.stringify({
    name: "@acme/app", version: "1.2.0", packageManager: "pnpm@10.0.0", workspaces: ["packages/*"],
    dependencies: { react: "^19.0.0", private: "git+https://user:token@github.com/acme/private.git" },
    devDependencies: { vite: "^6.2.0" }, peerDependencies: { "react-dom": ">=18" }, optionalDependencies: { fsevents: "2.3.3" }
  }));
  assert.equal(parsed.packageName, "@acme/app");
  assert.deepEqual(parsed.signals, { packageManager: "pnpm@10.0.0", workspaces: true });
  assert.deepEqual(pick(parsed.dependencies), [
    ["react", "^19.0.0", "production"], ["private", "git+https://***@github.com/acme/private.git", "production"],
    ["vite", "^6.2.0", "development"], ["react-dom", ">=18", "peer"], ["fsevents", "2.3.3", "optional"]
  ]);
  assert.match(parseManifest("package.json", "package.json", "{ not json").warnings[0], /Could not parse package\.json/);
});

test("pom.xml: properties, parent version, scopes, management and comments", () => {
  const parsed = parsePomXml(`<?xml version="1.0"?>
<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.0</version></parent>
  <groupId>com.acme</groupId><artifactId>billing</artifactId>
  <properties><jackson.version>2.17.1</jackson.version></properties>
  <modules><module>core</module><module>api</module></modules>
  <dependencyManagement><dependencies>
    <dependency><groupId>org.testcontainers</groupId><artifactId>testcontainers-bom</artifactId><version>1.19.8</version><type>pom</type><scope>import</scope></dependency>
  </dependencies></dependencyManagement>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>
    <dependency><groupId>com.acme</groupId><artifactId>billing-core</artifactId><version>\${project.version}</version></dependency>
    <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><scope>provided</scope></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
    <!-- <dependency><groupId>commented</groupId><artifactId>out</artifactId></dependency> -->
  </dependencies>
  <build><plugins><plugin><artifactId>maven-surefire-plugin</artifactId><dependencies><dependency><groupId>plugin</groupId><artifactId>only</artifactId></dependency></dependencies></plugin></plugins></build>
</project>`);
  assert.equal(parsed.packageName, "com.acme:billing");
  assert.equal(parsed.packageVersion, "3.3.0");
  assert.equal(parsed.signals.modules, 2);
  assert.deepEqual(pick(parsed.dependencies), [
    ["org.testcontainers:testcontainers-bom", "1.19.8", "managed"],
    ["org.springframework.boot:spring-boot-starter-web", null, "production"],
    ["com.fasterxml.jackson.core:jackson-databind", "2.17.1", "production"],
    ["com.acme:billing-core", "3.3.0", "production"],
    ["org.projectlombok:lombok", null, "provided"],
    ["org.junit.jupiter:junit-jupiter", null, "development"]
  ]);
  assert.match(parseManifest("pom.xml", "pom.xml", "<html></html>").warnings[0], /No <project> element/);
});

test("Gradle: Groovy and Kotlin DSL notations", () => {
  const groovy = parseGradle(`
plugins { id 'org.springframework.boot' version '3.3.0' }
ext {
    poiVersion = '5.2.5'
}
configurations {
    testImplementation.extendsFrom compileOnly
}
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation "org.apache.poi:poi-ooxml:$poiVersion" // Excel exports
    implementation group: 'com.google.guava', name: 'guava', version: '33.0.0-jre'
    implementation project(':core')
    compileOnly 'org.projectlombok:lombok:1.18.32'
    annotationProcessor 'org.projectlombok:lombok:1.18.32'
    testImplementation platform('org.junit:junit-bom:5.10.2')
    testImplementation 'org.junit.jupiter:junit-jupiter'
    implementation fileTree(dir: 'libs', include: ['*.jar'])
}`);
  assert.deepEqual(pick(groovy.dependencies), [
    ["org.springframework.boot:spring-boot-starter-web", null, "production"],
    ["org.apache.poi:poi-ooxml", "5.2.5", "production"],
    ["com.google.guava:guava", "33.0.0-jre", "production"],
    [":core", null, "production"],
    ["org.projectlombok:lombok", "1.18.32", "provided"],
    ["org.projectlombok:lombok", "1.18.32", "build"],
    ["org.junit:junit-bom", "5.10.2", "managed"],
    ["org.junit.jupiter:junit-jupiter", null, "development"]
  ]);
  assert.deepEqual(groovy.warnings, []);
  const kotlin = parseGradle(`
val ktorVersion = "2.3.11"
dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation(kotlin("stdlib"))
    implementation(libs.jackson.databind)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}`);
  assert.deepEqual(pick(kotlin.dependencies), [
    ["io.ktor:ktor-server-core", "2.3.11", "production"],
    ["org.jetbrains.kotlin:kotlin-stdlib", null, "production"],
    ["libs.jackson.databind", null, "production"],
    ["org.junit.platform:junit-platform-launcher", null, "development"]
  ]);
});

test("requirements.txt: specifiers, extras, markers, options and URLs", () => {
  const parsed = parseRequirements(`# data stack
--index-url https://user:secret@pypi.example.com/simple
-r base.txt
pandas[excel]>=2.0,<3 ; python_version >= "3.9"
numpy==1.26.4 --hash=sha256:abc
requests
legacy (>=1.0)
private @ https://user:token@example.com/private.whl
git+https://github.com/acme/tool.git#egg=acme-tool
-e ./local-package
???
`);
  assert.deepEqual(pick(parsed.dependencies), [
    ["pandas", ">=2.0,<3", "production"], ["numpy", "==1.26.4", "production"], ["requests", null, "production"],
    ["legacy", ">=1.0", "production"], ["private", "(direct reference)", "production"], ["acme-tool", "(direct reference)", "production"]
  ]);
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
  assert.equal(JSON.stringify(parsed).includes("token"), false);
  assert.deepEqual(parsed.warnings, ["Unrecognized requirement: ???", "1 editable, URL or local path requirement(s) not analyzed"]);
  assert.equal(parseRequirements("pytest>=8", "requirements-dev.txt").dependencies[0].scope, "development");
});

test("pyproject.toml: PEP 621, optional groups, Poetry, uv and build system", () => {
  const parsed = parsePyproject(`
[build-system]
requires = ["hatchling>=1.24"]
build-backend = "hatchling.build"

[project]
name = "finance-sync"
version = "0.3.0"
dependencies = [
  "fastapi>=0.110",   # API
  'openpyxl',
]

[project.optional-dependencies]
dev = ["pytest>=8"]
excel = ["xlsxwriter>=3"]

[dependency-groups]
lint = ["ruff>=0.4", { include-group = "dev" }]

[tool.poetry.dependencies]
python = "^3.11"
httpx = { version = "^0.27", optional = true }

[tool.poetry.group.test.dependencies]
pytest-cov = "^5.0"

[tool.uv]
dev-dependencies = ["mypy>=1.10"]
`);
  assert.equal(parsed.packageName, "finance-sync");
  assert.deepEqual(parsed.signals, { poetry: true, uv: true, buildBackend: "hatchling.build" });
  assert.deepEqual(pick(parsed.dependencies), [
    ["fastapi", ">=0.110", "production"], ["openpyxl", null, "production"],
    ["pytest", ">=8", "development"], ["xlsxwriter", ">=3", "optional"], ["ruff", ">=0.4", "development"],
    ["httpx", "^0.27", "optional"], ["pytest-cov", "^5.0", "development"],
    ["mypy", ">=1.10", "development"], ["hatchling", ">=1.24", "build"]
  ]);
  assert.match(parseManifest("pyproject.toml", "pyproject.toml", "[project\nname = 1").warnings[0], /Could not parse pyproject\.toml/);
});

test("TOML reader does not pollute prototypes", () => {
  const parsed = parseToml(`[__proto__]\npolluted = true\n[a]\n"__proto__" = { polluted = true }\n`);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.keys(parsed).includes("__proto__"), true);
});
