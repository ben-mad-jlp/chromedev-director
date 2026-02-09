# AI Assist Features — How They Work

## The core question
The GUI isn't Claude Code. So "Ask AI" means the **API server calls the Anthropic API directly** with a well-crafted prompt + rich context from the test engine.

User needs an Anthropic API key configured in the project settings.

---

## Feature 1: "Ask AI to Create Test"

**User sees:** A text input in the sidebar — "Describe what to test..."

**What happens behind the scenes:**
1. User types: "Test that login works with valid credentials"
2. API server builds a system prompt that includes:
   - All available step types and their schemas (navigate, fill, click, assert, wait_for, etc.)
   - The project's base URL
   - Names of existing saved tests (so AI can reference/nest them)
   - Optionally: a DOM snapshot of the current page (if Chrome is connected)
3. Calls Claude API → gets back a `TestDef` JSON
4. GUI shows the generated steps for **review before saving**
5. User can accept, ask for changes, or dismiss

**The prompt context is what makes this powerful.** The API server knows all the step types, the project config, and can even grab a live DOM snapshot so Claude knows what's on the page.

---

## Feature 2: "Ask AI to Fix"

**User sees:** A button in the console output when a step fails.

**What happens behind the scenes:**
1. Test runs, step 5 fails: `"Element not found: [data-testid='packaging-link']"`
2. Engine captures at the point of failure:
   - The failing step definition
   - The error message
   - Console output up to that point
   - A DOM snapshot of the page at the moment of failure
   - Screenshot (optional)
3. User clicks "Ask AI to Fix"
4. All that context goes to Claude API
5. Claude responds with:
   - A corrected step definition
   - An explanation: "The selector `[data-testid='packaging-link']` doesn't exist. The element is actually a `<div role='menuitem'>` with text 'Packaging Station'. Changed to text-based selector."
6. GUI shows a diff: old step vs. proposed fix
7. User clicks [Apply] or [Dismiss]

**Key insight:** The failure context (DOM snapshot + error + console) gives Claude everything it needs to diagnose the issue — same as when debugging in Claude Code, but automated.

---

## Feature 3: "Ask AI to Add Steps"

**User sees:** A text input at the bottom of the step list.

**What happens behind the scenes:**
1. User types: "After login, check that the welcome message shows the user's name"
2. API sends to Claude:
   - The current test's full step list
   - Where the new steps should be inserted (after which step)
   - The user's description
   - Available step types
3. Claude generates 1+ new `StepDef` entries
4. GUI shows them **inserted in context** (greyed out existing steps, highlighted new ones)
5. User clicks [Accept] to merge them in

---

## What the API server needs

```
POST /ai/create-test    { prompt, baseUrl?, domSnapshot? }
POST /ai/fix-step       { step, error, console, domSnapshot?, screenshot? }
POST /ai/add-steps      { prompt, currentSteps, insertAfter }
```

Each endpoint:
1. Builds a specialized system prompt with step type schemas
2. Injects relevant context (project config, DOM, errors)
3. Calls Anthropic Messages API (claude-sonnet for speed, opus for complex fixes)
4. Parses + validates the response as valid TestDef/StepDef
5. Returns structured result to the GUI

## API key management
- Stored in project config (`.chromedev-director/config.json`)
- Or environment variable `ANTHROPIC_API_KEY`
- Settings page in GUI to configure

---

## Why not route through MCP/Claude Code?

The GUI needs to work **standalone** — user might not have Claude Code open.
Direct API calls are simpler, faster, and give us full control over the prompts.
The MCP tools still exist for when users ARE in Claude Code.
