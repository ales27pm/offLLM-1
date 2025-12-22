import LLMService from "./llmService";
import candidateTemplate from "../../prompts/v1/tree_of_thought_candidate.json";
import evaluationTemplate from "../../prompts/v1/tree_of_thought_evaluation.json";
import fallbackTemplate from "../../prompts/v1/tree_of_thought_fallback_candidates.json";

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

    const rootNode = {
      thought: problem,
      evaluation: 0,
      children: [],
      depth: 0,
    };

    await this.expandTree(rootNode, maxBranches, maxDepth, evaluationThreshold);

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

    const candidateThoughts = await this.generateCandidateThoughts(
      node.thought,
      maxBranches,
    );

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

      if (evaluation > evaluationThreshold * 0.6) {
        await this.expandTree(
          childNode,
          maxBranches,
          maxDepth,
          evaluationThreshold,
        );
      }
    }

    node.children.sort((a, b) => b.evaluation - a.evaluation);
  }

  async generateCandidateThoughts(currentThought, maxCandidates) {
    const prompt = renderPromptTemplate(candidateTemplate.prompt, {
      current_thought: currentThought,
      max_candidates: maxCandidates,
    });

    try {
      const response = await LLMService.generate(prompt, 200, 0.8);
      const responseText = normalizeModelOutput(response);
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
    const baseCandidates = fallbackTemplate.candidates.map((template) =>
      renderPromptTemplate(template, { thought }),
    );

    return baseCandidates.slice(0, maxCandidates);
  }

  async evaluateThought(thought, context) {
    const prompt = renderPromptTemplate(evaluationTemplate.prompt, {
      context,
      thought,
    });

    try {
      const response = await LLMService.generate(prompt, 10, 0.1);
      const responseText = normalizeModelOutput(response);
      const rating = parseFloat(responseText.trim());
      return Number.isNaN(rating) ? 0.5 : Math.max(0, Math.min(1, rating));
    } catch (error) {
      console.error("Failed to evaluate thought:", error);
      return 0.5;
    }
  }

  findBestSolution(node) {
    if (node.children.length === 0) {
      return node;
    }

    const bestChild = node.children[0];
    return this.findBestSolution(bestChild);
  }

  generateExplanation(rootNode, solutionNode) {
    let currentNode = solutionNode;
    const path = [];

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
    const trees = [];

    for (let i = 0; i < numTrees; i += 1) {
      trees.push(
        this.solveComplexProblem(problem, {
          maxBranches: Math.floor(this.maxBranches / numTrees),
          maxDepth: this.maxDepth,
        }),
      );
    }

    const results = await Promise.allSettled(trees);
    const successfulResults = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (successfulResults.length === 0) {
      throw new Error("All tree search attempts failed");
    }

    return successfulResults.reduce((best, current) =>
      current.confidence > best.confidence ? current : best,
    );
  }
}

export default TreeOfThoughtReasoner;
