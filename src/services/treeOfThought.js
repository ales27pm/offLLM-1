import LLMService from "./llmService";

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
    const prompt = `Given the current thought: "${currentThought}"

Generate ${maxCandidates} diverse alternative approaches or next steps. Format as a numbered list:`;

    try {
      const response = await LLMService.generate(prompt, 200, 0.8);
      return this.parseNumberedList(response.text).slice(0, maxCandidates);
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
    const baseCandidates = [
      `Consider alternative perspectives on: ${thought}`,
      `Break down the problem: ${thought} into smaller components`,
      `What are the assumptions behind: ${thought}`,
      `Consider the opposite of: ${thought}`,
      `How would an expert approach: ${thought}`,
    ];

    return baseCandidates.slice(0, maxCandidates);
  }

  async evaluateThought(thought, context) {
    const prompt = `Evaluate the quality of this thought in the context of solving: "${context}"

Thought to evaluate: "${thought}"

Rate on a scale of 0.0 to 1.0 considering:
- Relevance to the problem
- Novelty and creativity
- Practical feasibility
- Logical coherence

Provide only the numerical rating:`;

    try {
      const response = await LLMService.generate(prompt, 10, 0.1);
      const rating = parseFloat(response.text.trim());
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
