# UI Interaction Model — Who Does What

## The core tension
Test steps are hard to author: CSS selectors, CDP expressions, timing, network mock configs.
A regular user shouldn't need to write `[aria-label='Division']` or `document.querySelector(...)`.

## Role split

### Claude (AI) creates tests
- User describes what they want tested in natural language
- AI generates the full test definition (steps, selectors, assertions)
- AI can also refine/fix tests when they fail

### User manages and runs tests via GUI
| Action | Difficulty | GUI Support |
|--------|-----------|-------------|
| Run a test | Easy | One-click run button |
| View results + history | Easy | Results dashboard |
| Reorder steps | Easy | Drag and drop |
| Toggle step on/off | Easy | Checkbox/toggle per step |
| Tweak a value (expected text, URL) | Medium | Inline edit on simple fields |
| Compose tests (nest test A into test B) | Medium | Drag saved test into step list |
| Add a new step from scratch | Hard | NOT in GUI — use AI |
| Write selectors/expressions | Hard | NOT in GUI — use AI |

## Test nesting model
Tests can include other tests as sub-steps. This is powerful for composition:

```
Login Flow (saved test)
  ├── navigate: localhost:8081
  ├── fill: Division
  ├── fill: Employee  
  ├── click: Login
  └── assert: Welcome

Packaging Station Test
  ├── [nested] Login Flow     ← reuses saved test
  ├── click: Drawer menu
  ├── click: Packaging Station
  └── assert: Station loaded
```

In the GUI, nested tests appear as collapsible blocks. User can:
- Drop any saved test into another test's step list
- Expand/collapse nested steps for readability
- A nested test runs all its steps inline when the parent runs

## AI-assist in GUI
Even though users don't write steps, we could offer:
- **"Ask AI to add a step"** — text input that sends to Claude, gets back a step definition
- **"Fix failing step"** — one-click sends the failure context to AI for a fix
- **"Record" mode** (future) — watch user interact with the browser, AI converts to steps
