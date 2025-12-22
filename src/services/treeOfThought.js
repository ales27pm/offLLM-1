import LLMService from "./llmService";
import {
  TREE_OF_THOUGHT_CANDIDATE_ID,
  TREE_OF_THOUGHT_EVALUATION_ID,
  TREE_OF_THOUGHT_FALLBACK_ID,
  getPromptDefinition,
} from "../core/prompt/PromptRegistry";
import {
  buildFinalResponseEvent,
  buildPromptEvent,
  hashString,
  logTelemetryEvent,
} from "../utils/telemetry";

const renderPromptTemplate = (template, values) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  );

const normalizeModelOutput = (result) => {
  if (typeof result === "string") return result;
  if (result && typeof result.text === "string") return result.text;
  return "";
};

const getModelId = () =>
  typeof LLMService.getModelId === "function"
    ? LLMService.getModelId()
    : "unknown";

const logPromptStart = ({ prompt, promptDefinition }) => {
  const promptHash = hashString(prompt);
  const modelId = getModelId();
  void logTelemetryEvent(
    buildPromptEvent({
      promptHash,
      promptText: prompt,
      modelId,
      promptId: promptDefinition.id,
      promptVersion: promptDefinition.version,
    }),
  );
  return { promptHash, modelId };
};

const logPromptResponse = ({
  promptHash,
  modelId,
  responseText,
  promptDefinition,
}) => {
  if (responseText === null || responseText === undefined) {
    return;
  }
  void logTelemetryEvent(
    buildFinalResponseEvent({
      promptHash,
      responseText,
      toolCallsCount: 0,
      modelId,
      promptId: promptDefinition.id,
      promptVersion: promptDefinition.version,
    }),
  );
};

export class TreeOfThoughtReasoner {
  constructor() {
    this.maxBranches = 5;
    this.maxDepth = 3;
    this.evaluationThreshold = 0.7;
  }

  async solveComplexProblem(problem, options = {}) {
    const {
      maxBranches = this.maxBranches,
      maxDepth = this.maxDepth,
      evaluationThreshold = this.evaluationThreshold,
    } = options;

    // Initialize the tree with the root problem
    const rootNode = {
      thought: problem,
      evaluation: 0,
      children: [],
      depth: 0,
    };

    // Develop the tree through iterative expansion
    await this.expandTree(rootNode, maxBranches, maxDepth, evaluationThreshold);

    // Find the best solution path
    const bestSolution = this.findBestSolution(rootNode);

    return {
      solution: bestSolution.thought,
      confidence: bestSolution.evaluation,
      reasoningTree: rootNode,
      fullExplanation: this.generateExplanation(rootNode, bestSolution),
    };
  }

  async expandTree(node, maxBranches, maxDepth, evaluationThreshold) {
    if (node.depth >= maxDepth || node.evaluation >= evaluationThreshold) {
      return;
    }

    // Generate candidate thoughts
    const candidateThoughts = await this.generateCandidateThoughts(
      node.thought,
      maxBranches,
    );

    // Evaluate each candidate
    for (const thought of candidateThoughts) {
      const evaluation = await this.evaluateThought(thought, node.thought);

      const childNode = {
        thought,
        evaluation,
        children: [],
        depth: node.depth + 1,
        parent: node,
      };

      node.children.push(childNode);

      // Recursively expand promising branches
      if (evaluation > evaluationThreshold * 0.6) {
        await this.expandTree(
          childNode,
          maxBranches,
          maxDepth,
          evaluationThreshold,
        );
      }
    }

    // Sort children by evaluation score
    node.children.sort((a, b) => b.evaluation - a.evaluation);
  }

  async generateCandidateThoughts(currentThought, maxCandidates) {
    const promptDefinition = getPromptDefinition(TREE_OF_THOUGHT_CANDIDATE_ID);
    const promptTemplate = promptDefinition.template.prompt;
    const prompt = renderPromptTemplate(promptTemplate, {
      current_thought: currentThought,
      max_candidates: maxCandidates,
    });
    const { promptHash, modelId } = logPromptStart({
      prompt,
      promptDefinition,
    });

    try {
      const response = await LLMService.generate(prompt, 200, 0.8);
      const responseText = normalizeModelOutput(response);
      logPromptResponse({
        promptHash,
        modelId,
        responseText,
        promptDefinition,
      });
      return this.parseNumberedList(responseText).slice(0, maxCandidates);
    } catch (error) {
      console.error("Failed to generate candidate thoughts:", error);
      return this.generateFallbackCandidates(currentThought, maxCandidates);
    }
  }

  parseNumberedList(text) {
    return text
      .split("\n")
      .filter((line) => /^\d+[.)]/.test(line))
      .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
      .filter((thought) => thought.length > 0);
  }

  generateFallbackCandidates(thought, maxCandidates) {
    // Fallback candidates for when LLM generation fails
    const fallbackTemplates = getPromptDefinition(TREE_OF_THOUGHT_FALLBACK_ID)
      .template.candidates;
    const baseCandidates = fallbackTemplates.map((template) =>
      renderPromptTemplate(template, { thought }),
    );

    return baseCandidates.slice(0, maxCandidates);
  }

  async evaluateThought(thought, context) {
    const promptDefinition = getPromptDefinition(TREE_OF_THOUGHT_EVALUATION_ID);
    const promptTemplate = promptDefinition.template.prompt;
    const prompt = renderPromptTemplate(promptTemplate, { context, thought });
    const { promptHash, modelId } = logPromptStart({
      prompt,
      promptDefinition,
    });

    try {
      const response = await LLMService.generate(prompt, 10, 0.1);
      const responseText = normalizeModelOutput(response);
      logPromptResponse({
        promptHash,
        modelId,
        responseText,
        promptDefinition,
      });
      const rating = parseFloat(responseText.trim());
      return isNaN(rating) ? 0.5 : Math.max(0, Math.min(1, rating));
    } catch (error) {
      console.error("Failed to evaluate thought:", error);
      return 0.5; // Default neutral rating
    }
  }

  findBestSolution(node) {
    if (node.children.length === 0) {
      return node;
    }

    // Find the best child and continue down that path
    const bestChild = node.children[0];
    return this.findBestSolution(bestChild);
  }

  generateExplanation(rootNode, solutionNode) {
    let currentNode = solutionNode;
    const path = [];

    // Trace back the solution path
    while (currentNode && currentNode !== rootNode) {
      path.unshift(currentNode.thought);
      currentNode = currentNode.parent;
    }

    return `Solution developed through ${
      path.length
    } steps of reasoning:\n\n${path
      .map((thought, index) => `Step ${index + 1}: ${thought}`)
      .join("\n\n")}\n\nFinal solution confidence: ${(
      solutionNode.evaluation * 100
    ).toFixed(1)}%`;
  }

  async parallelTreeSearch(problem, numTrees = 3) {
    // Run multiple tree searches in parallel for better exploration
    const trees = [];

    for (let i = 0; i < numTrees; i++) {
      trees.push(
        this.solveComplexProblem(problem, {
          maxBranches: Math.floor(this.maxBranches / numTrees),
          maxDepth: this.maxDepth,
        }),
      );
    }

    const results = await Promise.allSettled(trees);
    const successfulResults = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    if (successfulResults.length === 0) {
      throw new Error("All tree searches failed");
    }

    // Return the best solution across all trees
    return successfulResults.sort((a, b) => b.confidence - a.confidence)[0];
  }
}
