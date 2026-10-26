import { type HeaderFooterSettings, orientedSize, PAGE_PRESETS, type PageLayout, THEME_PRESETS, type ValidationError } from '@mdleaf/core';
import { ToggleGroup } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useThemeStore } from '@/state/stores.ts';
import { Checkbox, cx, Field, inputClass, Select } from '../ui.tsx';

export type Unit = 'mm' | 'in';

const toDisplay = (mm: number, unit: Unit) => (unit === 'mm' ? String(Math.round(mm * 10) / 10) : (mm / 25.4).toFixed(2));
const fromDisplay = (v: string, unit: Unit) => {
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) return Number.NaN;
  return unit === 'mm' ? Math.round(n * 10) / 10 : Math.round(n * 25.4 * 10) / 10;
};

function NumberField({
  id,
  label,
  valueMm,
  unit,
  disabled,
  onChange,
  error,
}: {
  id: string;
  label: string;
  valueMm: number;
  unit: Unit;
  disabled?: boolean;
  onChange(mm: number): void;
  error?: string | null;
}) {
  const [text, setText] = useState(toDisplay(valueMm, unit));
  // Only resync when the value or unit changes from outside, not while typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is intentionally not a dependency
  useEffect(() => {
    if (fromDisplay(text, unit) !== valueMm) setText(toDisplay(valueMm, unit));
  }, [valueMm, unit]);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-fg-muted">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          inputMode="decimal"
          className={cx(inputClass, 'w-20', error && 'border-danger')}
          disabled={disabled}
          value={text}
          aria-invalid={!!error}
          onChange={(e) => {
            setText(e.target.value);
            const mm = fromDisplay(e.target.value, unit);
            if (Number.isFinite(mm)) onChange(mm);
          }}
        />
        <span className="text-[11px] text-fg-subtle">{unit}</span>
      </div>
    </div>
  );
}

/** A scaled page outline with the margins drawn and dimensions labelled. */
export function PageDiagram({ layout }: { layout: PageLayout }) {
  const { width, height } = orientedSize(layout);
  const scale = 150 / Math.max(width, height);
  const w = width * scale;
  const h = height * scale;
  const m = layout.marginsMm;
  return (
    <figure className="flex flex-col items-center gap-1" aria-label={`Page ${width} by ${height} millimetres`}>
      <svg width={w + 2} height={h + 2} role="img" aria-hidden className="text-fg-muted">
        <rect x={1} y={1} width={w} height={h} fill="var(--bg)" stroke="currentColor" />
        <rect
          x={1 + m.left * scale}
          y={1 + m.top * scale}
          width={Math.max(0, w - (m.left + m.right) * scale)}
          height={Math.max(0, h - (m.top + m.bottom) * scale)}
          fill="var(--accent-soft)"
          stroke="var(--accent)"
          strokeDasharray="3 2"
        />
      </svg>
      <figcaption className="text-[11px] text-fg-muted">
        {Math.round(width * 10) / 10} × {Math.round(height * 10) / 10} mm
      </figcaption>
    </figure>
  );
}

export interface LayoutValue {
  themeId: string;
  layout: PageLayout;
  headerFooter: HeaderFooterSettings;
}

/** Renders a field, optionally preceded by an "Override" checkbox (document settings). */
export type OverrideSlot = (path: string, field: ReactNode, inheritedHint?: string) => ReactNode;

export function LayoutEditor({
  value,
  onChange,
  disabled,
  errors,
  wrap = (_p, f) => f,
  isDisabled = () => !!disabled,
}: {
  value: LayoutValue;
  onChange(next: LayoutValue): void;
  disabled?: boolean;
  errors: ValidationError[];
  wrap?: OverrideSlot;
  isDisabled?: (path: string) => boolean;
}) {
  const [unit, setUnit] = useState<Unit>('mm');
  const [linkSides, setLinkSides] = useState(false);
  const themes = useThemeStore((s) => s.records);
  const err = (field: string) => errors.find((e) => e.field === field)?.message ?? null;
  const l = value.layout;
  const set = (patch: Partial<LayoutValue>) => onChange({ ...value, ...patch });
  const setLayout = (patch: Partial<PageLayout>) => set({ layout: { ...l, ...patch } });

  const sizePreset = (preset: 'A4' | 'Letter' | 'custom') => {
    if (preset === 'custom') setLayout({ size: { preset: 'custom', widthMm: l.size.widthMm, heightMm: l.size.heightMm } });
    else setLayout({ size: { preset, ...PAGE_PRESETS[preset] } });
  };
  const setMargin = (side: keyof PageLayout['marginsMm'], mm: number) => {
    if (linkSides) setLayout({ marginsMm: { top: mm, right: mm, bottom: mm, left: mm } });
    else setLayout({ marginsMm: { ...l.marginsMm, [side]: mm } });
  };

  return (
    <div className="grid grid-cols-[1fr_auto] gap-6">
      <div>
        {wrap(
          'themeId',
          <Field label="Theme" htmlFor="le-theme">
            <Select id="le-theme" value={value.themeId} disabled={isDisabled('themeId')} onChange={(e) => set({ themeId: e.target.value })}>
              <optgroup label="Presets">
                {THEME_PRESETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              {themes.length ? (
                <optgroup label="Your themes">
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {!THEME_PRESETS.some((t) => t.id === value.themeId) && !themes.some((t) => t.id === value.themeId) ? (
                <option value={value.themeId}>Missing theme</option>
              ) : null}
            </Select>
          </Field>,
        )}
        {wrap(
          'layout.size',
          <fieldset className="mb-3">
            <legend className="mb-1 flex w-full items-center justify-between text-[12px] font-medium text-fg-muted">
              Page size
              <span className="flex items-center gap-1 font-normal">
                Units
                <select
                  aria-label="Units"
                  className="rounded border border-border bg-bg text-[11px]"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as Unit)}
                >
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                </select>
              </span>
            </legend>
            <div className="flex gap-4 text-[13px]">
              {(['A4', 'Letter', 'custom'] as const).map((p) => (
                <label key={p} className={cx('flex items-center gap-1', isDisabled('layout.size') && 'opacity-60')}>
                  <input
                    type="radio"
                    name="le-size"
                    disabled={isDisabled('layout.size')}
                    checked={l.size.preset === p}
                    onChange={() => sizePreset(p)}
                  />
                  {p === 'custom' ? 'Custom' : p}
                </label>
              ))}
            </div>
            {l.size.preset === 'custom' ? (
              <div className="mt-2 flex gap-3">
                <NumberField
                  id="le-w"
                  label="Width"
                  unit={unit}
                  valueMm={l.size.widthMm}
                  disabled={isDisabled('layout.size')}
                  error={err('layout.size.widthMm')}
                  onChange={(mm) => setLayout({ size: { ...l.size, widthMm: mm } })}
                />
                <NumberField
                  id="le-h"
                  label="Height"
                  unit={unit}
                  valueMm={l.size.heightMm}
                  disabled={isDisabled('layout.size')}
                  error={err('layout.size.heightMm')}
                  onChange={(mm) => setLayout({ size: { ...l.size, heightMm: mm } })}
                />
              </div>
            ) : null}
            {err('layout.size.widthMm') || err('layout.size.heightMm') || err('layout.size') ? (
              <p className="mt-1 text-[12px] text-danger">
                {err('layout.size.widthMm') ?? err('layout.size.heightMm') ?? err('layout.size')}
              </p>
            ) : null}
          </fieldset>,
        )}
        {wrap(
          'layout.orientation',
          <div className="mb-3">
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">Orientation</span>
            <ToggleGroup.Root
              type="single"
              aria-label="Orientation"
              value={l.orientation}
              disabled={isDisabled('layout.orientation')}
              onValueChange={(v) => v && setLayout({ orientation: v as PageLayout['orientation'] })}
              className="inline-flex rounded-md border border-border"
            >
              {(['portrait', 'landscape'] as const).map((o) => (
                <ToggleGroup.Item
                  key={o}
                  value={o}
                  className="h-7 px-3 text-[12px] capitalize first:rounded-l-md last:rounded-r-md data-[state=on]:bg-accent-soft data-[state=on]:text-accent disabled:opacity-50"
                >
                  {o}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>,
        )}
        <fieldset className="mb-3">
          <legend className="mb-1 flex w-full items-center justify-between text-[12px] font-medium text-fg-muted">
            Margins
            <Checkbox label="Link all sides" checked={linkSides} onChange={setLinkSides} />
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) =>
              wrap(
                `layout.marginsMm.${side}`,
                <NumberField
                  key={side}
                  id={`le-m-${side}`}
                  label={side[0].toUpperCase() + side.slice(1)}
                  unit={unit}
                  valueMm={l.marginsMm[side]}
                  disabled={isDisabled(`layout.marginsMm.${side}`)}
                  error={err(`layout.marginsMm.${side}`)}
                  onChange={(mm) => setMargin(side, mm)}
                />,
              ),
            )}
          </div>
          {['top', 'right', 'bottom', 'left'].map((s) => err(`layout.marginsMm.${s}`)).filter(Boolean)[0] ? (
            <p className="mt-1 text-[12px] text-danger">
              {['top', 'right', 'bottom', 'left'].map((s) => err(`layout.marginsMm.${s}`)).filter(Boolean)[0]}
            </p>
          ) : null}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-fg-muted">Header &amp; footer</legend>
          {wrap(
            'headerFooter.hideHeaderOnFirstPage',
            <div className="mb-3">
              <Checkbox
                label="Hide header on first page"
                disabled={isDisabled('headerFooter.hideHeaderOnFirstPage')}
                checked={value.headerFooter.hideHeaderOnFirstPage}
                onChange={(v) => set({ headerFooter: { ...value.headerFooter, hideHeaderOnFirstPage: v } })}
              />
            </div>,
          )}
          {wrap(
            'headerFooter.hideFooterOnFirstPage',
            <div className="mb-3">
              <Checkbox
                label="Hide footer on first page"
                disabled={isDisabled('headerFooter.hideFooterOnFirstPage')}
                checked={value.headerFooter.hideFooterOnFirstPage}
                onChange={(v) => set({ headerFooter: { ...value.headerFooter, hideFooterOnFirstPage: v } })}
              />
            </div>,
          )}
        </fieldset>
      </div>
      <PageDiagram layout={l} />
    </div>
  );
}
