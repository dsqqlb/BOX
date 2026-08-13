// 选择器分词：把一段选择器文本按 token 类型拆开，供画廊/详情卡分色高亮。

export type SelectorTokenType =
  | 'el'        // 元素选择器 div / span
  | 'id'        // #id
  | 'cls'       // .class
  | 'pseudo'    // :hover / :is(...) 等伪类
  | 'pseudoEl'  // ::before 等伪元素
  | 'attr'      // [attr="x"]
  | 'comb'      // 组合器 > + ~
  | 'space'     // 后代空格
  | 'ns'        // 命名空间 / 通配符 *
  | 'plain';    // 其他（未匹配文本）

export interface SelectorToken {
  text: string;
  type: SelectorTokenType;
}

const TOKEN_RE =
  /(::?[\w-]+(?:\([^)]*\))?)|(\[[^\]]*\])|(#[a-zA-Z_][\w-]*)|(\.[a-zA-Z_][\w-]*)|(\s*[>+~]\s*)|(\s+)|(\*)|([a-zA-Z_][\w-]*)/g;

/** 分词并保证全文覆盖（未匹配的残片回退为 plain） */
export function tokenizeSelector(text: string): SelectorToken[] {
  const out: SelectorToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const idx = m.index;
    if (idx > last) out.push({ text: text.slice(last, idx), type: 'plain' });
    if (m[1]) {
      out.push({ text: m[1], type: m[1].startsWith('::') ? 'pseudoEl' : 'pseudo' });
    } else if (m[2]) {
      out.push({ text: m[2], type: 'attr' });
    } else if (m[3]) {
      out.push({ text: m[3], type: 'id' });
    } else if (m[4]) {
      out.push({ text: m[4], type: 'cls' });
    } else if (m[5]) {
      out.push({ text: m[5], type: 'comb' });
    } else if (m[6]) {
      out.push({ text: m[6], type: 'space' });
    } else if (m[7]) {
      out.push({ text: m[7], type: 'ns' });
    } else if (m[8]) {
      out.push({ text: m[8], type: 'el' });
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), type: 'plain' });
  return out;
}

/** token 类型 → 分色 class */
export function tokenClass(type: SelectorTokenType): string {
  switch (type) {
    case 'el': return 'cc-sel-el';
    case 'id': return 'cc-sel-id';
    case 'cls': return 'cc-sel-cls';
    case 'pseudo': return 'cc-sel-pseudo';
    case 'pseudoEl': return 'cc-sel-pseudoEl';
    case 'attr': return 'cc-sel-attr';
    case 'comb': return 'cc-sel-comb';
    case 'space': return '';
    case 'ns': return 'cc-sel-ns';
    default: return 'cc-sel-plain';
  }
}
