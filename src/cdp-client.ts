/**
 * Chrome DevTools Protocol (CDP) client wrapper
 * Provides a high-level interface for interacting with Chrome via CDP
 * Handles navigation, DOM manipulation, evaluation, mocking, and event collection
 */

import CDP from "chrome-remote-interface";
import { OnEvent } from "./types.js";

/**
 * Represents a mock network rule for intercepting and modifying network requests
 */
interface MockRule {
  pattern: RegExp;
  status: number;
  body?: unknown;
  delay?: number;
}

/**
 * Represents a collected console message
 */
interface StoredConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

/**
 * Represents a collected network request with timing
 */
interface StoredNetworkRequest {
  url: string;
  method: string;
  status: number;
  timestamp: number;
  startTime?: number;
}

/**
 * Chrome DevTools Protocol client wrapper
 * Manages connection, navigation, DOM access, and event collection
 */
export class CDPClient {
  private port: number;
  private client: any;
  private domains: any = {};
  private consoleMessages: StoredConsoleMessage[] = [];
  private networkResponses: StoredNetworkRequest[] = [];
  private networkRequestTimes: Map<string, number> = new Map();
  private mockRules: MockRule[] = [];
  private connected: boolean = false;
  public verbose: boolean = false;
  private onEvent?: OnEvent;
  private currentExecutionContextId?: number;
  private dialogHandler?: { action: "accept" | "dismiss"; text?: string };
  private createTab: boolean;
  private ownedTargetId?: string;
  private eventUnsubscribers: Array<() => void> = [];

  /**
   * Creates a new CDP client instance
   * @param port - The port on which Chrome DevTools Protocol server is listening
   * @param onEvent - Optional callback for emitting console and network events
   * @param options - Optional configuration (createTab: create a new Chrome tab for isolation)
   */
  constructor(port: number, onEvent?: OnEvent, options?: { createTab?: boolean }) {
    this.port = port;
    this.onEvent = onEvent;
    this.createTab = options?.createTab ?? false;
  }

  /**
   * Converts a glob pattern to a RegExp
   * Simple conversion: asterisk becomes .*, ? becomes .
   * @param pattern - The glob pattern
   * @returns A RegExp that matches the pattern
   */
  private globToRegExp(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
      .replace(/\*/g, ".*") // * becomes .*
      .replace(/\?/g, "."); // ? becomes .
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Escapes a string for safe use in HTML attribute values
   */
  private escapeAttrValue(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Wraps an event handler with error boundary to prevent handler errors from crashing tests
   * @param handler - The event handler function to wrap
   * @param eventName - Name of the event for error logging
   * @returns Wrapped handler that catches and logs errors
   */
  private wrapEventListener<T>(
    handler: (data: T) => void,
    eventName: string
  ): (data: T) => void {
    return (data: T) => {
      try {
        handler(data);
      } catch (err) {
        if (this.verbose) {
          console.error(`Error in ${eventName} event handler: ${err}`);
        }
        // Continue execution - don't let handler errors crash tests
      }
    };
  }

  /**
   * Cleans up all registered event listeners
   * Should be called before reconnecting or closing to prevent listener accumulation
   */
  private cleanupEventListeners(): void {
    for (const unsubscribe of this.eventUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe errors (connection may be dead)
      }
    }
    this.eventUnsubscribers = [];
  }

  /**
   * Connects to Chrome DevTools Protocol
   * Retrieves the first page target, attaches to it,
   * and enables necessary domains (Console, Network, Fetch)
   * @param _url - Unused, kept for interface compatibility
   * @throws If connection fails or attachment fails
   */
  async connect(_url: string): Promise<void> {
    try {
      // Close existing connection if reconnecting to avoid leaking
      if (this.client) {
        try {
          await this.client.close();
        } catch {
          // Ignore close errors on stale connection
        }
        this.client = null;
        this.connected = false;
      }

      // Clean up old event listeners before registering new ones
      this.cleanupEventListeners();

      // Clear accumulated state from previous runs
      this.consoleMessages = [];
      this.networkResponses = [];
      this.mockRules = [];
      this.networkRequestTimes.clear();
      this.currentExecutionContextId = undefined;
      this.dialogHandler = undefined;

      // Connect to the Chrome DevTools Protocol
      this.client = await CDP({ port: this.port });

      // Get list of targets (pages/tabs)
      const { Target, Page, Console, Network, Fetch, DOM, Runtime, Input } =
        this.client;

      // Store domain instances
      this.domains = {
        Target,
        Page,
        Console,
        Network,
        Fetch,
        DOM,
        Runtime,
        Input,
      };

      // Determine target: create a new tab or find an existing page target
      let targetId: string;

      if (this.createTab) {
        const created = await Target.createTarget({ url: "about:blank" });
        targetId = created.targetId;
        this.ownedTargetId = targetId;
      } else {
        // Existing behavior: find the first page target
        const targets = await Target.getTargets();
        if (!targets.targetInfos || targets.targetInfos.length === 0) {
          throw new Error("No targets available");
        }

        const pageTarget = targets.targetInfos.find(
          (t: any) => t.type === "page"
        );
        targetId = pageTarget
          ? pageTarget.targetId
          : targets.targetInfos[0].targetId;
      }

      // Attach to the target to get a sessionId
      const { sessionId } = await Target.attachToTarget({
        targetId,
        flatten: true,
      });

      // Store the session ID for later use
      this.client.sessionId = sessionId;

      // Enable domains
      await Console.enable();
      await Network.enable();
      await Page.enable();
      await DOM.enable();
      await Runtime.enable();
      await Fetch.enable({
        patterns: [{ urlPattern: "*" }],
      });

      // Set up listeners for console messages
      const consoleHandler = this.wrapEventListener((message: any) => {
        const consoleMessage = message.message;
        const messageText = consoleMessage.text || "";
        const messageLevel = consoleMessage.level;

        this.consoleMessages.push({
          type: messageLevel,
          text: messageText,
          timestamp: Date.now(),
        });

        // Emit console event in real-time
        if (this.onEvent) {
          try {
            this.onEvent({
              type: "console",
              level: messageLevel,
              text: messageText,
            });
          } catch (err) {
            // Silently ignore listener errors to prevent test execution issues
            if (this.verbose) {
              console.error(`Error in onEvent callback: ${err}`);
            }
          }
        }
      }, "Console.messageAdded");
      const unsubConsole = Console.messageAdded(consoleHandler);
      this.eventUnsubscribers.push(unsubConsole);

      // Set up listeners for network responses
      const requestWillBeSentHandler = this.wrapEventListener((request: any) => {
        // Track when requests start for duration calculation
        const requestId = request.requestId;
        this.networkRequestTimes.set(requestId, Date.now());
      }, "Network.requestWillBeSent");
      const unsubRequestWillBeSent = Network.requestWillBeSent(requestWillBeSentHandler);
      this.eventUnsubscribers.push(unsubRequestWillBeSent);

      const responseReceivedHandler = this.wrapEventListener((response: any) => {
        const requestId = response.requestId;
        const responseUrl = response.response.url;
        const responseStatus = response.response.status;
        const responseMethod = response.response.requestHeaders
          ? Object.keys(response.response.requestHeaders).length > 0
            ? "GET" // Default if not available in response
            : "GET"
          : "GET";

        // Get actual method from request info if available
        let method = responseMethod;
        if (response.response.method) {
          method = response.response.method;
        }

        const startTime = this.networkRequestTimes.get(requestId);
        const duration_ms = startTime ? Date.now() - startTime : 0;

        this.networkResponses.push({
          url: responseUrl,
          method,
          status: responseStatus,
          timestamp: Date.now(),
          startTime,
        });

        // Emit network event in real-time
        if (this.onEvent) {
          try {
            this.onEvent({
              type: "network",
              method,
              url: responseUrl,
              status: responseStatus,
              duration_ms,
            });
          } catch (err) {
            // Silently ignore listener errors to prevent test execution issues
            if (this.verbose) {
              console.error(`Error in onEvent callback: ${err}`);
            }
          }
        }

        // Clean up tracking data
        this.networkRequestTimes.delete(requestId);
      }, "Network.responseReceived");
      const unsubResponseReceived = Network.responseReceived(responseReceivedHandler);
      this.eventUnsubscribers.push(unsubResponseReceived);

      // Set up listener for fetch requests (for mocking)
      const requestPausedHandler = this.wrapEventListener((request: any) => {
        this.handleMockRequest(request).catch((err) => {
          console.error(`Unhandled error in mock request handler: ${err}`);
        });
      }, "Fetch.requestPaused");
      const unsubRequestPaused = Fetch.requestPaused(requestPausedHandler);
      this.eventUnsubscribers.push(unsubRequestPaused);

      // Set up listener for JavaScript dialogs (alert/confirm/prompt)
      const dialogOpeningHandler = this.wrapEventListener(() => {
        const handler = this.dialogHandler ?? { action: "dismiss" };
        Page.handleJavaScriptDialog({
          accept: handler.action === "accept",
          ...(handler.text != null ? { promptText: handler.text } : {}),
        }).catch((err: any) => {
          if (this.verbose) {
            console.error(`Error handling dialog: ${err}`);
          }
        });
      }, "Page.javascriptDialogOpening");
      const unsubDialogOpening = Page.javascriptDialogOpening(dialogOpeningHandler);
      this.eventUnsubscribers.push(unsubDialogOpening);

      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to CDP: ${error}`);
    }
  }

  /**
   * Handles mock network requests by checking against registered mock rules
   * If a rule matches, responds with the mock data; otherwise, continues the request
   * @param request - The request object from Fetch.requestPaused
   */
  private async handleMockRequest(request: any): Promise<void> {
    // Skip if connection is closing/closed to avoid WebSocket errors
    if (!this.connected) return;

    const { requestId, request: req } = request;
    const url = req.url;
    const method = req.method;

    // Log all intercepted requests when verbose
    if (this.verbose) {
      console.log(`[CDP:Fetch] ${method} ${url.substring(0, 120)}`);
    }

    // Check if any mock rule matches this URL
    for (const rule of this.mockRules) {
      if (rule.pattern.test(url)) {
        if (this.verbose) {
          console.log(`[CDP:Mock] MATCH ${method} ${url.substring(0, 80)} → ${rule.status}`);
        }

        // CORS preflight: respond with 204 + CORS headers, no body
        if (method === "OPTIONS") {
          try {
            await this.domains.Fetch.fulfillRequest({
              requestId,
              responseCode: 204,
              responseHeaders: [
                { name: "Access-Control-Allow-Origin", value: "*" },
                { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
                { name: "Access-Control-Allow-Headers", value: "*" },
                { name: "Access-Control-Max-Age", value: "86400" },
              ],
            });
          } catch (error) {
            try {
              await this.domains.Fetch.continueRequest({ requestId });
            } catch {
              // Request may already be handled or cancelled
            }
          }
          return;
        }

        // Match found - respond with mock data
        const body = typeof rule.body === "string"
          ? rule.body
          : rule.body != null
            ? JSON.stringify(rule.body)
            : "";

        try {
          if (rule.delay != null && rule.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, rule.delay));
          }

          await this.domains.Fetch.fulfillRequest({
            requestId,
            responseCode: rule.status,
            responseHeaders: [
              {
                name: "Content-Type",
                value: "application/json",
              },
              {
                name: "Access-Control-Allow-Origin",
                value: "*",
              },
              {
                name: "Access-Control-Allow-Methods",
                value: "GET, POST, PUT, DELETE, PATCH, OPTIONS",
              },
              {
                name: "Access-Control-Allow-Headers",
                value: "*",
              },
            ],
            body: Buffer.from(body).toString("base64"),
          });
        } catch (error) {
          // If fulfilling fails, try to continue the request to avoid hanging
          try {
            await this.domains.Fetch.continueRequest({ requestId });
          } catch {
            // Request may already be handled or cancelled
          }
          console.error(`Failed to fulfill mock request: ${error}`);
        }

        return;
      }
    }

    // No mock rule matched - continue with the original request
    if (this.verbose) {
      console.log(`[CDP:Fetch] PASS ${method} ${url.substring(0, 80)}`);
    }
    try {
      await this.domains.Fetch.continueRequest({ requestId });
    } catch (error) {
      // Request may already be handled or cancelled
      console.error(`Failed to continue request: ${error}`);
    }
  }

  /**
   * Navigates to a URL and waits for the page to load
   * @param url - The URL to navigate to
   * @throws If navigation times out or fails
   */
  async navigate(url: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { Page } = this.domains;
    const timeout = 30000; // 30 seconds

    try {
      // Set up load event listener BEFORE navigating to avoid race conditions
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Navigation timeout")), timeout);
      });

      const loadPromise = Promise.race([
        new Promise<void>((resolve) => {
          Page.loadEventFired(() => resolve());
        }),
        timeoutPromise,
      ]);

      // Suppress unhandled rejection on the timeout promise if loadEventFired wins
      timeoutPromise.catch(() => {});

      // Call Page.navigate
      const result = await Page.navigate({ url });

      if (result.errorText) {
        if (timeoutId) clearTimeout(timeoutId);
        throw new Error(`Navigation error: ${result.errorText}`);
      }

      // Wait for load event
      try {
        await loadPromise;
      } finally {
        // Always clear the timeout to prevent dangling timers
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (error) {
      throw new Error(`Failed to navigate to ${url}: ${error}`);
    }
  }

  /**
   * Evaluates JavaScript in the current execution context (main frame or iframe).
   * Used internally by evaluate(), fill(), select(), etc.
   */
  private async evaluateInContext(expression: string): Promise<any> {
    const { Runtime } = this.domains;

    const evalOptions: any = {
      expression,
      returnByValue: true,
      awaitPromise: true,
    };

    if (this.currentExecutionContextId != null) {
      evalOptions.contextId = this.currentExecutionContextId;
    }

    const result = await Runtime.evaluate(evalOptions);

    if (result.exceptionDetails) {
      throw new Error(
        `Evaluation error: ${result.exceptionDetails.text}`
      );
    }

    return result;
  }

  /**
   * Evaluates JavaScript code in the page context
   * @param expression - The JavaScript expression to evaluate
   * @returns The result of the evaluation
   * @throws If evaluation fails or throws an exception
   */
  async evaluate(expression: string): Promise<unknown> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    try {
      const result = await this.evaluateInContext(expression);

      // Return the value
      if (result.result.type === "undefined") {
        return undefined;
      }

      return result.result.value;
    } catch (error) {
      throw new Error(`Failed to evaluate: ${error}`);
    }
  }

  /**
   * Fills a form field with a value
   * Handles text inputs, textareas, and other input types
   * @param selector - CSS selector for the element to fill
   * @param value - The value to fill in
   * @throws If element is not found or fill operation fails
   */
  async fill(selector: string, value: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { DOM, Runtime, Input } = this.domains;

    try {
      // Get the root document
      const { root } = await DOM.getDocument();

      // Query for the element
      const { nodeId } = await DOM.querySelector({
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Safely escape the selector for use in JS string
      const escapedSelector = JSON.stringify(selector);

      // Focus the element
      const focusResult = await this.evaluateInContext(
        `(function() { const el = document.querySelector(${escapedSelector}); if (!el) throw new Error('Element not found'); el.focus(); return true; })()`
      );
      if (focusResult.exceptionDetails) {
        throw new Error(`Failed to focus element: ${focusResult.exceptionDetails.text}`);
      }

      // Select all text (Meta+A on macOS for Cmd, works in CDP regardless of platform)
      await Input.dispatchKeyEvent({
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: 2, // Ctrl modifier (works in CDP headless regardless of OS)
      });
      await Input.dispatchKeyEvent({
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: 2,
      });

      // Delete selected text
      await Input.dispatchKeyEvent({
        type: "keyDown",
        key: "Delete",
        code: "Delete",
      });
      await Input.dispatchKeyEvent({
        type: "keyUp",
        key: "Delete",
        code: "Delete",
      });

      // Type the new value character by character
      for (const char of value) {
        await Input.dispatchKeyEvent({
          type: "char",
          text: char,
        });
      }

      // Dispatch input and change events for framework compatibility (React, Vue, etc.)
      await this.evaluateInContext(`(function() {
          const el = document.querySelector(${escapedSelector});
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`);

      // Blur the element
      await this.evaluateInContext(
        `(function() { const el = document.querySelector(${escapedSelector}); if (el) el.blur(); })()`
      );
    } catch (error) {
      throw new Error(`Failed to fill ${selector}: ${error}`);
    }
  }

  /**
   * Clicks an element
   * Finds the element, calculates the center of its bounds, and dispatches click events
   * @param selector - CSS selector for the element to click
   * @throws If element is not found or click operation fails
   */
  async click(selector: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { DOM, Input } = this.domains;

    try {
      // Get the root document
      const { root } = await DOM.getDocument();

      // Query for the element
      const { nodeId } = await DOM.querySelector({
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Get the element bounds
      const box = await DOM.getBoxModel({ nodeId });

      if (!box.model || !box.model.content) {
        throw new Error(`Could not get bounds for ${selector}`);
      }

      // Calculate center coordinates
      // content is [x1, y1, x2, y2, x3, y3, x4, y4]
      const x1 = box.model.content[0];
      const y1 = box.model.content[1];
      const x2 = box.model.content[4];
      const y2 = box.model.content[5];

      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;

      // Single click: mousePressed then mouseReleased with clickCount
      await Input.dispatchMouseEvent({
        type: "mousePressed",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });

      await Input.dispatchMouseEvent({
        type: "mouseReleased",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });
    } catch (error) {
      throw new Error(`Failed to click ${selector}: ${error}`);
    }
  }

  /**
   * Gets all collected console messages (non-destructive — returns a copy)
   * @returns Array of console messages with type and text
   */
  async getConsoleMessages(): Promise<Array<{ type: string; text: string; timestamp: number }>> {
    return [...this.consoleMessages];
  }

  /**
   * Gets all collected network responses (non-destructive — returns a copy)
   * @returns Array of network responses with URL, method, status code, and timestamp
   */
  async getNetworkResponses(): Promise<Array<{ url: string; method: string; status: number; timestamp: number }>> {
    return this.networkResponses.map(({ url, method, status, timestamp }) => ({
      url,
      method,
      status,
      timestamp,
    }));
  }

  /**
   * Gets the DOM snapshot as an HTML string
   * Serializes the DOM tree into a simple text representation
   * @returns HTML string representation of the current DOM
   * @throws If snapshot operation fails
   */
  async getDomSnapshot(): Promise<string> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { DOM } = this.domains;

    try {
      // Get the root document with depth to pre-populate children
      const { root } = await DOM.getDocument({ depth: -1 });

      // Serialize the DOM tree to HTML
      const html = this.serializeDOMNode(root);
      return html;
    } catch (error) {
      throw new Error(`Failed to get DOM snapshot: ${error}`);
    }
  }

  /**
   * Recursively serializes a DOM node to an HTML string
   * Handles document nodes (type 9), element nodes (type 1), and text nodes (type 3)
   * @param node - The DOM node to serialize
   * @returns HTML string representation of the node
   */
  private serializeDOMNode(node: any): string {
    // Handle text nodes
    if (node.nodeType === 3) {
      // TEXT_NODE
      return node.nodeValue || "";
    }

    // Handle document nodes (type 9) — just serialize children
    if (node.nodeType === 9 || node.nodeType === 10 || node.nodeType === 11) {
      let html = "";
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += this.serializeDOMNode(child);
        }
      }
      return html;
    }

    // Handle element nodes
    if (node.nodeType === 1) {
      // ELEMENT_NODE
      const tagName = node.nodeName.toLowerCase();
      let html = `<${tagName}`;

      // Add attributes with proper escaping
      if (node.attributes) {
        for (let i = 0; i < node.attributes.length; i += 2) {
          const attrName = node.attributes[i];
          const attrValue = node.attributes[i + 1];
          html += ` ${attrName}="${this.escapeAttrValue(attrValue)}"`;
        }
      }

      html += ">";

      // Self-closing tags
      if (
        ["area", "base", "br", "col", "embed", "hr", "img", "input", "link",
          "meta", "param", "source", "track", "wbr"].includes(tagName)
      ) {
        return html;
      }

      // Serialize child nodes (use pre-populated children from getDocument depth:-1)
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += this.serializeDOMNode(child);
        }
      }

      // Close tag
      html += `</${tagName}>`;
      return html;
    }

    // Other node types (comments, etc.) — skip
    return "";
  }

  /**
   * Captures a PNG screenshot of the current page
   * @returns Base64-encoded PNG data
   */
  async captureScreenshot(): Promise<string> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { Page } = this.domains;

    try {
      const result = await Page.captureScreenshot({ format: "png" });
      return result.data;
    } catch (error) {
      throw new Error(`Failed to capture screenshot: ${error}`);
    }
  }

  /**
   * Selects an option in a native <select> element
   * @param selector - CSS selector for the <select> element
   * @param value - The option value to select
   */
  async select(selector: string, value: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    try {
      const escapedSelector = JSON.stringify(selector);
      const escapedValue = JSON.stringify(value);

      const result = await this.evaluateInContext(`(function() {
        const el = document.querySelector(${escapedSelector});
        if (!el) throw new Error('Element not found: ' + ${escapedSelector});
        if (el.tagName.toLowerCase() !== 'select') throw new Error('Element is not a <select>: ' + ${escapedSelector});
        el.value = ${escapedValue};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text);
      }
    } catch (error) {
      throw new Error(`Failed to select ${selector}: ${error}`);
    }
  }

  /**
   * Dispatches a keyboard event (keyDown + keyUp)
   * @param key - DOM key name (Enter, Tab, Escape, ArrowDown, etc.)
   * @param modifiers - Optional array of modifier keys
   */
  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { Input } = this.domains;

    // Convert modifier names to CDP bitmask
    let modifierBitmask = 0;
    if (modifiers) {
      for (const mod of modifiers) {
        switch (mod.toLowerCase()) {
          case "alt": modifierBitmask |= 1; break;
          case "ctrl": modifierBitmask |= 2; break;
          case "meta": modifierBitmask |= 4; break;
          case "shift": modifierBitmask |= 8; break;
        }
      }
    }

    try {
      await Input.dispatchKeyEvent({
        type: "keyDown",
        key,
        modifiers: modifierBitmask,
      });
      await Input.dispatchKeyEvent({
        type: "keyUp",
        key,
        modifiers: modifierBitmask,
      });
    } catch (error) {
      throw new Error(`Failed to press key ${key}: ${error}`);
    }
  }

  /**
   * Hovers over an element by CSS selector
   * @param selector - CSS selector for the element to hover
   */
  async hover(selector: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    const { DOM, Input } = this.domains;

    try {
      const { root } = await DOM.getDocument();
      const { nodeId } = await DOM.querySelector({
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${selector}`);
      }

      const box = await DOM.getBoxModel({ nodeId });
      if (!box.model || !box.model.content) {
        throw new Error(`Could not get bounds for ${selector}`);
      }

      const x1 = box.model.content[0];
      const y1 = box.model.content[1];
      const x2 = box.model.content[4];
      const y2 = box.model.content[5];

      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;

      await Input.dispatchMouseEvent({
        type: "mouseMoved",
        x: centerX,
        y: centerY,
      });
    } catch (error) {
      throw new Error(`Failed to hover ${selector}: ${error}`);
    }
  }

  /**
   * Switches execution context to an iframe or back to the main frame
   * @param selector - CSS selector for the iframe element, or undefined to return to main frame
   */
  async switchFrame(selector?: string): Promise<void> {
    if (!this.connected) {
      throw new Error("CDP client is not connected");
    }

    if (!selector) {
      // Return to main frame
      this.currentExecutionContextId = undefined;
      return;
    }

    const { DOM, Page } = this.domains;

    try {
      const { root } = await DOM.getDocument();
      const { nodeId } = await DOM.querySelector({
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) {
        throw new Error(`iframe not found: ${selector}`);
      }

      // Get the frameId from the iframe node
      const { node } = await DOM.describeNode({ nodeId });
      const frameId = node.frameId;

      if (!frameId) {
        throw new Error(`Element is not an iframe: ${selector}`);
      }

      // Create an isolated world in the iframe's frame
      const { executionContextId } = await Page.createIsolatedWorld({
        frameId,
        grantUniveralAccess: true,
      });

      this.currentExecutionContextId = executionContextId;
    } catch (error) {
      throw new Error(`Failed to switch frame ${selector}: ${error}`);
    }
  }

  /**
   * Configures auto-handling for future JavaScript dialogs
   * @param action - Whether to accept or dismiss the dialog
   * @param text - Optional text to enter in prompt dialogs
   */
  async handleDialog(action: "accept" | "dismiss", text?: string): Promise<void> {
    this.dialogHandler = { action, ...(text != null ? { text } : {}) };
  }

  /**
   * Adds a mock rule for network interception
   * Converts glob patterns to RegExp for matching
   * @param pattern - Glob pattern to match URLs
   * @param status - HTTP status code for the mock response
   * @param body - Optional response body
   * @param delay - Optional delay in milliseconds before responding
   */
  addMockRule(
    pattern: string,
    status: number,
    body?: unknown,
    delay?: number
  ): void {
    const regexpPattern = this.globToRegExp(pattern);
    this.mockRules.push({
      pattern: regexpPattern,
      status,
      body,
      delay,
    });
  }

  /**
   * Closes the CDP client connection
   * Disconnects from Chrome and cleans up resources
   * @throws If disconnection fails
   */
  async close(): Promise<void> {
    if (this.client) {
      // Set connected=false BEFORE closing so in-flight event handlers
      // (e.g., Fetch.requestPaused) see the disconnected state immediately
      this.connected = false;

      // Clean up event listeners before closing
      this.cleanupEventListeners();

      // Close the owned tab if we created one
      if (this.ownedTargetId) {
        try {
          await this.domains.Target.closeTarget({ targetId: this.ownedTargetId });
        } catch { /* tab may already be closed */ }
        this.ownedTargetId = undefined;
      }

      try {
        await this.client.close();
      } catch (error) {
        throw new Error(`Failed to close CDP client: ${error}`);
      } finally {
        this.client = null;
        // Clean up event tracking data
        this.networkRequestTimes.clear();
        this.onEvent = undefined;
      }
    }
  }
}
