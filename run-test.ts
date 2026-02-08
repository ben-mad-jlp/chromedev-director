import { runTest } from "./src/step-runner";

// Test 1: Basic eval and variable chaining on about:blank
const basicTest = {
  url: "about:blank",
  steps: [
    { eval: "document.title", as: "title" },
    { eval: "document.readyState", as: "state" },
    { eval: "navigator.userAgent", as: "ua" },
  ],
};

// Test 2: Navigate to a real page and extract data
const realPageTest = {
  url: "https://example.com",
  steps: [
    { label: "Get page title", eval: "document.title", as: "title" },
    { label: "Get heading", eval: "document.querySelector('h1')?.textContent", as: "heading" },
    { label: "Assert heading exists", assert: "document.querySelector('h1') !== null" },
    { label: "Count links", eval: "document.querySelectorAll('a').length", as: "linkCount" },
  ],
};

// Test 3: Network mocking
const mockTest = {
  url: "about:blank",
  before: [
    {
      mock_network: {
        match: "**/api/hello",
        status: 200,
        body: { message: "Hello from mock!" },
      },
    },
  ],
  steps: [
    {
      label: "Fetch mocked endpoint",
      eval: "fetch('http://localhost/api/hello').then(r => r.json())",
      as: "response",
    },
  ],
};

async function main() {
  console.log("=== Test 1: Basic eval on about:blank ===");
  const r1 = await runTest(basicTest, 9222);
  console.log(JSON.stringify(r1, null, 2));

  console.log("\n=== Test 2: Real page (example.com) ===");
  const r2 = await runTest(realPageTest, 9222);
  console.log(JSON.stringify(r2, null, 2));

  console.log("\n=== Test 3: Network mocking ===");
  const r3 = await runTest(mockTest, 9222);
  console.log(JSON.stringify(r3, null, 2));
}

main().catch(console.error);
