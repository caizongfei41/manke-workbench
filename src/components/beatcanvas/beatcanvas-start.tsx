import type { ReactNode } from 'react';

/**
 * The empty canvas.
 *
 * The studio and the canvas used to open on the same screen, which made the two tabs feel
 * like one feature with two names. They are different instruments: the studio is a prompt
 * you send off, the canvas is a surface you arrange. This empty state says that — it shows
 * the board itself, with the three cards you would place on it.
 */
export function BeatCanvasStart({
  copy,
  onAddCard,
}: {
  copy: {
    title: string;
    subtitle: string;
    hint: string;
    actions: { key: string; label: string; body: string; icon: ReactNode }[];
  };
  onAddCard: (key: string) => void;
}) {
  return (
    <div
      className="pointer-events-none w-[min(92vw,720px)] text-center"
      data-beatcanvas-start="true"
    >
      {/* A miniature of the board: dotted field, three cards, one wire. */}
      <div className="relative mx-auto h-[168px] w-[320px]" aria-hidden="true">
        <div
          className="absolute inset-0 rounded-[18px] border border-ink/[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--beat-grid-dot) 1px, transparent 0)',
            backgroundSize: '14px 14px',
          }}
        />
        <div className="absolute left-[26px] top-[30px] h-[52px] w-[74px] rounded-[10px] border border-ink/[0.14] bg-[var(--beat-surface)] shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)]" />
        <div className="absolute left-[122px] top-[58px] h-[64px] w-[88px] rounded-[10px] border border-ink/[0.14] bg-[var(--beat-surface)] shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)]" />
        <div className="absolute left-[224px] top-[36px] h-[46px] w-[64px] rounded-[10px] border border-ink/[0.14] bg-[var(--beat-surface)] shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)]" />
        <svg className="absolute inset-0 size-full" viewBox="0 0 320 168" fill="none">
          <path
            d="M100 56 C 112 56, 112 90, 124 90"
            stroke="var(--beat-accent)"
            strokeWidth="1.5"
            strokeOpacity="0.5"
          />
          <path
            d="M210 90 C 220 90, 220 60, 226 60"
            stroke="var(--beat-accent)"
            strokeWidth="1.5"
            strokeOpacity="0.35"
          />
        </svg>
      </div>

      <h2 className="beat-product-display mt-7 text-[26px] font-semibold tracking-[-0.03em] text-[var(--beat-text-1)]">
        {copy.title}
      </h2>
      <p className="mx-auto mt-2.5 max-w-[420px] text-[14px] leading-7 text-[var(--beat-text-2)]">
        {copy.subtitle}
      </p>

      <div className="mt-7 grid gap-2.5 sm:grid-cols-3">
        {copy.actions.map((action) => (
          <button
            key={action.key}
            type="button"
            data-canvas-start-action={action.key}
            onClick={() => onAddCard(action.key)}
            className="pointer-events-auto group flex flex-col items-start rounded-[14px] border border-ink/[0.1] bg-[var(--beat-surface)] p-3.5 text-left transition hover:border-ink/25 hover:shadow-[var(--beat-card-shadow)]"
          >
            <span className="grid size-8 place-items-center rounded-[10px] border border-ink/[0.12] text-[var(--beat-text-1)]">
              {action.icon}
            </span>
            <span className="mt-3 text-[13.5px] font-semibold text-[var(--beat-text-1)]">
              {action.label}
            </span>
            <span className="mt-0.5 text-[13px] leading-6 text-[var(--beat-text-2)]">
              {action.body}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-5 text-[13px] text-[var(--beat-text-3)]">{copy.hint}</p>
    </div>
  );
}
