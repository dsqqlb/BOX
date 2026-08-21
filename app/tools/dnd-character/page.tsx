'use client';

export default function DndCharacterPage() {
  return (
    <iframe
      src="/dnd/index.html"
      title="DND 角色卡"
      className="fixed inset-0 w-full h-full border-0 bg-zinc-950"
      allow="clipboard-write"
    />
  );
}
