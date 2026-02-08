/**
 * Real E2E test: Full flow from login → packaging station
 * Login → Home → Drawer menu → Packaging Station → Station Login → Workorder → Create boxes
 */

import { CDPClient } from "./cdp-client.js";
import { TestDef } from "./types.js";
import { runTest } from "./step-runner.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mock Data ──

const MOCK_DIVISIONS = [
  { id: "GW", name: "GW Division", willCallElectronicSignature: false, nightShift: false, maxFastTrackContainers: 0, daysOutAdder: 0, daysOutAdderFabshop: 0, daysOutAdderPicking: 0, minimumKegWeight: 0, maxFastTrackPrice: 0, legacySales: false, maxPickingIdleMinutes: 0, maxFabshopIdleMinutes: 0, maximumShipmentTableWeight: 0 },
];

const MOCK_EMPLOYEES = [
  { id: 10, firstName: "Alice", lastName: "Johnson", division: "GW", terminated: false, drugTest: false, salesTrainee: false, authorizations: [] },
];

const MOCK_LOGIN_RESPONSE = {
  token: "test-jwt-token-12345",
  employee: MOCK_EMPLOYEES[0],
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};

const MOCK_CLOCK_STATUS = {
  employeeId: "0010",
  isClockedIn: false,
  hoursWorkedToday: 0,
};

const MOCK_MAIL: any[] = [];

const MOCK_PACKAGING_STATIONS = [
  { name: "PACK-01", division: "GW" },
  { name: "PACK-02", division: "GW" },
];

const MOCK_STATION_INFO = {
  station: { name: "PACK-01", division: "GW" },
  workingContainer: {
    isEmpty: true,
    containerId: null,
    skuId: null,
    serialNumber: null,
    totalPieces: 0,
    sourceContainers: [],
    loadedAt: null,
    useScale: false,
    scaleModel: "none",
    comPort: null,
  },
  pendingWorkorders: [],
  containers: [],
  hasActiveSession: true,
};

const MOCK_STATION_LOGIN = {
  success: true,
  sessionId: "test-session-001",
  stationInfo: MOCK_STATION_INFO,
};

const MOCK_WORKORDERS = [
  {
    workorderId: "WO-1001",
    skuId: "WIDGET-A",
    serialNumber: "SN-100",
    description: "Premium Widget A - Blue",
    quantityDue: 100,
    piecesPerBox: 10,
    boxesdue: 10,
  },
  {
    workorderId: "WO-1002",
    skuId: "GADGET-B",
    serialNumber: "SN-200",
    description: "Standard Gadget B - Red",
    quantityDue: 50,
    piecesPerBox: 25,
    boxesdue: 2,
  },
];

const MOCK_SELECT_WORKORDER = {
  success: true,
  workorder: MOCK_WORKORDERS[0],
  error: null,
};

const MOCK_PACKAGE_RESULT = {
  success: true,
  newContainers: [
    { containerId: "CTN-5001", piecesCreated: 10, location: "PACK-01" },
  ],
  remainingPieces: 90,
  workorderStatus: "incomplete" as const,
  error: null,
};

async function main() {
  console.log("=== Full Flow: Login → Packaging Station ===\n");

  const client = new CDPClient(9222);

  try {
    await client.connect("http://localhost:8081");

    // Register ALL mock rules (most specific first)
    // Auth & data
    client.addMockRule("*api/divisions*", 200, MOCK_DIVISIONS);
    client.addMockRule("*api/employees/active*", 200, MOCK_EMPLOYEES);
    client.addMockRule("*api/auth/login*", 200, MOCK_LOGIN_RESPONSE);

    // Home screen
    client.addMockRule("*api/timeclock/status*", 200, MOCK_CLOCK_STATUS);
    client.addMockRule("*api/Employee/Mail*", 200, MOCK_MAIL);

    // Packaging station (specific endpoints FIRST)
    client.addMockRule("*stations/packaging*login*", 200, MOCK_STATION_LOGIN);
    client.addMockRule("*stations/packaging*logout*", 200, { success: true });
    client.addMockRule("*stations/packaging*select-workorder*", 200, MOCK_SELECT_WORKORDER);
    client.addMockRule("*stations/packaging*workorders*", 200, MOCK_WORKORDERS);
    client.addMockRule("*stations/packaging*info*", 200, MOCK_STATION_INFO);
    client.addMockRule("*stations/packaging*package*", 200, MOCK_PACKAGE_RESULT);
    // Stations list (least specific, catches GET /api/stations/packaging?division=GW)
    client.addMockRule("*stations/packaging?division*", 200, MOCK_PACKAGING_STATIONS);

    // Inject global error handler to catch ALL uncaught errors (with full stack traces)
    await (client as any).domains.Page.addScriptToEvaluateOnNewDocument({
      source: `
        window.__cdpErrors = [];
        window.onerror = function(msg, src, line, col, err) {
          var entry = { type: 'onerror', msg: String(msg), src: src, line: line, col: col, stack: err?.stack?.substring(0, 500) };
          window.__cdpErrors.push(entry);
          console.error('[CDP:ERROR] ' + msg + '\\n  at ' + src + ':' + line + ':' + col + '\\n' + (err?.stack || ''));
        };
        window.addEventListener('unhandledrejection', function(e) {
          var reason = e.reason;
          var entry = { type: 'unhandledrejection', msg: String(reason), stack: reason?.stack?.substring(0, 500) };
          window.__cdpErrors.push(entry);
          console.error('[CDP:REJECTION] ' + String(reason) + '\\n' + (reason?.stack || ''));
        });
      `,
    });

    console.log("[1] Connected + mocks + error handler registered\n");

    // ═════════════════════════════════════════
    // PHASE 1: LOGIN
    // ═════════════════════════════════════════
    console.log("══ PHASE 1: Login ══");

    await client.navigate("http://localhost:8081");
    await sleep(3000);

    let text = (await client.evaluate("document.body.innerText")) as string;
    console.log("Page:", text.replace(/\n/g, " | "));

    // Select Division
    await client.click("[aria-label='Division']");
    await sleep(500);
    await client.evaluate(`(function() {
      for (const el of document.querySelectorAll('*')) {
        if (el.textContent?.trim() === 'GW Division' && el.children.length === 0) { el.click(); return true; }
      }
      return false;
    })()`);
    await sleep(500);
    console.log("  Division: GW Division selected");

    // Select Employee (click the employee area)
    await client.evaluate(`(function() {
      for (const el of document.querySelectorAll('*')) {
        const t = el.textContent?.trim() || '';
        if (t.includes('Employee') && !t.includes('Division') && !t.includes('Login') && !t.includes('Password') && el.children.length <= 3) {
          el.click(); return true;
        }
      }
      return false;
    })()`);
    await sleep(800);
    await client.evaluate(`(function() {
      for (const el of document.querySelectorAll('*')) {
        if (el.textContent?.trim() === 'Alice Johnson' && el.children.length === 0) { el.click(); return true; }
      }
      return false;
    })()`);
    await sleep(500);
    console.log("  Employee: Alice Johnson selected");

    // Fill password & login
    await client.fill("[aria-label='Password input']", "test123");
    console.log("  Password: filled");

    await client.click("[aria-label='Login']");
    await sleep(2000);

    text = (await client.evaluate("document.body.innerText")) as string;
    const loginSuccess = text.includes("ALICE JOHNSON") || text.includes("Home");
    console.log("  Login:", loginSuccess ? "SUCCESS" : "FAILED");
    console.log("  Home screen:", text.replace(/\n/g, " | ").substring(0, 200));

    if (!loginSuccess) {
      console.log("\n  Login failed, cannot continue.");
      return;
    }

    // ═════════════════════════════════════════
    // PHASE 2: NAVIGATE TO PACKAGING STATION
    // ═════════════════════════════════════════
    console.log("\n══ PHASE 2: Navigate to Packaging Station ══");

    // Open drawer menu
    console.log("  Opening drawer menu...");
    await client.click("[aria-label='Open menu']");
    await sleep(800);

    text = (await client.evaluate("document.body.innerText")) as string;
    console.log("  Drawer text:", text.replace(/\n/g, " | ").substring(0, 300));

    // Click "Packaging" group to expand it
    // In React Native Web, accessibilityLabel becomes aria-label
    console.log("  Clicking 'Packaging' group...");
    const packagingClick = await client.evaluate(`(function() {
      // Try aria-label first (React Native Web maps accessibilityLabel → aria-label)
      let el = document.querySelector('[aria-label*="Packaging"][aria-label*="collapsed"]');
      if (!el) el = document.querySelector('[aria-label*="Packaging"][role="button"]');
      if (!el) {
        // Try finding the pressable/clickable group header
        for (const candidate of document.querySelectorAll('[role="button"]')) {
          if (candidate.textContent?.trim() === 'Packaging') {
            el = candidate;
            break;
          }
        }
      }
      if (!el) {
        // Last resort: find exact "Packaging" text node's clickable parent
        for (const candidate of document.querySelectorAll('*')) {
          if (candidate.textContent?.trim() === 'Packaging' && candidate.children.length <= 2) {
            // Click the parent which is likely the Pressable
            const target = candidate.closest('[role="button"]') || candidate;
            target.click();
            return { clicked: true, tag: target.tagName, method: 'parent-pressable', text: target.textContent?.trim().substring(0, 30) };
          }
        }
      }
      if (el) {
        el.click();
        return { clicked: true, tag: el.tagName, ariaLabel: el.getAttribute('aria-label')?.substring(0, 40) };
      }
      return { clicked: false, availableAriaLabels: Array.from(document.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label')).filter(a => a?.includes('ack')).slice(0, 5) };
    })()`) as any;
    console.log("  Result:", JSON.stringify(packagingClick));
    await sleep(800);

    // Check if Packaging expanded
    text = (await client.evaluate("document.body.innerText")) as string;
    const expanded = text.includes("Packaging Station");
    console.log("  Expanded:", expanded);
    if (!expanded) {
      // Debug: list all aria-labels to understand the drawer structure
      const labels = await client.evaluate(`
        Array.from(document.querySelectorAll('[aria-label]'))
          .map(e => ({ label: e.getAttribute('aria-label'), tag: e.tagName, role: e.getAttribute('role') }))
          .filter(x => x.label && (x.label.includes('ack') || x.label.includes('menu') || x.label.includes('Station')))
      `);
      console.log("  Relevant aria-labels:", JSON.stringify(labels));

      // Try clicking again with different strategy
      console.log("  Retrying with innerHTML search...");
      await client.evaluate(`(function() {
        // Find all elements that render "Packaging" as direct text
        for (const el of document.querySelectorAll('div, span, a, button')) {
          const directText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent?.trim()).join('');
          if (directText === 'Packaging') {
            // Click this element and its parent
            el.click();
            if (el.parentElement) el.parentElement.click();
            return { clicked: true, tag: el.tagName };
          }
        }
        return { clicked: false };
      })()`);
      await sleep(800);

      text = (await client.evaluate("document.body.innerText")) as string;
      console.log("  After retry:", text.includes("Packaging Station") ? "EXPANDED" : "still collapsed");
      console.log("  Menu items:", text.replace(/\n/g, " | ").substring(text.indexOf("Packaging") > 0 ? text.indexOf("Packaging") - 5 : 0, text.indexOf("Packaging") + 100));
    }

    // Click "Packaging Station" menu item
    console.log("  Clicking 'Packaging Station'...");
    const stationClick = await client.evaluate(`(function() {
      // Try aria-label
      let el = document.querySelector('[aria-label="Packaging Station"]');
      if (el) { el.click(); return { clicked: true, method: 'aria-label' }; }
      // Try text match on leaf or near-leaf
      for (const candidate of document.querySelectorAll('*')) {
        const t = candidate.textContent?.trim();
        if (t === 'Packaging Station') {
          // Find the closest clickable parent
          const target = candidate.closest('[role="button"]') || candidate;
          target.click();
          return { clicked: true, tag: target.tagName, method: 'text-pressable' };
        }
      }
      return { clicked: false, bodyText: document.body.innerText.substring(0, 200) };
    })()`) as any;
    console.log("  Result:", JSON.stringify(stationClick));
    await sleep(2000);

    text = (await client.evaluate("document.body.innerText")) as string;
    console.log("  Current page:", text.replace(/\n/g, " | ").substring(0, 300));

    // ═════════════════════════════════════════
    // PHASE 3: PACKAGING STATION LOGIN
    // ═════════════════════════════════════════
    console.log("\n══ PHASE 3: Packaging Station Login ══");

    // Check if we're on the packaging station screen
    const hasPackStation = text.includes("Packaging Station") || text.includes("PACK-01") || text.includes("Scan Packaging");
    console.log("  On packaging screen:", hasPackStation);

    if (text.includes("PACK-01")) {
      // Stations are listed — click PACK-01
      console.log("  Selecting station PACK-01...");
      const selectStation = await client.evaluate(`(function() {
        for (const el of document.querySelectorAll('*')) {
          const t = el.textContent?.trim();
          if (t === 'PACK-01' && el.children.length <= 1) {
            el.click();
            return { clicked: true, tag: el.tagName };
          }
        }
        for (const el of document.querySelectorAll('*')) {
          if (el.textContent?.includes('PACK-01')) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.height < 100 && el.children.length <= 3) {
              el.click();
              return { clicked: true, tag: el.tagName, method: 'parent' };
            }
          }
        }
        return { clicked: false };
      })()`) as any;
      console.log("  Station click:", JSON.stringify(selectStation));
      await sleep(1500);
    } else if (text.includes("Scan Packaging")) {
      // Try typing the station name in the scan input
      console.log("  Scan input found, typing PACK-01...");
      const scanInput = await client.evaluate(
        `!!document.querySelector('input[placeholder*="Scan"]')`
      );
      if (scanInput) {
        await client.fill('input[placeholder*="Scan"]', "PACK-01");
        await sleep(500);
        // Press Enter or click
        await client.evaluate(`(function() {
          const input = document.querySelector('input[placeholder*="Scan"]');
          if (input) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
          }
        })()`);
        await sleep(1500);
      }
    }

    text = (await client.evaluate("document.body.innerText")) as string;
    console.log("  After station login:", text.replace(/\n/g, " | ").substring(0, 400));

    // ═════════════════════════════════════════
    // PHASE 4: PACKAGING WORKFLOW
    // ═════════════════════════════════════════
    console.log("\n══ PHASE 4: Packaging Workflow ══");

    // Check current state — workorder may already be selected from localStorage cache
    const hasWorkorder = text.includes("WO-1001") || text.includes("WIDGET-A");
    const hasCreateBoxes = text.includes("Create Boxes") || text.includes("Total containers");
    console.log("  Workorder already selected:", hasWorkorder);
    console.log("  Create Boxes available:", hasCreateBoxes);

    // Check localStorage cache state
    const cachedState = await client.evaluate("localStorage.getItem('packaging-station')") as string | null;
    console.log("  localStorage cache:", cachedState ? cachedState.substring(0, 200) : "null");

    // If workorder not yet selected, open modal and select one
    if (!hasWorkorder) {
      console.log("  Need to select a workorder...");
      // Click "Select Workorder" or "Change Workorder"
      const woClick = await client.evaluate(`(function() {
        let el = document.querySelector('[aria-label="Select Workorder"]');
        if (el) { el.click(); return { clicked: true, method: 'aria-label-select' }; }
        el = document.querySelector('[aria-label="Change Workorder"]');
        if (el) { el.click(); return { clicked: true, method: 'aria-label-change' }; }
        for (const el of document.querySelectorAll('[role="button"]')) {
          if (el.textContent?.includes('Select Workorder') || el.textContent?.includes('Change Workorder')) {
            el.click(); return { clicked: true, method: 'role-button', text: el.textContent.trim().substring(0, 30) };
          }
        }
        return { clicked: false };
      })()`) as any;
      console.log("  Workorder button:", JSON.stringify(woClick));
      await sleep(1000);

      // Select WO-1001 from modal
      text = (await client.evaluate("document.body.innerText")) as string;
      if (text.includes("WO-1001")) {
        await client.evaluate(`(function() {
          for (const el of document.querySelectorAll('*')) {
            if (el.textContent?.trim() === 'WO-1001' && el.children.length === 0) {
              const target = el.closest('[role="button"]') || el.parentElement?.closest('[role="button"]');
              if (target) { target.click(); return true; }
            }
          }
          return false;
        })()`);
        await sleep(1500);
      }

      text = (await client.evaluate("document.body.innerText")) as string;
      console.log("  After workorder selection:", text.replace(/\n/g, " | ").substring(0, 300));
    }

    // ── Create Boxes ──
    console.log("\n  --- Creating a box ---");
    text = (await client.evaluate("document.body.innerText")) as string;
    console.log("  Pre-create state:", text.replace(/\n/g, " | ").substring(0, 400));

    // Click "Create Boxes" button directly
    const createClick = await client.evaluate(`(function() {
      let el = document.querySelector('[aria-label="Create boxes"]');
      if (el) { el.click(); return { clicked: true, method: 'aria-label' }; }
      for (const el of document.querySelectorAll('[role="button"]')) {
        if (el.textContent?.includes('Create Boxes')) {
          el.click(); return { clicked: true, method: 'role-button' };
        }
      }
      return { clicked: false };
    })()`) as any;
    console.log("  Create boxes:", JSON.stringify(createClick));
    await sleep(3000);

    text = (await client.evaluate("document.body.innerText")) as string;
    console.log("  After creating boxes:", text.replace(/\n/g, " | ").substring(0, 500));

    if (!text || text.trim().length === 0) {
      console.log("  Page is empty — React crashed.");

      // Read captured errors from the global handler (includes stack traces)
      const cdpErrors = await client.evaluate("JSON.stringify(window.__cdpErrors || [])") as string;
      const parsedErrors = JSON.parse(cdpErrors || "[]");
      if (parsedErrors.length > 0) {
        console.log("  Captured __cdpErrors:");
        parsedErrors.forEach((e: any, i: number) => {
          console.log(`    [${i}] ${e.type}: ${e.msg}`);
          if (e.src) console.log(`        src: ${e.src}:${e.line}:${e.col}`);
          if (e.stack) console.log(`        stack: ${e.stack}`);
        });
      }

      // Check localStorage to see what the state machine persisted before crash
      const postCrashCache = await client.evaluate("localStorage.getItem('packaging-station')") as string | null;
      console.log("  Post-crash localStorage:", postCrashCache ? postCrashCache.substring(0, 500) : "null");
    }

    // Check if container was created
    if (text.includes("CTN-5001")) {
      console.log("\n  BOX CREATED: CTN-5001 with 10 pieces!");
    }

    // ═════════════════════════════════════════
    // PHASE 5: UNLOAD PACKAGED CONTAINERS
    // ═════════════════════════════════════════
    console.log("\n══ PHASE 5: Unload Packaged Containers ══");

    if (text.includes("CTN-5001")) {
      // Click "Unload" button in the station header
      console.log("  Clicking 'Unload'...");
      const unloadClick = await client.evaluate(`(function() {
        let el = document.querySelector('[aria-label="Unload"]');
        if (el) { el.click(); return { clicked: true, method: 'aria-label' }; }
        for (const el of document.querySelectorAll('[role="button"]')) {
          if (el.textContent?.trim() === 'Unload') {
            el.click(); return { clicked: true, method: 'role-button' };
          }
        }
        return { clicked: false };
      })()`) as any;
      console.log("  Result:", JSON.stringify(unloadClick));
      await sleep(1000);

      // Check modal content
      text = (await client.evaluate("document.body.innerText")) as string;
      const hasModal = text.includes("Unload Packaged") || text.includes("Confirm Unload") || text.includes("Ready to Unload");
      console.log("  Unload modal visible:", hasModal);
      if (hasModal) {
        console.log("  Modal content:", text.replace(/\n/g, " | ").substring(text.indexOf("Unload"), text.indexOf("Unload") + 300));
      }

      // Click "Confirm Unload"
      console.log("  Clicking 'Confirm Unload'...");
      const confirmClick = await client.evaluate(`(function() {
        for (const el of document.querySelectorAll('[role="button"]')) {
          if (el.textContent?.includes('Confirm Unload')) {
            el.click(); return { clicked: true, method: 'role-button' };
          }
        }
        for (const el of document.querySelectorAll('*')) {
          if (el.textContent?.trim() === 'Confirm Unload' && el.children.length <= 2) {
            const target = el.closest('[role="button"]') || el;
            target.click(); return { clicked: true, method: 'text-parent' };
          }
        }
        return { clicked: false };
      })()`) as any;
      console.log("  Result:", JSON.stringify(confirmClick));
      await sleep(2000);

      // Check where we ended up — should be back at station login
      text = (await client.evaluate("document.body.innerText")) as string;
      console.log("  After unload:", text.replace(/\n/g, " | ").substring(0, 400));

      const backToLogin = text.includes("Scan") || text.includes("PACK-01") || text.includes("PACK-02") || text.includes("Select") || text.includes("notLoggedIn");
      console.log("  Back to station login:", backToLogin);
    } else {
      console.log("  Skipping unload — no containers to unload.");
    }

    // ═════════════════════════════════════════
    // SUMMARY
    // ═════════════════════════════════════════
    console.log("\n══ SUMMARY ══");

    const resps = await client.getNetworkResponses();
    const apiResps = resps.filter((r) => r.url.includes("localhost:3001"));
    console.log(`  API calls made: ${apiResps.length}`);
    apiResps.forEach((r) =>
      console.log(`    ${r.status} ${r.url.substring(0, 120)}`)
    );

    const msgs = await client.getConsoleMessages();
    const errors = msgs.filter((m) => m.type === "error");
    console.log(`\n  Console errors: ${errors.length}`);
    errors.forEach((m) => console.log(`    ${m.text.substring(0, 150)}`));

    const finalText = (await client.evaluate("document.body.innerText")) as string;
    console.log(`\n  Final page text:`);
    console.log("  " + finalText.replace(/\n/g, "\n  "));
  } finally {
    try {
      await client.close();
    } catch {}
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
