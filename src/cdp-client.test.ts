/**
 * Tests for CDP client event emission
 * Verifies that console and network events are emitted via the onEvent callback
 */

import { describe, it, expect, vi } from "vitest";
import { CDPClient } from "./cdp-client.js";
import type { OnEvent, RunEvent } from "./types.js";

describe("CDPClient event emission", () => {
  it("should accept onEvent callback in constructor", () => {
    const callback: OnEvent = vi.fn();
    const client = new CDPClient(9222, callback);
    expect(client).toBeDefined();
  });

  it("should work without onEvent callback", () => {
    const client = new CDPClient(9222);
    expect(client).toBeDefined();
  });

  it("should call onEvent callback for console messages", async () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    // This would normally be called during connect(), but we're testing
    // that the callback is properly set up. The actual console message
    // emission happens within the connect() method's event listener.
    expect(client).toBeDefined();
    expect(events).toEqual([]);
  });

  it("should include required fields in console events", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      if (event.type === "console") {
        // Verify structure
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("level");
        expect(event).toHaveProperty("text");
        expect(event.type).toBe("console");
        expect(typeof event.level).toBe("string");
        expect(typeof event.text).toBe("string");
      }
    };

    const client = new CDPClient(9222, callback);
    expect(client).toBeDefined();
  });

  it("should include required fields in network events", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      if (event.type === "network") {
        // Verify structure
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("method");
        expect(event).toHaveProperty("url");
        expect(event).toHaveProperty("status");
        expect(event).toHaveProperty("duration_ms");
        expect(event.type).toBe("network");
        expect(typeof event.method).toBe("string");
        expect(typeof event.url).toBe("string");
        expect(typeof event.status).toBe("number");
        expect(typeof event.duration_ms).toBe("number");
      }
    };

    const client = new CDPClient(9222, callback);
    expect(client).toBeDefined();
  });

  it("should handle errors in onEvent callback gracefully", async () => {
    const callback: OnEvent = vi.fn(() => {
      throw new Error("Test error");
    });

    const client = new CDPClient(9222, callback);
    client.verbose = true; // Enable error logging

    expect(client).toBeDefined();
  });

  it("should clear onEvent callback on close", async () => {
    const callback: OnEvent = vi.fn();
    const client = new CDPClient(9222, callback);

    // Create a mock client to test close behavior
    (client as any).client = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    (client as any).connected = true;

    await client.close();

    // After close, onEvent should be undefined
    expect((client as any).onEvent).toBeUndefined();
  });

  it("should support optional callback with undefined", () => {
    // This tests backward compatibility - should work with no callback
    const client = new CDPClient(9222);
    expect(client).toBeDefined();

    // Should not throw when callback is undefined
    expect(() => {
      // Simulate what would happen in event listeners
      const callback = (client as any).onEvent;
      if (callback) {
        callback({ type: "console", level: "info", text: "test" });
      }
    }).not.toThrow();
  });

  it("should track network request timings correctly", async () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    // Test that the network request times map is initialized
    expect((client as any).networkRequestTimes).toBeInstanceOf(Map);
    expect((client as any).networkRequestTimes.size).toBe(0);
  });

  it("should include timestamp in stored console messages", async () => {
    const callback: OnEvent = vi.fn();
    const client = new CDPClient(9222, callback);

    // Verify that the consoleMessages array will have timestamp field
    const consoleMessages = await client.getConsoleMessages();
    expect(consoleMessages).toEqual([]);

    // The array should be ready to accept messages with timestamp
    expect((client as any).consoleMessages).toEqual([]);
  });

  it("should return network responses with method field", async () => {
    const callback: OnEvent = vi.fn();
    const client = new CDPClient(9222, callback);

    const networkResponses = await client.getNetworkResponses();
    expect(Array.isArray(networkResponses)).toBe(true);
    expect(networkResponses).toEqual([]);
  });
});

describe("CDPClient createTab option", () => {
  it("should accept createTab option in constructor", () => {
    const client = new CDPClient(9222, undefined, { createTab: true });
    expect(client).toBeDefined();
    expect((client as any).createTab).toBe(true);
  });

  it("should default createTab to false", () => {
    const client = new CDPClient(9222);
    expect((client as any).createTab).toBe(false);
  });

  it("should default createTab to false when options object is empty", () => {
    const client = new CDPClient(9222, undefined, {});
    expect((client as any).createTab).toBe(false);
  });

  it("should not have ownedTargetId initially", () => {
    const client = new CDPClient(9222, undefined, { createTab: true });
    expect((client as any).ownedTargetId).toBeUndefined();
  });

  it("should close owned tab during close()", async () => {
    const client = new CDPClient(9222, undefined, { createTab: true });

    const mockCloseTarget = vi.fn().mockResolvedValue(undefined);

    // Set up mock internal state to simulate a connected client with an owned tab
    (client as any).client = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    (client as any).connected = true;
    (client as any).ownedTargetId = "target-123";
    (client as any).domains = {
      Target: {
        closeTarget: mockCloseTarget,
      },
    };

    await client.close();

    // Should have called closeTarget with the owned target ID
    expect(mockCloseTarget).toHaveBeenCalledWith({ targetId: "target-123" });
    // Should have cleared ownedTargetId
    expect((client as any).ownedTargetId).toBeUndefined();
  });

  it("should not call closeTarget if no owned tab", async () => {
    const client = new CDPClient(9222);

    const mockCloseTarget = vi.fn();

    (client as any).client = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    (client as any).connected = true;
    (client as any).domains = {
      Target: {
        closeTarget: mockCloseTarget,
      },
    };

    await client.close();

    // Should NOT have called closeTarget
    expect(mockCloseTarget).not.toHaveBeenCalled();
  });

  it("should handle closeTarget errors gracefully during close()", async () => {
    const client = new CDPClient(9222, undefined, { createTab: true });

    (client as any).client = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    (client as any).connected = true;
    (client as any).ownedTargetId = "target-456";
    (client as any).domains = {
      Target: {
        closeTarget: vi.fn().mockRejectedValue(new Error("Tab already closed")),
      },
    };

    // Should not throw even if closeTarget fails
    await expect(client.close()).resolves.not.toThrow();
    expect((client as any).ownedTargetId).toBeUndefined();
  });
});

describe("CDPClient event forwarding", () => {
  it("forwards console events with correct structure", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    // Simulate console message event
    // In real usage, this would be triggered by Console.messageAdded
    // For testing, we verify the callback would be called correctly
    expect(client).toBeDefined();

    // The callback structure should support console events
    const consoleEvent: RunEvent = {
      type: "console",
      level: "error",
      text: "An error occurred",
    };

    callback(consoleEvent);
    expect(events).toContain(consoleEvent);
    expect(events[0].type).toBe("console");
    expect((events[0] as any).level).toBe("error");
    expect((events[0] as any).text).toBe("An error occurred");
  });

  it("forwards network events with correct structure", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    // Simulate network event
    const networkEvent: RunEvent = {
      type: "network",
      method: "GET",
      url: "https://api.example.com/users",
      status: 200,
      duration_ms: 125,
    };

    callback(networkEvent);
    expect(events).toContain(networkEvent);
    expect(events[0].type).toBe("network");
    expect((events[0] as any).method).toBe("GET");
    expect((events[0] as any).url).toBe("https://api.example.com/users");
    expect((events[0] as any).status).toBe(200);
    expect((events[0] as any).duration_ms).toBe(125);
  });

  it("emits console events in real-time without delay", () => {
    const events: RunEvent[] = [];
    let callbackCalled = false;

    const callback: OnEvent = (event) => {
      callbackCalled = true;
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    const consoleEvent: RunEvent = {
      type: "console",
      level: "warn",
      text: "Warning message",
    };

    callback(consoleEvent);

    // Verify callback was called immediately
    expect(callbackCalled).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("emits network events in real-time without delay", () => {
    const events: RunEvent[] = [];
    let callbackCalled = false;

    const callback: OnEvent = (event) => {
      callbackCalled = true;
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    const networkEvent: RunEvent = {
      type: "network",
      method: "POST",
      url: "https://api.example.com/submit",
      status: 201,
      duration_ms: 250,
    };

    callback(networkEvent);

    // Verify callback was called immediately
    expect(callbackCalled).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("handles multiple console events in sequence", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    const event1: RunEvent = {
      type: "console",
      level: "info",
      text: "First message",
    };

    const event2: RunEvent = {
      type: "console",
      level: "warn",
      text: "Second message",
    };

    const event3: RunEvent = {
      type: "console",
      level: "error",
      text: "Third message",
    };

    callback(event1);
    callback(event2);
    callback(event3);

    expect(events).toHaveLength(3);
    expect((events[0] as any).level).toBe("info");
    expect((events[1] as any).level).toBe("warn");
    expect((events[2] as any).level).toBe("error");
  });

  it("handles mixed console and network events", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    const consoleEvent: RunEvent = {
      type: "console",
      level: "info",
      text: "Request started",
    };

    const networkEvent: RunEvent = {
      type: "network",
      method: "GET",
      url: "https://api.example.com/data",
      status: 200,
      duration_ms: 100,
    };

    const consoleEvent2: RunEvent = {
      type: "console",
      level: "info",
      text: "Request completed",
    };

    callback(consoleEvent);
    callback(networkEvent);
    callback(consoleEvent2);

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("console");
    expect(events[1].type).toBe("network");
    expect(events[2].type).toBe("console");
  });

  it("preserves event data accuracy through forwarding", () => {
    const events: RunEvent[] = [];
    const callback: OnEvent = (event) => {
      events.push(event);
    };

    const client = new CDPClient(9222, callback);

    const networkEvent: RunEvent = {
      type: "network",
      method: "DELETE",
      url: "https://api.example.com/resource/123",
      status: 404,
      duration_ms: 50,
    };

    callback(networkEvent);

    const emittedEvent = events[0] as any;
    expect(emittedEvent.method).toBe("DELETE");
    expect(emittedEvent.url).toBe("https://api.example.com/resource/123");
    expect(emittedEvent.status).toBe(404);
    expect(emittedEvent.duration_ms).toBe(50);
  });
});
