import type { SavedTest, StepDef } from './types.js';

/**
 * Generate a Mermaid flowchart diagram from a test definition.
 * Shows flow structure, variable dependencies, and control flow.
 */
export function generateTestFlowDiagram(test: SavedTest): string {
  const lines: string[] = ['graph TD'];

  let nodeId = 0;
  const getNodeId = () => `N${nodeId++}`;

  // Track previous node for connecting arrows
  let prevNode: string | null = null;

  // Helper to add a node and connect it to the previous node
  const addNode = (id: string, label: string, shape: 'rect' | 'diamond' | 'round' | 'callout' = 'rect') => {
    const shapeMap = {
      rect: (text: string) => `[${text}]`,
      diamond: (text: string) => `{${text}}`,
      round: (text: string) => `([${text}])`,
      callout: (text: string) => `[[${text}]]`
    };

    lines.push(`    ${id}${shapeMap[shape](label)}`);

    if (prevNode) {
      lines.push(`    ${prevNode} --> ${id}`);
    }

    return id;
  };

  // Helper to extract variable info from a step
  const getVariableInfo = (step: StepDef): { sets?: string; uses: string[] } => {
    const sets = 'as' in step ? step.as : undefined;
    const uses: string[] = [];

    // Find all $vars references in the step
    const stepJson = JSON.stringify(step);
    const varMatches = stepJson.matchAll(/\$vars\.(\w+)/g);
    for (const match of varMatches) {
      uses.push(match[1]);
    }

    return { sets, uses };
  };

  // Helper to format step label with variable annotations and comments
  const formatStepLabel = (step: StepDef, index: number, section: string): string => {
    const varInfo = getVariableInfo(step);
    const stepType = getStepType(step);

    let label = `${section}[${index}]: ${stepType}`;

    // Add comment if present
    if ('comment' in step && step.comment) {
      label += `<br/>💬 ${step.comment}`;
    }

    // Add variable annotations
    const annotations: string[] = [];
    if (varInfo.sets) {
      annotations.push(`📦 sets $vars.${varInfo.sets}`);
    }
    if (varInfo.uses.length > 0) {
      annotations.push(`📥 uses $vars.${varInfo.uses.join(', $vars.')}`);
    }

    if (annotations.length > 0) {
      label += `<br/>${annotations.join('<br/>')}`;
    }

    return label;
  };

  // Helper to get human-readable step type
  const getStepType = (step: StepDef): string => {
    if ('navigate' in step) return 'Navigate';
    if ('eval' in step) return 'Evaluate';
    if ('fill' in step) return 'Fill';
    if ('click' in step) return 'Click';
    if ('assert' in step) return 'Assert';
    if ('wait_for' in step) return 'Wait for';
    if ('wait' in step) return `Wait ${step.wait}ms`;
    if ('console_check' in step) return 'Console check';
    if ('network_check' in step) return 'Network check';
    if ('mock_network' in step) return 'Mock network';
    if ('run_test' in step) return `Run test: ${step.run_test}`;
    if ('loop' in step) return 'Loop';
    if ('if' in step) return 'Conditional';
    if ('get_dom_snapshot' in step) return 'Get DOM snapshot';
    if ('take_screenshot' in step) return 'Take screenshot';
    if ('keyboard' in step) return 'Keyboard input';
    if ('hover' in step) return 'Hover';
    if ('scroll' in step) return 'Scroll';
    if ('focus' in step) return 'Focus';
    if ('blur' in step) return 'Blur';
    if ('select_option' in step) return 'Select option';
    if ('drag_and_drop' in step) return 'Drag and drop';
    if ('upload_file' in step) return 'Upload file';
    if ('download_file' in step) return 'Download file';
    if ('switch_frame' in step) return 'Switch frame';
    if ('switch_tab' in step) return 'Switch tab';
    if ('close_tab' in step) return 'Close tab';
    return 'Unknown step';
  };

  // Process before section
  if (test.definition.before && test.definition.before.length > 0) {
    const sectionStart = getNodeId();
    addNode(sectionStart, 'BEFORE SECTION', 'round');
    prevNode = sectionStart;

    for (let i = 0; i < test.definition.before.length; i++) {
      const step = test.definition.before[i];
      const nodeIdStr = getNodeId();
      const label = formatStepLabel(step, i, 'Before');
      prevNode = addNode(nodeIdStr, label);
    }
  }

  // Process main steps section
  if (test.definition.steps.length > 0) {
    const sectionStart = getNodeId();
    addNode(sectionStart, 'MAIN STEPS', 'round');
    prevNode = sectionStart;

    for (let i = 0; i < test.definition.steps.length; i++) {
      const step = test.definition.steps[i];
      prevNode = processStep(step, i, 'Step', addNode, getNodeId, formatStepLabel, lines);
    }
  }

  // Process after section
  if (test.definition.after && test.definition.after.length > 0) {
    const sectionStart = getNodeId();
    addNode(sectionStart, 'AFTER SECTION', 'round');
    prevNode = sectionStart;

    for (let i = 0; i < test.definition.after.length; i++) {
      const step = test.definition.after[i];
      const nodeIdStr = getNodeId();
      const label = formatStepLabel(step, i, 'After');
      prevNode = addNode(nodeIdStr, label);
    }
  }

  // Add end node
  const endNode = getNodeId();
  addNode(endNode, 'END', 'round');

  // Add styling
  lines.push('');
  lines.push('    %% Styling');
  lines.push('    classDef setupClass fill:#e1f5ff,stroke:#333,stroke-width:2px');
  lines.push('    classDef stepClass fill:#ffe1f5,stroke:#333,stroke-width:2px');
  lines.push('    classDef cleanupClass fill:#f5ffe1,stroke:#333,stroke-width:2px');
  lines.push('    classDef sectionClass fill:#fff4e1,stroke:#333,stroke-width:3px');

  return lines.join('\n');
}

/**
 * Process a single step, handling special cases like conditionals and loops
 */
function processStep(
  step: StepDef,
  index: number,
  section: string,
  addNode: (id: string, label: string, shape?: 'rect' | 'diamond' | 'round' | 'callout') => string,
  getNodeId: () => string,
  formatStepLabel: (step: StepDef, index: number, section: string) => string,
  lines: string[]
): string {
  // Handle conditional steps
  if ('if' in step) {
    const condId = getNodeId();
    const condLabel = `if ${step.if}`;
    lines.push(`    ${condId}{${condLabel}}`);

    // For now, just show the condition and the step
    // In a full implementation, we'd need to show branches
    const stepId = getNodeId();
    const label = formatStepLabel(step, index, section);
    lines.push(`    ${condId} -->|true| ${stepId}[${label}]`);
    lines.push(`    ${condId} -->|false| ${stepId}`);
    return stepId;
  }

  // Handle loop steps
  if ('loop' in step) {
    const loopId = getNodeId();
    let loopLabel = 'Loop';
    if (step.loop.over) loopLabel += `: over ${step.loop.over}`;
    else if (step.loop.while) loopLabel += `: while ${step.loop.while}`;
    else if (step.loop.max) loopLabel += `: max ${step.loop.max}`;
    addNode(loopId, loopLabel, 'diamond');

    // In a full implementation, we'd show loop body as a subgraph
    return loopId;
  }

  // Handle run_test (nested test execution)
  if ('run_test' in step) {
    const nodeIdStr = getNodeId();
    const label = `🔗 Run test: ${step.run_test}`;
    return addNode(nodeIdStr, label, 'callout');
  }

  // Standard step
  const nodeIdStr = getNodeId();
  const label = formatStepLabel(step, index, section);
  return addNode(nodeIdStr, label);
}
