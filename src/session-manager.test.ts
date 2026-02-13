/**
 * Tests for SessionManager write queue and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./session-manager";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-mgr-test-"));
    manager = new SessionManager(tmpDir);
    await manager.load();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch { /* ignore cleanup errors */ }
  });

  it("registers and retrieves a session", async () => {
    await manager.registerSession("sess-1", "target-abc");
    expect(manager.getTargetId("sess-1")).toBe("target-abc");
  });

  it("unregisters a session", async () => {
    await manager.registerSession("sess-1", "target-abc");
    await manager.unregisterSession("sess-1");
    expect(manager.getTargetId("sess-1")).toBeUndefined();
  });

  it("concurrent registerSession calls don't lose data", async () => {
    // Fire many concurrent registrations — all should survive
    const count = 20;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(manager.registerSession(`sess-${i}`, `target-${i}`));
    }
    await Promise.all(promises);

    // Verify all sessions were registered
    for (let i = 0; i < count; i++) {
      expect(manager.getTargetId(`sess-${i}`)).toBe(`target-${i}`);
    }

    // Verify the on-disk file also has all sessions
    const diskManager = new SessionManager(tmpDir);
    await diskManager.load();
    for (let i = 0; i < count; i++) {
      expect(diskManager.getTargetId(`sess-${i}`)).toBe(`target-${i}`);
    }
  });

  it("concurrent mixed operations are serialized correctly", async () => {
    // Register, update, unregister concurrently
    await manager.registerSession("sess-a", "target-a");
    await manager.registerSession("sess-b", "target-b");

    const promises = [
      manager.registerSession("sess-c", "target-c"),
      manager.unregisterSession("sess-a"),
      manager.updateLastUsed("sess-b"),
      manager.registerSession("sess-d", "target-d"),
    ];
    await Promise.all(promises);

    expect(manager.getTargetId("sess-a")).toBeUndefined(); // unregistered
    expect(manager.getTargetId("sess-b")).toBe("target-b"); // still there
    expect(manager.getTargetId("sess-c")).toBe("target-c"); // registered
    expect(manager.getTargetId("sess-d")).toBe("target-d"); // registered
  });

  it("load handles ENOENT gracefully (empty registry)", async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-mgr-enoent-"));
    const freshManager = new SessionManager(freshDir);
    await freshManager.load(); // should not throw
    expect(freshManager.listSessions()).toEqual([]);
    await fs.rm(freshDir, { recursive: true });
  });

  it("load warns on non-ENOENT errors but doesn't throw", async () => {
    // Write invalid JSON to trigger parse error
    const registryPath = path.join(tmpDir, "sessions.json");
    await fs.writeFile(registryPath, "not-valid-json{{{");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const badManager = new SessionManager(tmpDir);
    await badManager.load(); // should not throw
    expect(badManager.listSessions()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not load session registry")
    );

    warnSpy.mockRestore();
  });

  it("persists data across load cycles", async () => {
    await manager.registerSession("sess-1", "target-1");
    await manager.registerSession("sess-2", "target-2");

    // Create a new manager pointing to same directory
    const manager2 = new SessionManager(tmpDir);
    await manager2.load();

    expect(manager2.getTargetId("sess-1")).toBe("target-1");
    expect(manager2.getTargetId("sess-2")).toBe("target-2");
  });
});
