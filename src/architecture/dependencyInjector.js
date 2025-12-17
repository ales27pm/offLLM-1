export class DependencyInjector {
  constructor() {
    this.dependencies = new Map();
  }

  register(name, dependency) {
    this.dependencies.set(name, dependency);
  }

  inject(name) {
    const dep = this.dependencies.get(name);
    if (!dep) {
      throw new Error(`Dependency ${name} not provided`);
    }
    return dep;
  }

  has(name) {
    return this.dependencies.has(name);
  }

  clear() {
    this.dependencies.clear();
  }
}

export const dependencyInjector = new DependencyInjector();
