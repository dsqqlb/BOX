// MyMemory Translation API 封装
// API 文档: https://mymemory.translated.net/doc/spec.php

export type Language = 'zh' | 'en';

interface TranslateResponse {
  responseData: {
    translatedText: string;
    match: number;
  };
  quotaFinished: boolean;
  mtLangSupported: boolean | null;
  responseDetails: string;
  responseStatus: number;
  responderId: string | null;
  matches: Array<{
    segment: string;
    translation: string;
    quality: string;
    reference: string | null;
    usageCount: number;
    subject: string;
    createdBy: string;
    lastUpdatedBy: string;
    createDate: string;
    lastUpdateDate: string;
    match: number;
  }>;
}

/**
 * 翻译文本
 * @param text 要翻译的文本
 * @param from 源语言 (zh=中文, en=英文)
 * @param to 目标语言
 * @returns 翻译后的文本
 */
export async function translateText(
  text: string,
  from: Language,
  to: Language
): Promise<string> {
  if (!text.trim()) return '';
  if (from === to) return text;

  const langPair = `${from}|${to}`;
  const encodedText = encodeURIComponent(text);
  const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${langPair}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data: TranslateResponse = await response.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || 'Translation failed');
    }

    return data.responseData.translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

/**
 * 批量翻译（用换行符分隔）
 */
export async function translateBatch(
  texts: string[],
  from: Language,
  to: Language
): Promise<string[]> {
  const results: string[] = [];
  for (const text of texts) {
    const translated = await translateText(text, from, to);
    results.push(translated);
  }
  return results;
}
