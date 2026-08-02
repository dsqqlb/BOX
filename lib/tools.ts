import tools from '@/data/tools.json';
import { Tool } from './types';

export function getAllTools(): Tool[] {
  return tools as Tool[];
}

export function getToolBySlug(slug: string): Tool | undefined {
  return tools.find((tool) => tool.slug === slug) as Tool | undefined;
}

export function getToolsByCategory(category: string): Tool[] {
  return tools.filter((tool) => tool.category === category) as Tool[];
}

export function getFeaturedTools(): Tool[] {
  return tools.filter((tool) => tool.featured) as Tool[];
}
