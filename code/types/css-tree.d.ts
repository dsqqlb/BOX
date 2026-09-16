// css-tree v3 无内置类型声明，且 @types/css-tree 面向旧版 v1 API。
// 这里只声明本项目实际使用到的 API 子集（CSS 层叠解释器专用）。
declare module 'css-tree' {
  export interface CssNode {
    type: string;
    name?: string;
    property?: string;
    important?: boolean;
    prelude?: CssNode | null;
    block?: CssNode | null;
    value?: CssNode | null;
    children?: List<CssNode> | null;
    loc?: {
      start: { line: number; column: number };
      end: { line: number; column: number };
    } | null;
  }

  export interface List<T = CssNode> {
    size: number;
    forEach(fn: (item: T) => void): void;
    filter(fn: (item: T) => boolean): List<T>;
  }

  export interface Selector extends CssNode {
    type: 'Selector';
    children: List<CssNode>;
  }
  export interface SelectorList extends CssNode {
    type: 'SelectorList';
    children: List<Selector>;
  }
  export interface Rule extends CssNode {
    type: 'Rule';
    prelude: CssNode;
    block: CssNode | null;
  }
  export interface Atrule extends CssNode {
    type: 'Atrule';
  }

  export function parse(
    input: string,
    options?: { context?: string; positions?: boolean }
  ): CssNode;

  export function generate(node: CssNode): string;

  export function walk(
    ast: CssNode,
    options: {
      enter?: (node: CssNode) => void;
      leave?: (node: CssNode) => void;
    }
  ): void;
}
