import type { TenantContext } from '@/lib/types';

export interface ToolContext {
  readonly tenant: TenantContext;
  readonly correlationId: string;
}

export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(ctx: ToolContext, input: TInput): Promise<ToolResult<TOutput>>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  getDefinitions(): { name: string; description: string; parameters: Record<string, unknown> }[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  return {
    register(tool: Tool): void { tools.set(tool.name, tool); },
    get(name: string): Tool | undefined { return tools.get(name); },
    list(): Tool[] { return Array.from(tools.values()); },
    getDefinitions() {
      return Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },
  };
}
