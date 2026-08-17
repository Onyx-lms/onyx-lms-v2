'use client';

export interface WatermarkConfig {
  type: 'js' | 'ffmpeg' | 'none';
  logo: string | null;
  text: string | null;
  top: number;
  left: number;
  width: number;
  height: number;
  opacity: number;
}

/**
 * PL-07a -- the browser-side watermark.
 *
 * Deterrent, not protection: anything rendered in a browser can be captured.
 * It exists so a leaked recording carries an identifying mark, which is what
 * the Laravel overlay did too. `pointer-events: none` keeps it off the video
 * controls.
 */
export function WatermarkOverlay({ config, label }: {
  config: WatermarkConfig;
  label?: string;
}) {
  if (config.type === 'none') return null;
  const text = label ?? config.text;
  if (!config.logo && !text) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute select-none"
      style={{
        top: config.top + '%',
        left: config.left + '%',
        width: config.width + '%',
        maxHeight: config.height + '%',
        opacity: config.opacity,
      }}
    >
      {config.logo ? (
        <img src={config.logo} alt="" className="h-full w-full object-contain" />
      ) : (
        <span className="whitespace-nowrap text-sm font-medium text-white drop-shadow">
          {text}
        </span>
      )}
    </div>
  );
}
