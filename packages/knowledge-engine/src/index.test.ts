import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeStore } from "./index.js";
test("import, search, version and remove", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-knowledge-"));
  try {
    const store = new KnowledgeStore(root);
    const first = await store.import("notes.md", Buffer.from("# Jedox\nForecast planning and budgets"));
    assert.equal(first.currentVersion, 1);
    assert.equal((await store.search("forecast")).length, 1);
    const next = await store.import("notes.md", Buffer.from("# Jedox\nForecast planning and rolling budget"), first.id);
    assert.equal(next.currentVersion, 2);
    assert.equal((await store.get(first.id, 1)).content.includes("rolling"), false);
    assert.equal((await store.get(first.id)).content.includes("rolling"), true);
    assert.equal((await store.list()).length, 1);
    await store.remove(first.id);
    assert.equal((await store.list()).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("reject unsafe names and unsupported formats", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-knowledge-"));
  try {
    const store = new KnowledgeStore(root);
    await assert.rejects(store.import("../escape.txt", Buffer.from("hello")), /Invalid/);
    await assert.rejects(store.import("image.png", Buffer.from("hello")), /Supported/);
    await assert.rejects(store.import("empty.txt", Buffer.alloc(0)), /1 byte/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
