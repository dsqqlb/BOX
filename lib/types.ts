export interface Tool {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  icon: string;
  featured: boolean;
  createdAt: string;
}

export type ToolCategory = 'learning' | 'ai' | 'game' | 'utility' | 'visualization' | 'life';
