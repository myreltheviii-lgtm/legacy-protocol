// guardian-app/src/components/RiskBadge.tsx
//
// Displays a coloured pill badge for a risk level or activity zone.
// Converted from React Native to HTML/CSS for Tauri webview.

import { Colors, Radius, Typography } from '../theme';
import type { RiskLevel, Zone } from '../theme';

interface Props {
  level: RiskLevel | Zone;
  size?: 'sm' | 'md';
}

export function RiskBadge({ level, size = 'md' }: Props) {
  const color   = (Colors as Record<string, string>)[level] ?? Colors.textMuted;
  const isSmall = size === 'sm';

  return (
    <div style={{
      display:         'inline-flex',
      alignItems:      'center',
      border:          `1px solid ${color}`,
      borderRadius:    `${Radius.full}px`,
      paddingLeft:     isSmall ? '7px'  : '10px',
      paddingRight:    isSmall ? '7px'  : '10px',
      paddingTop:      isSmall ? '2px'  : '4px',
      paddingBottom:   isSmall ? '2px'  : '4px',
      backgroundColor: color + '22',
      alignSelf:       'flex-start',
    }}>
      <span style={{
        ...Typography.label,
        color,
        fontSize: isSmall ? '9px' : Typography.label.fontSize,
      }}>
        {level}
      </span>
    </div>
  );
}
