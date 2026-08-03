'use client';

import { useState } from 'react';

interface LanguageSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (langId: string) => void;
  availableLanguages: Array<{ id: string; name: string; nameEn: string }>;
  addedLangIds: string[];
}

export default function LanguageSelectModal({
  isOpen,
  onClose,
  onSelect,
  availableLanguages,
  addedLangIds,
}: LanguageSelectModalProps) {
  const [selectedId, setSelectedId] = useState('');

  if (!isOpen) return null;

  const availableToAdd = availableLanguages.filter(lang => !addedLangIds.includes(lang.id));

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
      setSelectedId('');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        style={{
          background: 'linear-gradient(to bottom, rgba(254, 252, 232, 0.98), rgba(245, 230, 211, 0.98))',
          border: '3px solid #78350f',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b-2"
          style={{
            background: 'linear-gradient(135deg, #f5e6d3, #e8d5c4)',
            borderColor: '#d97706',
          }}
        >
          <div className="flex items-center justify-between">
            <h3
              className="text-xl font-bold"
              style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
            >
              ➕ 添加 DND 语言
            </h3>
            <button
              onClick={onClose}
              className="text-2xl leading-none transition-colors hover:opacity-70"
              style={{ color: '#78350f' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {availableToAdd.length === 0 ? (
            <p
              className="text-center py-8 text-sm"
              style={{ fontFamily: 'Georgia, serif', color: '#92400e' }}
            >
              所有语言已添加
            </p>
          ) : (
            <div className="space-y-2">
              {availableToAdd.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setSelectedId(lang.id)}
                  className="w-full px-4 py-3 rounded-lg text-left transition-all border-2"
                  style={{
                    backgroundColor: selectedId === lang.id ? '#fef3c7' : 'rgba(254, 252, 232, 0.5)',
                    borderColor: selectedId === lang.id ? '#d97706' : '#e8d5c4',
                    fontFamily: 'Georgia, serif',
                    color: '#78350f',
                  }}
                >
                  <div className="font-bold">{lang.name}</div>
                  <div className="text-sm opacity-70">{lang.nameEn}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t-2 flex justify-end gap-3"
          style={{ borderColor: '#d97706' }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: '#92400e',
              color: '#fef3c7',
              fontFamily: 'Georgia, serif',
            }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: '#16a34a',
              color: '#fef3c7',
              fontFamily: 'Georgia, serif',
            }}
          >
            确认添加
          </button>
        </div>
      </div>
    </div>
  );
}
