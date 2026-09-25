import { marsTokens } from '../theme/marsTheme';

interface MarsLogoProps {
  height?: number;
  color?: string;
  title?: string;
}

/**
 * Geometric approximation of the Mars wordmark drawn as one evenodd path so it
 * stays crisp at the native 138x40 box. The licensed asset is not redistributable,
 * and fetching it at runtime would add a cross-origin dependency to the demo.
 */
const WORDMARK_PATH = [
  // M
  'M4,34 V6 H12 L21,22 L30,6 H38 V34 H31 V19 L24,31 H18 L11,19 V34 Z',
  // A — outer silhouette
  'M42,34 L51.2,6 H60.8 L70,34 H62.6 L60.6,27.4 H51.4 L49.4,34 Z',
  // A — counter
  'M56,15 L52.3,23.5 H59.7 Z',
  // R — outer silhouette
  'M78,6 H94.2 C99.6,6 103,9.5 103,14.2 C103,17.9 100.9,20.8 97.4,21.9 L104.2,34 H95.8 L89.6,22.8 H85 V34 H78 Z',
  // R — bowl counter
  'M85,12.2 V17.4 H93.4 C95.2,17.4 96.3,16.4 96.3,14.8 C96.3,13.2 95.2,12.2 93.4,12.2 Z',
  // S
  'M131.8,13.4 H125 C124.8,11.5 123.4,10.4 121.2,10.4 C119,10.4 117.6,11.4 117.6,13 C117.6,14.4 118.6,15.2 121,15.7 L124.8,16.5 C129.6,17.5 132.2,20 132.2,24.2 C132.2,30 127.8,34.4 121,34.4 C114.4,34.4 110,30.6 109.8,24.6 H116.8 C117,27.4 118.6,28.8 121.3,28.8 C123.8,28.8 125.4,27.5 125.4,25.6 C125.4,24 124.4,23.1 121.8,22.6 L117.8,21.7 C113.2,20.7 110.8,18.2 110.8,14.2 C110.8,8.6 115,4.6 121.4,4.6 C127.6,4.6 131.6,8.2 131.8,13.4 Z',
].join(' ');

export function MarsLogo({ height = 28, color = marsTokens.marsBlue, title = 'Mars' }: MarsLogoProps) {
  return (
    <svg
      viewBox="0 0 138 40"
      height={height}
      width={(height * 138) / 40}
      role="img"
      aria-label={title}
      focusable="false"
      style={{ display: 'block', shapeRendering: 'geometricPrecision', flexShrink: 0 }}
    >
      <title>{title}</title>
      <path d={WORDMARK_PATH} fill={color} fillRule="evenodd" />
    </svg>
  );
}
